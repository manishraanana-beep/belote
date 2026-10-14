import test from "node:test";
import assert from "node:assert/strict";
import { createTournaments, formatWhen, normalize, utcToZoned, zonedToUtc, MIN, HOUR } from "../src/tournaments.js";

const REWARDS = ["tournoi-vainqueur", "tournoi-finaliste", "tournoi-participant", "frame-champion"];
// Horloge simulée : chaque test avance le temps à la main.
function setup({ players = 40, balance = 60000 } = {}) {
  let t = Date.UTC(2026, 10, 14, 12, 0); // 14 novembre 2026, 13 h à Paris
  const db = { players: {} };
  for (let i = 0; i < players; i++) db.players["p" + i] = { id: "p" + i, name: "J" + i, accountId: "a" + i, balance, timeZone: i % 2 ? "America/New_York" : "Europe/Paris" };
  const sent = [];
  const tables = {};
  const awards = [];
  let n = 0;
  const tours = createTournaments({
    db,
    now: () => t,
    rewardIds: REWARDS,
    hooks: {
      available: (p) => p.balance,
      notify: (pid, msg) => {
        if (db.players[pid]?.failPush) throw Error("push indisponible");
        sent.push({ pid, ...msg });
      },
      launchMatch: (tour, m, a, b) => {
        const id = "table" + ++n;
        tables[id] = { a, b, round: m.round };
        return id;
      },
      endTable: (id) => delete tables[id],
      award: (p, r) => awards.push([p.id, r]),
      prize: (p, credits, key) => awards.push([p.id, "prize", credits, key]),
    },
  });
  const local = (ms) => utcToZoned(ms, "Europe/Paris");
  const base = (over = {}) => ({
    name: "Grand tournoi d’automne",
    timeZone: "Europe/Paris",
    teams: 8,
    minBalance: 50000,
    rules: { target: 1000, turnSeconds: 30, flyingCounter: true },
    rewards: { winner: ["tournoi-vainqueur", "frame-champion"], finalist: ["tournoi-finaliste"], participant: ["tournoi-participant"] },
    regOpen: local(t + HOUR),
    regClose: local(t + 5 * HOUR),
    confirmBy: local(t + 6 * HOUR - 5 * MIN),
    start: local(t + 6 * HOUR),
    publish: true,
    ...over,
  });
  return { db, tours, sent, tables, awards, base, at: (ms) => (t = ms), now: () => t, advance: (ms) => (t += ms) };
}
function playOut(s, tour) {
  // Fait gagner l'équipe « a » de chaque rencontre en cours jusqu'à la finale.
  for (let guard = 0; guard < 10 && tour.status === "running"; guard++)
    for (const [id] of Object.entries(s.tables)) s.tours.matchFinished(id, 0, [1010, 640]), delete s.tables[id];
}

test("fuseaux horaires et changements d’heure", () => {
  // 29 mars 2026 : passage à l'heure d'été à Paris ; 25 octobre : retour à l'heure d'hiver.
  assert.equal(new Date(zonedToUtc("2026-03-28T20:00", "Europe/Paris")).toISOString(), "2026-03-28T19:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-03-29T20:00", "Europe/Paris")).toISOString(), "2026-03-29T18:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-10-25T20:00", "Europe/Paris")).toISOString(), "2026-10-25T19:00:00.000Z");
  assert.equal(utcToZoned(Date.UTC(2026, 9, 25, 19), "Europe/Paris"), "2026-10-25T20:00");
  // Le même instant affiché dans le fuseau de chaque joueur.
  const ts = zonedToUtc("2026-11-14T20:30", "Europe/Paris");
  assert.match(formatWhen(ts, "Europe/Paris"), /20:30/);
  assert.match(formatWhen(ts, "America/New_York"), /14:30/);
  assert.match(formatWhen(ts, "Asia/Tokyo"), /04:30/);
});

test("cohérence des dates et paramètres validés", () => {
  const s = setup();
  assert.throws(() => normalize(s.base({ regClose: s.base().regOpen }), REWARDS), /ouvrir avant de fermer/);
  assert.throws(() => normalize(s.base({ confirmBy: s.base().start.replace(/T\d\d/, "T23") }), REWARDS), /avant le départ/);
  assert.throws(() => normalize(s.base({ teams: 12 }), REWARDS), /8, 16 ou 32/);
  assert.throws(() => normalize(s.base({ rewards: { winner: ["lingot"] } }), REWARDS), /Récompense inconnue/);
  assert.throws(() => normalize(s.base({ timeZone: "Mars/Olympus" }), REWARDS), /Fuseau/);
});

test("ouverture et fermeture programmées, inscriptions simultanées et limite de places", () => {
  const s = setup();
  const tour = s.tours.create(s.base());
  assert.throws(() => s.tours.register(tour.id, "p0"), /pas ouvertes/);
  s.advance(HOUR); // ouverture automatique, sans administrateur
  assert.equal(s.tours.stage(tour), "open");
  // 20 demandes « simultanées » pour 16 places : 16 inscrits, 4 en liste d'attente.
  for (let i = 0; i < 20; i++) s.tours.register(tour.id, "p" + i);
  const v = s.tours.view(tour, "p0");
  assert.deepEqual([v.places.used, v.places.capacity, v.places.waitlist], [16, 16, 4]);
  assert.equal(s.tours.view(tour, "p19").me.waitlist, true);
  assert.throws(() => s.tours.register(tour.id, "p0"), /déjà inscrit/);
  s.advance(4 * HOUR); // fermeture automatique
  assert.equal(s.tours.stage(tour), "closed");
  assert.throws(() => s.tours.register(tour.id, "p30"), /pas ouvertes/);
  // Confirmation d'inscription envoyée avec la date dans le fuseau de chacun.
  const paris = s.sent.find((m) => m.pid === "p0" && m.kind === "inscription");
  const ny = s.sent.find((m) => m.pid === "p1" && m.kind === "inscription");
  assert.match(paris.body, /19:00/);
  assert.match(ny.body, /13:00/);
});

test("solde minimum : seuil d’accès vérifié, aucun jeton prélevé", () => {
  const s = setup();
  s.db.players.p3.balance = 42000;
  const tour = s.tours.create(s.base());
  s.advance(HOUR);
  assert.throws(
    () => s.tours.register(tour.id, "p3"),
    (e) => e.code === "funds" && e.balance === 42000 && e.missing === 8000 && e.required === 50000,
  );
  s.tours.register(tour.id, "p4");
  assert.equal(s.db.players.p4.balance, 60000, "inscription gratuite");
  s.db.players.guest = { id: "guest", name: "Invité" };
  assert.throws(() => s.tours.register(tour.id, "guest"), /compte/);
  // Le solde est revérifié à la confirmation de présence.
  s.db.players.p4.balance = 1000;
  s.at(tour.start - 10 * MIN);
  assert.throws(() => s.tours.confirm(tour.id, "p4"), (e) => e.code === "funds");
});

test("désinscriptions, partenaire, liste d’attente et remplacement des absents", () => {
  const s = setup();
  const tour = s.tours.create(s.base());
  s.advance(HOUR);
  s.tours.register(tour.id, "p0", "p1"); // inscription à deux
  assert.equal(s.tours.view(tour, "p1").me.invitedBy, "J0");
  s.tours.answerPartner(tour.id, "p1", true);
  for (let i = 2; i < 18; i++) s.tours.register(tour.id, "p" + i);
  assert.equal(s.tours.view(tour, "p16").me.waitlist, true);
  // p5 se désinscrit : le premier de la liste d'attente prend la place et est prévenu.
  s.tours.unregister(tour.id, "p5");
  assert.equal(s.tours.view(tour, "p16").me.waitlist, false);
  assert.ok(s.sent.some((m) => m.pid === "p16" && m.kind === "place"));
  // Les désinscrits ne reçoivent plus de rappels.
  s.at(tour.start - HOUR);
  s.tours.tick();
  assert.ok(s.sent.some((m) => m.pid === "p0" && m.kind === "h1"));
  assert.ok(!s.sent.some((m) => m.pid === "p5" && m.kind === "h1"));
  // Présence : tous confirment sauf p2 ; p17 (liste d'attente) confirme et le remplace.
  s.at(tour.start - 14 * MIN);
  s.tours.tick();
  assert.ok(s.sent.some((m) => m.pid === "p17" && m.kind === "m15" && /remplacer/.test(m.body)));
  for (let i = 0; i < 18; i++) if (i !== 2 && i !== 5) s.tours.confirm(tour.id, "p" + i);
  s.at(tour.confirmBy);
  s.tours.tick();
  const teams = tour.teamsList;
  assert.equal(teams.length, 8);
  assert.ok(teams.some((t) => t.pids.join() === "p0,p1"), "le binôme reste ensemble");
  assert.ok(teams.flatMap((t) => t.pids).includes("p17"), "un remplaçant a pris la place de l’absent");
  assert.ok(!teams.flatMap((t) => t.pids).includes("p2"));
  assert.ok(s.sent.some((m) => m.pid === "p2" && m.kind === "absent"));
  assert.throws(() => s.tours.unregister(tour.id, "p3"), /formation/);
});

test("rappels, inscriptions tardives et changement de date", () => {
  const s = setup();
  const tour = s.tours.create(s.base());
  s.advance(HOUR);
  s.tours.register(tour.id, "p0");
  // L'administrateur reporte d'un jour : inscrits informés, rappels reprogrammés.
  s.tours.postpone(tour.id, utcToZoned(tour.start + 24 * HOUR, "Europe/Paris"));
  assert.ok(s.sent.some((m) => m.pid === "p0" && m.kind === "horaire" && /reporté/.test(m.title)));
  s.at(tour.start - 3 * HOUR);
  s.tours.tick();
  s.tours.tick();
  assert.equal(s.sent.filter((m) => m.pid === "p0" && m.kind === "hx" && /3 heures/.test(m.title)).length, 1);
  s.at(tour.start - HOUR);
  s.tours.tick();
  s.tours.tick(); // pas de doublon
  assert.equal(s.sent.filter((m) => m.pid === "p0" && m.kind === "h1").length, 1);
  // Inscription tardive (moins d'une heure avant) : pas de rappel « dans une heure ».
  tour.regClose = tour.start - 10 * MIN;
  s.at(tour.start - 20 * MIN);
  s.tours.register(tour.id, "p8");
  s.tours.tick();
  assert.ok(!s.sent.some((m) => m.pid === "p8" && m.kind === "h1"));
  // Un échec d'envoi ne bloque rien.
  s.db.players.p9.failPush = true;
  s.tours.register(tour.id, "p9");
  assert.ok(tour.log.some((l) => l.kind === "notification-echec"));
  // Annulation : tout le monde est prévenu, plus aucun rappel.
  s.tours.cancel(tour.id, "Salle indisponible");
  assert.ok(s.sent.some((m) => m.pid === "p0" && m.kind === "annulation"));
  const count = s.sent.length;
  s.at(tour.start - 10 * MIN);
  s.tours.tick();
  assert.equal(s.sent.length, count);
});

test("équipes insuffisantes : report puis annulation selon la règle choisie", () => {
  const s = setup();
  const tour = s.tours.create(s.base({ minTeams: 4, postponeMinutes: 30 }));
  s.advance(HOUR);
  for (let i = 0; i < 4; i++) s.tours.register(tour.id, "p" + i);
  s.at(tour.start - 10 * MIN);
  for (let i = 0; i < 4; i++) s.tours.confirm(tour.id, "p" + i);
  const start = tour.start;
  s.at(tour.confirmBy);
  s.tours.tick();
  assert.equal(tour.start, start + 30 * MIN, "report automatique");
  assert.equal(tour.status, "published");
  s.at(tour.confirmBy);
  s.tours.tick();
  s.at(tour.confirmBy);
  s.tours.tick();
  assert.equal(tour.status, "cancelled", "annulation après les reports permis");
  const s2 = setup();
  const t2 = s2.tours.create(s2.base({ minTeams: 4, insufficient: "cancel" }));
  s2.at(t2.confirmBy);
  s2.tours.tick();
  assert.equal(t2.status, "cancelled");
});

test("départ automatique sans administrateur, exemptions, progression jusqu’à la finale et récompenses uniques", () => {
  const s = setup();
  const tour = s.tours.create(s.base({ minTeams: 4, prizes: { winner: 1000, finalist: 300 } }));
  s.advance(HOUR);
  for (let i = 0; i < 12; i++) s.tours.register(tour.id, "p" + i); // 6 équipes pour un tableau de 8
  s.at(tour.start - 10 * MIN);
  for (let i = 0; i < 12; i++) s.tours.confirm(tour.id, "p" + i);
  s.at(tour.confirmBy);
  s.tours.tick();
  assert.equal(tour.teamsList.length, 6);
  s.at(tour.start);
  s.tours.tick();
  s.tours.tick(); // un second passage ne relance rien
  assert.equal(tour.status, "running");
  assert.equal(s.sent.filter((m) => m.kind === "depart").length, 12, "chaque joueur est prévenu du départ");
  assert.equal(tour.bracketSize, 8);
  assert.equal(Object.keys(s.tables).length, 2, "deux exemptions, deux tables");
  assert.equal(tour.rounds[0].filter((m) => m.status === "bye").length, 2);
  assert.ok(s.sent.some((m) => m.kind === "table" && m.title === "Votre table est prête, rejoignez la partie !"));
  // Forfait sur une table, victoire normale sur l'autre.
  const [t1, t2] = Object.keys(s.tables);
  s.tours.forfeit(t1, 1, "Absence prolongée de J3");
  s.tours.matchFinished(t2, 0, [1020, 840]);
  assert.equal(tour.rounds.length, 2, "les demi-finales démarrent");
  assert.ok(s.sent.some((m) => m.kind === "suivante"));
  playOut(s, tour);
  assert.equal(tour.status, "finished");
  const champ = tour.teamsList.find((t) => t.id === tour.champion);
  assert.deepEqual(
    s.awards.filter(([, r]) => r === "tournoi-vainqueur").map(([p]) => p).sort(),
    [...champ.pids].sort(),
  );
  assert.equal(s.awards.filter(([, r]) => r === "tournoi-participant").length, 12);
  assert.equal(s.awards.filter(([, r]) => r === "tournoi-finaliste").length, 4);
  const prizes = s.awards.filter(([, r]) => r === "prize");
  assert.deepEqual(prizes.filter((x) => x[2] === 1000).map(([p]) => p).sort(), [...champ.pids].sort());
  assert.equal(prizes.filter((x) => x[2] === 300).length, 2);
  assert.throws(() => s.tours.create(s.base({ prizes: { winner: -5 } })), /Enjeu invalide/);
  // Un second « fin » éventuel n'attribue rien de plus.
  const before = s.awards.length;
  s.tours.matchFinished("table-inconnue", 0, [0, 0]);
  s.tours.tick();
  assert.equal(s.awards.length, before);
  // Après le départ, les paramètres d'équité sont verrouillés.
  assert.throws(() => s.tours.postpone(tour.id, "2027-01-01T20:00"), /Report impossible/);
  assert.ok(tour.log.some((l) => l.kind === "depart") && tour.log.some((l) => l.kind === "fin"));
});

test("tableaux de 16 et 32 équipes jusqu’à la finale", () => {
  for (const size of [16, 32]) {
    const s = setup({ players: size * 2 });
    const tour = s.tours.create(s.base({ teams: size }));
    s.advance(HOUR);
    for (let i = 0; i < size * 2; i++) s.tours.register(tour.id, "p" + i);
    s.at(tour.start - 10 * MIN);
    for (let i = 0; i < size * 2; i++) s.tours.confirm(tour.id, "p" + i);
    s.at(tour.start);
    s.tours.tick();
    assert.equal(Object.keys(s.tables).length, size / 2);
    playOut(s, tour);
    assert.equal(tour.status, "finished");
    assert.equal(tour.rounds.length, Math.log2(size));
  }
});
