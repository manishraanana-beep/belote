// Tournois de belote contrée sur inscription : programmation, inscriptions, présence,
// formation des équipes, tableau à élimination directe, rappels et récompenses.
// Toute la logique est ici, pilotée par l'horloge du serveur (tick) : rien ne dépend
// d'un administrateur connecté. Le serveur fournit les « hooks » (tables, notifications…).
import { randomBytes, randomInt } from "node:crypto";

export const FORMATS = [8, 16, 32];
export const MIN = 60_000;
export const HOUR = 60 * MIN;
const CONFIRM_WINDOW = 15 * MIN; // ouverture de la confirmation de présence avant le départ
const MAX_POSTPONES = 2;
const id = () => randomBytes(8).toString("base64url");
const fail = (message, extra) => {
  throw Object.assign(Error(message), extra ?? {});
};
const check = (ok, message, extra) => ok || fail(message, extra);

// ———————————————————————— fuseaux horaires
export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return typeof tz === "string" && tz.length <= 64;
  } catch {
    return false;
  }
}
// Décalage (ms) du fuseau à l'instant ts : heure locale − heure UTC.
function offset(ts, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(ts)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ts / 1000) * 1000;
}
// « 2026-11-14T20:30 » dans le fuseau tz → instant UTC (gère les changements d'heure).
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local ?? "");
  check(m, "Date invalide (format AAAA-MM-JJTHH:MM)");
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const o1 = offset(guess, tz);
  let ts = guess - o1;
  const o2 = offset(ts, tz);
  if (o2 !== o1) ts = guess - o2;
  return ts;
}
export function utcToZoned(ts, tz) {
  const d = new Date(ts + offset(ts, tz));
  return d.toISOString().slice(0, 16);
}
export function formatWhen(ts, tz) {
  const zone = validTimeZone(tz) ? tz : "Europe/Paris";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(ts);
}

// ———————————————————————— configuration saisie par l'administration
const LOCKED_AFTER_START = ["teams", "minBalance", "rules", "start", "regOpen", "regClose", "confirmBy", "minTeams", "reconnectSeconds", "forfeitSeconds"];
export function normalize(input, rewardIds) {
  const d = input ?? {};
  const name = String(d.name ?? "").trim().slice(0, 60);
  check(name.length >= 3, "Nom du tournoi trop court");
  const timeZone = d.timeZone || "Europe/Paris";
  check(validTimeZone(timeZone), "Fuseau horaire inconnu");
  const teams = Number(d.teams);
  check(FORMATS.includes(teams), "Format : 8, 16 ou 32 équipes");
  const minBalance = Number(d.minBalance ?? 50000);
  check(Number.isInteger(minBalance) && minBalance >= 0 && minBalance <= 10_000_000, "Seuil de jetons invalide");
  const r = d.rules ?? {};
  const rules = { target: Number(r.target ?? 1000), turnSeconds: Number(r.turnSeconds ?? 20), flyingCounter: r.flyingCounter !== false };
  check(Number.isInteger(rules.target) && rules.target >= 100 && rules.target <= 5000, "Score cible invalide");
  check(Number.isInteger(rules.turnSeconds) && rules.turnSeconds >= 10 && rules.turnSeconds <= 120, "Temps par tour invalide");
  const rw = d.rewards ?? {};
  const rewards = {};
  for (const k of ["winner", "finalist", "participant"]) {
    rewards[k] = [...new Set(Array.isArray(rw[k]) ? rw[k] : [])];
    for (const x of rewards[k]) check(rewardIds.includes(x), "Récompense inconnue");
  }
  // Enjeux en crédits (offerts par la Maison, aucun droit d'entrée).
  const pz = d.prizes ?? {};
  const prizes = {};
  for (const k of ["winner", "finalist"]) {
    prizes[k] = Number(pz[k] ?? 0);
    check(Number.isInteger(prizes[k]) && prizes[k] >= 0 && prizes[k] <= 1_000_000, "Enjeu invalide");
  }
  const insufficient = d.insufficient === "cancel" ? "cancel" : "postpone";
  const postponeMinutes = Number(d.postponeMinutes ?? 30);
  check(Number.isInteger(postponeMinutes) && postponeMinutes >= 5 && postponeMinutes <= 7 * 24 * 60, "Délai de report invalide");
  const minTeams = Number(d.minTeams ?? teams);
  check(Number.isInteger(minTeams) && minTeams >= 2 && minTeams <= teams, "Nombre minimum d’équipes invalide");
  const reconnectSeconds = Number(d.reconnectSeconds ?? 120);
  check(Number.isInteger(reconnectSeconds) && reconnectSeconds >= 30 && reconnectSeconds <= 600, "Délai de reconnexion invalide");
  const forfeitSeconds = Number(d.forfeitSeconds ?? 300);
  check(Number.isInteger(forfeitSeconds) && forfeitSeconds >= reconnectSeconds && forfeitSeconds <= 1800, "Le forfait doit suivre le délai de reconnexion");
  const t = {
    start: zonedToUtc(d.start, timeZone),
    regOpen: zonedToUtc(d.regOpen, timeZone),
    regClose: zonedToUtc(d.regClose, timeZone),
    confirmBy: zonedToUtc(d.confirmBy, timeZone),
  };
  // Cohérence : ouverture < fermeture ≤ échéance de présence ≤ départ.
  check(t.regOpen < t.regClose, "Les inscriptions doivent ouvrir avant de fermer");
  check(t.regClose <= t.confirmBy, "La confirmation de présence se termine après la fermeture des inscriptions");
  check(t.confirmBy <= t.start, "La confirmation de présence se termine avant le départ");
  check(t.start - t.confirmBy <= 2 * HOUR, "Confirmation de présence trop éloignée du départ (2 h au plus)");
  return {
    name,
    description: String(d.description ?? "").trim().slice(0, 400),
    timeZone,
    teams,
    minBalance,
    rules,
    rewards,
    prizes,
    insufficient,
    postponeMinutes,
    minTeams,
    reconnectSeconds,
    forfeitSeconds,
    ...t,
  };
}

export function createTournaments({ db, now = () => Date.now(), hooks, rewardIds = [] }) {
  db.tournaments ??= {};
  const all = () => Object.values(db.tournaments);
  const log = (tour, kind, detail = {}, by = "système") => tour.log.push({ at: now(), kind, by, ...detail });
  const player = (pid) => db.players[pid];
  const name = (pid) => player(pid)?.name ?? "Joueur";
  const confirmOpen = (tour) => Math.min(tour.start - CONFIRM_WINDOW, tour.confirmBy - 5 * MIN);

  // ———————————————— états
  function stage(tour, t = now()) {
    if (tour.status !== "published") return tour.status; // draft, running, finished, cancelled
    if (t < tour.regOpen) return "soon";
    if (t < tour.regClose) return "open";
    if (!tour.formedAt) return "closed";
    return "ready";
  }
  function regOf(tour, pid) {
    return tour.regs.find((r) => r.pids.includes(pid) || r.pendingPartner === pid);
  }
  const used = (tour) => tour.regs.filter((r) => !r.waitlist).reduce((a, r) => a + r.pids.length + (r.pendingPartner ? 1 : 0), 0);
  const capacity = (tour) => tour.teams * 2;
  const registered = (tour) => tour.regs.flatMap((r) => r.pids);

  // ———————————————— notifications (dédoublonnées, jamais bloquantes)
  function notify(tour, pids, kind, title, body, extra = {}) {
    for (const pid of pids) {
      const key = `${kind}:${tour.schedVersion}:${extra.match ?? ""}:${pid}`;
      if (tour.sent[key]) continue;
      tour.sent[key] = now();
      try {
        hooks.notify(pid, { title, body, kind, tournament: tour.id, url: `/?tournoi=${tour.id}`, ...extra });
      } catch (e) {
        log(tour, "notification-echec", { pid, error: String(e.message ?? e) });
      }
    }
  }
  const whenFor = (tour, pid) => formatWhen(tour.start, player(pid)?.timeZone || tour.timeZone);

  // ———————————————— administration
  function create(input, by = "admin") {
    const cfg = normalize(input, rewardIds);
    const tour = {
      id: id(),
      ...cfg,
      status: input.publish ? "published" : "draft",
      regs: [],
      confirmed: {},
      teamsList: null,
      rounds: null,
      formedAt: null,
      sent: {},
      schedVersion: 1,
      postpones: 0,
      log: [],
      createdAt: now(),
      rewarded: {},
    };
    db.tournaments[tour.id] = tour;
    log(tour, input.publish ? "publication" : "brouillon", {}, by);
    return tour;
  }
  function update(tid, input, by = "admin") {
    const tour = db.tournaments[tid];
    check(tour, "Tournoi introuvable");
    check(!["finished", "cancelled"].includes(tour.status), "Tournoi clos : modification impossible");
    if (tour.status === "running") {
      // Après le départ, seuls les textes restent modifiables.
      tour.name = String(input.name ?? tour.name).trim().slice(0, 60) || tour.name;
      tour.description = String(input.description ?? tour.description).slice(0, 400);
      log(tour, "modification", { locked: LOCKED_AFTER_START }, by);
      return tour;
    }
    check(!tour.formedAt, "Équipes déjà formées : seuls le report ou l’annulation sont possibles");
    const cfg = normalize({ ...input }, rewardIds);
    check(cfg.teams * 2 >= used(tour), "Moins de places que d’inscrits : réduisez d’abord les inscriptions");
    const moved = ["start", "regOpen", "regClose", "confirmBy"].some((k) => cfg[k] !== tour[k]);
    Object.assign(tour, cfg);
    if (input.publish && tour.status === "draft") {
      tour.status = "published";
      log(tour, "publication", {}, by);
    }
    log(tour, "modification", { moved }, by);
    if (moved) rescheduled(tour, "Nouvel horaire");
    return tour;
  }
  // Changement d'horaire : rappels reprogrammés (nouvelle version) et inscrits informés.
  function rescheduled(tour, label) {
    tour.schedVersion++;
    tour.confirmed = {};
    if (tour.status !== "published") return;
    for (const pid of registered(tour)) notify(tour, [pid], "horaire", `${tour.name} : ${label.toLowerCase()}`, `${label} : ${whenFor(tour, pid)}.`);
  }
  function postpone(tid, startLocal, by = "admin") {
    const tour = db.tournaments[tid];
    check(tour && ["published", "draft"].includes(tour.status), "Report impossible");
    check(!tour.formedAt || now() < tour.start, "Tournoi déjà lancé");
    const start = zonedToUtc(startLocal, tour.timeZone);
    const delta = start - tour.start;
    check(delta > 0, "Choisissez une date plus tardive");
    shift(tour, delta);
    log(tour, "report", { start }, by);
    rescheduled(tour, "Tournoi reporté");
    return tour;
  }
  function shift(tour, delta) {
    for (const k of ["start", "regOpen", "regClose", "confirmBy"]) tour[k] += delta;
    // Les inscriptions déjà fermées le restent jusqu'au nouvel horaire de fermeture.
    tour.formedAt = null;
    tour.teamsList = null;
    tour.rounds = null;
  }
  function cancel(tid, reason = "Annulé par l’organisateur", by = "admin") {
    const tour = db.tournaments[tid];
    check(tour && !["finished", "cancelled", "running"].includes(tour.status), "Annulation impossible");
    const wasPublished = tour.status === "published";
    tour.status = "cancelled";
    tour.cancelReason = reason;
    log(tour, "annulation", { reason }, by);
    if (wasPublished) for (const pid of registered(tour)) notify(tour, [pid], "annulation", `${tour.name} annulé`, reason);
    return tour;
  }
  function duplicate(tid, by = "admin") {
    const src = db.tournaments[tid];
    check(src, "Tournoi introuvable");
    const copy = create(
      {
        ...src,
        name: `${src.name} (copie)`.slice(0, 60),
        start: utcToZoned(src.start, src.timeZone),
        regOpen: utcToZoned(src.regOpen, src.timeZone),
        regClose: utcToZoned(src.regClose, src.timeZone),
        confirmBy: utcToZoned(src.confirmBy, src.timeZone),
        publish: false,
      },
      by,
    );
    log(copy, "duplication", { from: src.id }, by);
    return copy;
  }

  // ———————————————— joueurs
  function eligible(tour, p) {
    const available = hooks.available(p); // en crédits
    if (available < tour.minBalance)
      fail(`Solde insuffisant : ${tour.minBalance} jetons minimum`, { code: "funds", balance: available, missing: tour.minBalance - available, required: tour.minBalance });
  }
  function lateReminders(tour, pid) {
    const t = now();
    if (t >= tour.start - HOUR) tour.sent[`h1:${tour.schedVersion}::${pid}`] = t; // trop tard pour le rappel d'une heure
    if (t >= confirmOpen(tour) && t < tour.confirmBy) confirmInvite(tour, [pid]);
  }
  function registerIn(tour, p, partnerId) {
    check(tour, "Tournoi introuvable");
    check(stage(tour) === "open", "Les inscriptions ne sont pas ouvertes");
    check(p?.accountId, "Créez un compte pour vous inscrire");
    check(!regOf(tour, p.id), "Vous êtes déjà inscrit");
    eligible(tour, p);
    let partner = null;
    if (partnerId) {
      partner = player(partnerId);
      check(partner && partner.id !== p.id, "Partenaire introuvable");
      check(partner.accountId, "Votre partenaire doit avoir un compte");
      check(!regOf(tour, partner.id), "Votre partenaire est déjà inscrit");
    }
    const need = partner ? 2 : 1;
    const reg = { id: id(), pids: [p.id], pendingPartner: partner?.id ?? null, at: now(), waitlist: used(tour) + need > capacity(tour) };
    tour.regs.push(reg);
    log(tour, "inscription", { pid: p.id, partner: partner?.id, waitlist: reg.waitlist }, p.id);
    notify(tour, [p.id], "inscription", reg.waitlist ? `${tour.name} : liste d’attente` : `Inscription confirmée : ${tour.name}`, `${reg.waitlist ? "Vous êtes en liste d’attente. " : ""}Départ ${whenFor(tour, p.id)}.`);
    if (partner) notify(tour, [partner.id], "partenaire", `${p.name} vous propose de faire équipe`, `${tour.name}, ${whenFor(tour, partner.id)}. Ouvrez le tournoi pour accepter.`);
    lateReminders(tour, p.id);
    return reg;
  }
  function answerPartner(tid, pid, accept) {
    const tour = db.tournaments[tid];
    check(tour && stage(tour) === "open", "Les inscriptions sont fermées");
    const reg = tour.regs.find((r) => r.pendingPartner === pid);
    check(reg, "Aucune proposition en attente");
    reg.pendingPartner = null;
    if (accept) {
      eligible(tour, player(pid));
      reg.pids.push(pid);
      log(tour, "partenaire-accepte", { pid }, pid);
      notify(tour, [pid], "inscription", `Inscription confirmée : ${tour.name}`, `En équipe avec ${name(reg.pids[0])}. Départ ${whenFor(tour, pid)}.`);
      notify(tour, [reg.pids[0]], "partenaire-ok", `${name(pid)} fait équipe avec vous`, tour.name);
      lateReminders(tour, pid);
    } else {
      log(tour, "partenaire-refuse", { pid }, pid);
      notify(tour, [reg.pids[0]], "partenaire-non", `${name(pid)} a décliné`, `Vous restez inscrit seul à ${tour.name} : une équipe vous sera proposée.`);
      promote(tour);
    }
  }
  function unregister(tid, pid) {
    const tour = db.tournaments[tid];
    check(tour, "Tournoi introuvable");
    check(["soon", "open", "closed"].includes(stage(tour)), "Désinscription impossible après la formation des équipes");
    const reg = regOf(tour, pid);
    check(reg, "Vous n’êtes pas inscrit");
    if (reg.pendingPartner === pid) reg.pendingPartner = null;
    else {
      reg.pids = reg.pids.filter((x) => x !== pid);
      if (!reg.pids.length) {
        // Le partenaire invité redevient libre ; l'inscription disparaît.
        tour.regs = tour.regs.filter((r) => r !== reg);
      }
    }
    delete tour.confirmed[pid];
    log(tour, "desinscription", { pid }, pid);
    promote(tour);
  }
  // Liste d'attente : les premières inscriptions qui tiennent dans les places libres montent.
  function promote(tour) {
    for (const r of tour.regs) {
      if (!r.waitlist) continue;
      const need = r.pids.length + (r.pendingPartner ? 1 : 0);
      if (used(tour) + need > capacity(tour)) continue;
      r.waitlist = false;
      log(tour, "liste-attente-promue", { reg: r.id });
      for (const pid of r.pids) notify(tour, [pid], "place", `Une place s’est libérée : ${tour.name}`, `Vous êtes inscrit. Départ ${whenFor(tour, pid)}.`);
    }
  }
  function confirm(tid, pid) {
    const tour = db.tournaments[tid];
    check(tour && tour.status === "published", "Tournoi indisponible");
    const t = now();
    check(t >= confirmOpen(tour), "La confirmation ouvrira 15 minutes avant le départ");
    check(t < tour.confirmBy, "L’échéance de confirmation est passée");
    const reg = regOf(tour, pid);
    check(reg && reg.pids.includes(pid), "Vous n’êtes pas inscrit");
    eligible(tour, player(pid));
    tour.confirmed[pid] = t;
    log(tour, "presence", { pid }, pid);
  }
  function confirmInvite(tour, pids) {
    for (const pid of pids) {
      const reg = regOf(tour, pid);
      notify(tour, [pid], "m15", `${tour.name} : confirmez votre présence`, reg?.waitlist ? "Liste d’attente : confirmez pour remplacer un absent." : `Avant ${new Intl.DateTimeFormat("fr-FR", { timeZone: player(pid)?.timeZone || tour.timeZone, hour: "2-digit", minute: "2-digit" }).format(tour.confirmBy)}, sinon votre place sera libérée.`);
    }
  }

  // ———————————————— formation des équipes et tableau
  function form(tour) {
    const singles = [];
    const teams = [];
    const excluded = [];
    const take = (regs) => {
      for (const r of regs) {
        const ok = r.pids.filter((pid) => tour.confirmed[pid]);
        if (teams.length * 2 + singles.length + ok.length > capacity(tour)) {
          excluded.push(...ok);
          continue;
        }
        if (ok.length === 2) teams.push({ id: id(), pids: ok });
        else if (ok.length === 1) singles.push(ok[0]);
      }
    };
    take(tour.regs.filter((r) => !r.waitlist));
    take(tour.regs.filter((r) => r.waitlist)); // remplaçants confirmés, dans l'ordre d'inscription
    while (singles.length >= 2 && teams.length < tour.teams) teams.push({ id: id(), pids: singles.splice(0, 2), formed: true });
    excluded.push(...singles);
    const absent = registered(tour).filter((pid) => !tour.confirmed[pid]);
    if (teams.length < tour.minTeams) {
      log(tour, "equipes-insuffisantes", { teams: teams.length });
      if (tour.insufficient === "postpone" && tour.postpones < MAX_POSTPONES) {
        tour.postpones++;
        shift(tour, tour.postponeMinutes * MIN);
        log(tour, "report-automatique", { start: tour.start });
        rescheduled(tour, "Équipes insuffisantes, tournoi reporté");
      } else {
        tour.status = "cancelled";
        tour.cancelReason = "Nombre d’équipes insuffisant";
        log(tour, "annulation", { reason: tour.cancelReason });
        for (const pid of registered(tour)) notify(tour, [pid], "annulation", `${tour.name} annulé`, "Nombre d’équipes insuffisant.");
      }
      return false;
    }
    for (const t of teams) t.name = t.pids.map(name).join(" & ");
    // Tirage au sort du tableau (aléa cryptographique) ; les places vides sont des exemptions.
    for (let i = teams.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [teams[i], teams[j]] = [teams[j], teams[i]];
    }
    // Tableau réduit à la puissance de deux suffisante (8 équipes inscrites sur 16 : quarts de finale).
    let size = 2;
    while (size < teams.length) size *= 2;
    tour.bracketSize = size;
    const slots = [...teams, ...Array(size - teams.length).fill(null)];
    const first = [];
    for (let i = 0; i < size / 2; i++) first.push(match(0, slots[i]?.id ?? null, slots[size - 1 - i]?.id ?? null));
    tour.teamsList = teams;
    tour.rounds = [first];
    tour.formedAt = now();
    log(tour, "equipes-formees", { teams: teams.length, excluded, absent });
    for (const pid of excluded) notify(tour, [pid], "exclu", `${tour.name} : pas de place`, "Aucune place ou aucun partenaire disponible pour former une équipe. Désolé !");
    for (const pid of absent) notify(tour, [pid], "absent", `${tour.name} : présence non confirmée`, "Votre place a été libérée.");
    return true;
  }
  const match = (round, a, b) => ({ id: id(), round, a, b, status: "waiting", tableId: null, winner: null, score: null });
  const team = (tour, tid) => tour.teamsList?.find((t) => t.id === tid);

  function launch(tour) {
    tour.status = "running"; // écrit avant tout effet : pas de double lancement
    tour.startedAt = now();
    log(tour, "depart");
    launchRound(tour, 0);
  }
  function launchRound(tour, r) {
    for (const m of tour.rounds[r]) {
      if (m.status !== "waiting") continue;
      if (m.a && m.b) {
        m.status = "playing";
        m.startedAt = now();
        try {
          m.tableId = hooks.launchMatch(tour, m, team(tour, m.a), team(tour, m.b));
        } catch (e) {
          log(tour, "table-echec", { match: m.id, error: String(e.message ?? e) });
          throw e;
        }
        for (const x of [m.a, m.b]) {
          // Première rencontre de l'équipe (après une éventuelle exemption) ou tour suivant.
          const first = !tour.rounds.some((round) => round.some((o) => o !== m && (o.a === x || o.b === x) && ["done", "forfeit"].includes(o.status)));
          notify(tour, team(tour, x).pids, first ? "table" : "suivante", first ? "Votre table est prête, rejoignez la partie !" : `${roundName(tour, r)} : votre table est prête !`, tour.name, { match: m.id, url: `/?tournoi=${tour.id}` });
        }
      } else {
        m.status = m.a || m.b ? "bye" : "empty";
        m.winner = m.a ?? m.b ?? null;
      }
    }
    advance(tour);
  }
  function roundName(tour, r) {
    const left = (tour.bracketSize ?? tour.teams) / 2 ** r;
    return left === 2 ? "Finale" : left === 4 ? "Demi-finales" : left === 8 ? "Quarts de finale" : left === 16 ? "Huitièmes de finale" : "Seizièmes de finale";
  }
  function advance(tour) {
    const r = tour.rounds.length - 1;
    const round = tour.rounds[r];
    if (round.some((m) => ["waiting", "playing"].includes(m.status))) return;
    if (round.length === 1) return finish(tour, round[0].winner);
    const next = [];
    for (let i = 0; i < round.length; i += 2) next.push(match(r + 1, round[i].winner, round[i + 1].winner));
    tour.rounds.push(next);
    log(tour, "tour-suivant", { round: r + 1 });
    launchRound(tour, r + 1);
  }
  function findMatch(tableId) {
    for (const tour of all()) {
      if (tour.status !== "running") continue;
      for (const round of tour.rounds) for (const m of round) if (m.tableId === tableId && m.status === "playing") return { tour, m };
    }
    return null;
  }
  // Fin normale d'une rencontre : l'équipe aux places paires (0 et 2) est l'équipe « a ».
  function matchFinished(tableId, winParity, scores) {
    const f = findMatch(tableId);
    if (!f) return null;
    const { tour, m } = f;
    m.status = "done";
    m.winner = winParity === 0 ? m.a : m.b;
    m.score = scores;
    m.endedAt = now();
    log(tour, "resultat", { match: m.id, winner: m.winner, scores });
    const loser = team(tour, winParity === 0 ? m.b : m.a);
    notify(tour, loser.pids, "elimine", `${tour.name} : fin du parcours`, `Bravo pour ce ${roundName(tour, m.round).toLowerCase()} !`, { match: m.id });
    advance(tour);
    return { tour, m };
  }
  // Forfait (absence prolongée ou abandon) : l'équipe fautive perd la rencontre.
  function forfeit(tableId, loserParity, reason) {
    const f = findMatch(tableId);
    if (!f) return null;
    const { tour, m } = f;
    m.status = "forfeit";
    m.winner = loserParity === 0 ? m.b : m.a;
    m.forfeit = reason;
    m.endedAt = now();
    log(tour, "forfait", { match: m.id, loser: loserParity === 0 ? m.a : m.b, reason });
    const loser = team(tour, loserParity === 0 ? m.a : m.b),
      winner = team(tour, m.winner);
    notify(tour, loser.pids, "forfait", `${tour.name} : défaite par forfait`, reason, { match: m.id });
    notify(tour, winner.pids, "forfait-gagne", `${tour.name} : victoire par forfait`, reason, { match: m.id });
    hooks.endTable?.(tableId);
    advance(tour);
    return { tour, m };
  }
  function finish(tour, winnerId) {
    if (tour.status === "finished") return;
    tour.status = "finished";
    tour.finishedAt = now();
    tour.champion = winnerId;
    const final = tour.rounds.at(-1)[0];
    log(tour, "fin", { champion: winnerId });
    // Récompenses : une seule attribution par joueur et par catégorie, même en cas de relance.
    const give = (pids, kind) => {
      for (const pid of pids)
        for (const reward of tour.rewards[kind]) {
          const key = `${kind}:${reward}:${pid}`;
          if (tour.rewarded[key]) continue;
          tour.rewarded[key] = now();
          const p = player(pid);
          if (p) hooks.award(p, reward);
        }
    };
    give(tour.teamsList.flatMap((t) => t.pids), "participant");
    give([final.a, final.b].filter(Boolean).flatMap((x) => team(tour, x).pids), "finalist");
    if (winnerId) give(team(tour, winnerId).pids, "winner");
    // Enjeux : le vainqueur reçoit le premier prix, l'équipe finaliste battue le second.
    tour.prizes ??= { winner: 0, finalist: 0 };
    const pay = (pids, kind) => {
      for (const pid of pids) {
        const p = player(pid);
        if (p && tour.prizes[kind] > 0) hooks.prize?.(p, tour.prizes[kind], `tournoi:${tour.id}:${kind}:${pid}`, tour.name);
      }
    };
    if (winnerId) {
      pay(team(tour, winnerId).pids, "winner");
      const loser = [final.a, final.b].find((x) => x && x !== winnerId);
      if (loser) pay(team(tour, loser).pids, "finalist");
    }
    const champ = winnerId ? team(tour, winnerId) : null;
    for (const t of tour.teamsList) notify(tour, t.pids, "fin", `${tour.name} : ${champ ? `victoire de ${champ.name}` : "terminé"}`, t.id === winnerId ? "Félicitations, vous remportez le tournoi !" : "Merci pour votre participation.");
  }

  // ———————————————— horloge
  function tick() {
    const t = now();
    for (const tour of all()) {
      if (tour.status !== "published") continue;
      if (t >= tour.start - HOUR && t < tour.start)
        for (const pid of registered(tour)) notify(tour, [pid], "h1", `${tour.name} : départ dans une heure`, `Départ ${whenFor(tour, pid)}.`);
      if (t >= confirmOpen(tour) && t < tour.confirmBy) confirmInvite(tour, registered(tour));
      if (t >= tour.confirmBy && !tour.formedAt && !form(tour)) continue;
      if (t >= tour.start && tour.formedAt && tour.status === "published") launch(tour);
    }
  }

  // ———————————————— vues
  function teamView(tour, tid, pid) {
    const tm = team(tour, tid);
    if (!tm) return null;
    return { id: tm.id, name: tm.name, avatars: tm.pids.map((x) => player(x)?.avatar), mine: tm.pids.includes(pid) };
  }
  function view(tour, pid, admin = false) {
    const reg = regOf(tour, pid);
    const mine = tour.teamsList?.find((x) => x.pids.includes(pid));
    let next = null;
    if (mine && tour.rounds) {
      for (const round of tour.rounds)
        for (const m of round)
          if ((m.a === mine.id || m.b === mine.id) && ["waiting", "playing"].includes(m.status)) next = { id: m.id, status: m.status, tableId: m.tableId, round: roundName(tour, m.round), against: teamView(tour, m.a === mine.id ? m.b : m.a, pid) };
    }
    return {
      id: tour.id,
      name: tour.name,
      description: tour.description,
      status: tour.status,
      stage: stage(tour),
      start: tour.start,
      regOpen: tour.regOpen,
      regClose: tour.regClose,
      confirmOpen: confirmOpen(tour),
      confirmBy: tour.confirmBy,
      timeZone: tour.timeZone,
      teams: tour.teams,
      minTeams: tour.minTeams,
      minBalance: tour.minBalance,
      rules: { ...tour.rules, reconnectSeconds: tour.reconnectSeconds, forfeitSeconds: tour.forfeitSeconds },
      rewards: tour.rewards,
      prizes: tour.prizes ?? { winner: 0, finalist: 0 },
      insufficient: tour.insufficient,
      postponeMinutes: tour.postponeMinutes,
      places: { used: used(tour), capacity: capacity(tour), waitlist: tour.regs.filter((r) => r.waitlist).reduce((a, r) => a + r.pids.length, 0) },
      ready: tour.regs.filter((r) => !r.waitlist && r.pids.length === 2 && r.pids.every((x) => tour.confirmed[x])).length,
      confirmedCount: Object.keys(tour.confirmed).length,
      me: reg
        ? {
            waitlist: reg.waitlist,
            partner: reg.pids.length === 2 ? name(reg.pids.find((x) => x !== pid)) : reg.pendingPartner && reg.pendingPartner !== pid ? `${name(reg.pendingPartner)} (en attente)` : null,
            invitedBy: reg.pendingPartner === pid ? name(reg.pids[0]) : null,
            confirmed: !!tour.confirmed[pid],
          }
        : null,
      myTeam: mine ? teamView(tour, mine.id, pid) : null,
      next,
      champion: tour.champion ? teamView(tour, tour.champion, pid) : null,
      rounds: tour.rounds?.map((round, r) => ({
        name: roundName(tour, r),
        matches: round.map((m) => ({ id: m.id, status: m.status, a: teamView(tour, m.a, pid), b: teamView(tour, m.b, pid), winner: m.winner, score: m.score, forfeit: m.forfeit ?? null, tableId: m.tableId })),
      })),
      cancelReason: tour.cancelReason ?? null,
      ...(admin
        ? {
            local: Object.fromEntries(["start", "regOpen", "regClose", "confirmBy"].map((k) => [k, utcToZoned(tour[k], tour.timeZone)])),
            regs: tour.regs.map((r) => ({ ...r, names: r.pids.map(name), partnerName: r.pendingPartner ? name(r.pendingPartner) : null, confirmed: r.pids.filter((x) => tour.confirmed[x]) })),
            log: tour.log.slice(-80),
          }
        : {}),
    };
  }
  function list(pid) {
    return all()
      .filter((t) => t.status !== "draft" && !(t.status === "cancelled" && !regOf(t, pid) && now() - t.start > 2 * HOUR) && !(t.status === "finished" && now() - (t.finishedAt ?? 0) > 7 * 24 * HOUR))
      .sort((a, b) => a.start - b.start)
      .map((t) => view(t, pid));
  }

  return {
    create,
    update,
    postpone,
    cancel,
    duplicate,
    publish: (tid, by) => update(tid, { ...utcInput(db.tournaments[tid]), publish: true }, by),
    register: (tid, pid, partner) => registerIn(db.tournaments[tid], player(pid), partner),
    answerPartner,
    unregister,
    confirm,
    tick,
    matchFinished,
    forfeit,
    isTournamentTable: (tableId) => !!findMatch(tableId),
    view,
    list,
    stage,
    adminList: () => all().sort((a, b) => a.start - b.start).map((t) => view(t, null, true)),
  };
  function utcInput(tour) {
    check(tour, "Tournoi introuvable");
    return { ...tour, start: utcToZoned(tour.start, tour.timeZone), regOpen: utcToZoned(tour.regOpen, tour.timeZone), regClose: utcToZoned(tour.regClose, tour.timeZone), confirmBy: utcToZoned(tour.confirmBy, tour.timeZone) };
  }
}
