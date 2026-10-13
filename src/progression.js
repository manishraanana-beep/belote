// Progression d'activité : expérience, niveaux, badges, défis quotidiens et collection.
// Indépendante du portefeuille : perdre des crédits ne fait jamais perdre un niveau.
// Le niveau récompense la participation ; il n'indique pas la force d'un joueur.
import { dayId, nextReset, toUnits } from "./economy.js";

export const LEVELS = [
  { name: "Débutant", xp: 0 },
  { name: "Habitué", xp: 400 },
  { name: "Confirmé", xp: 1500 },
  { name: "Expert", xp: 4000 },
  { name: "Pilier du salon", xp: 10000 },
];
export const XP = { finished: 60, win: 30, rubicon: 20, perDeal: 4, practiceFactor: 0.5 };

export const BADGES = [
  { id: "first-game", icon: "🎴", name: "Première partie", hint: "Terminer une partie" },
  { id: "first-win", icon: "🏅", name: "Première victoire", hint: "Gagner une partie" },
  { id: "games-10", icon: "🔟", name: "Dix parties", hint: "Terminer dix parties" },
  { id: "games-50", icon: "🎖️", name: "Cinquante parties", hint: "Terminer cinquante parties" },
  { id: "first-rubicon", icon: "🌊", name: "Premier rubicon", hint: "Gagner une partie en rubicon" },
  { id: "capot", icon: "💥", name: "Capot !", hint: "Réussir un capot" },
  { id: "contreur", icon: "⚡", name: "Contreur", hint: "Faire chuter un contrat que vous avez contré" },
  { id: "vip-host", icon: "👑", name: "Hôte VIP", hint: "Terminer une partie dans votre table VIP" },
  // Récompenses de tournoi : attribuées une seule fois, annoncées avant l'inscription.
  { id: "tournoi-participant", icon: "🎟️", name: "Tournoyeur", hint: "Disputer un tournoi", reward: true },
  { id: "tournoi-finaliste", icon: "🥈", name: "Finaliste", hint: "Atteindre la finale d’un tournoi", reward: true },
  { id: "tournoi-vainqueur", icon: "🏆", name: "Champion de tournoi", hint: "Remporter un tournoi", reward: true },
];

// Collection purement visuelle. Le dos de cartes et le décor ne s'appliquent qu'à votre écran.
export const COSMETICS = [
  { id: "frame-none", kind: "frame", name: "Sans cadre", unlock: { type: "free" } },
  { id: "frame-or", kind: "frame", name: "Cadre doré", unlock: { type: "level", value: 1, label: "Niveau Habitué" } },
  { id: "frame-fleurs", kind: "frame", name: "Couronne de fleurs", unlock: { type: "badge", value: "first-win", label: "Badge Première victoire" } },
  { id: "frame-neon", kind: "frame", name: "Néon menthe", unlock: { type: "level", value: 2, label: "Niveau Confirmé" } },
  { id: "frame-couronne", kind: "frame", name: "Couronne VIP", unlock: { type: "badge", value: "vip-host", label: "Badge Hôte VIP" } },
  { id: "frame-fete", kind: "frame", name: "Confettis", unlock: { type: "event", value: "fete", label: "Événement festif" } },
  { id: "back-prune", kind: "back", name: "Prune classique", unlock: { type: "free" } },
  { id: "back-menthe", kind: "back", name: "Menthe à l’eau", unlock: { type: "challenge", value: "practice1", label: "Défi entraînement" } },
  { id: "back-soleil", kind: "back", name: "Soleil", unlock: { type: "badge", value: "games-10", label: "Badge Dix parties" } },
  { id: "back-nuit", kind: "back", name: "Nuit étoilée", unlock: { type: "level", value: 3, label: "Niveau Expert" } },
  { id: "felt-emeraude", kind: "felt", name: "Émeraude", unlock: { type: "free" } },
  { id: "felt-ocean", kind: "felt", name: "Océan", unlock: { type: "level", value: 1, label: "Niveau Habitué" } },
  { id: "felt-bordeaux", kind: "felt", name: "Bordeaux", unlock: { type: "badge", value: "first-rubicon", label: "Badge Premier rubicon" } },
  { id: "felt-lagon", kind: "felt", name: "Lagon", unlock: { type: "badge", value: "games-50", label: "Badge Cinquante parties" } },
  { id: "frame-champion", kind: "frame", name: "Couronne de champion", unlock: { type: "tournament", label: "Exclusif tournoi" } },
  { id: "back-velours", kind: "back", name: "Velours VIP", unlock: { type: "tournament", label: "Exclusif tournoi" } },
  { id: "felt-velours", kind: "felt", name: "Velours violet", unlock: { type: "tournament", label: "Exclusif tournoi" } },
];
// Récompenses proposables pour un tournoi (badges ou objets exclusifs).
export const TOURNAMENT_REWARDS = [
  ...BADGES.filter((b) => b.reward).map((b) => ({ id: b.id, kind: "badge", name: `${b.icon} ${b.name}` })),
  ...COSMETICS.filter((c) => c.unlock.type === "tournament").map((c) => ({ id: c.id, kind: c.kind, name: c.name })),
];

export function challengesConfig(env = process.env) {
  let list = [
    { id: "play3", label: "Terminer trois parties", goal: 3, reward: { credits: 150, xp: 50 } },
    { id: "win1", label: "Gagner une partie", goal: 1, reward: { credits: 100, xp: 40 } },
    { id: "practice1", label: "Terminer une partie d’entraînement", goal: 1, reward: { xp: 30, cosmetic: "back-menthe" } },
  ];
  try {
    if (env.BELOTE_CHALLENGES) list = JSON.parse(env.BELOTE_CHALLENGES);
  } catch {
    console.error("BELOTE_CHALLENGES illisible : défis par défaut");
  }
  return list;
}

export function levelInfo(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i],
    next = LEVELS[i + 1];
  return {
    index: i,
    name: cur.name,
    xp,
    next: next ? next.xp : null,
    nextName: next?.name ?? null,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  };
}

export function createProgression({ db, economy, env = process.env, maxSameLineup = 2 }) {
  const challenges = challengesConfig(env);
  const day = () => dayId(Date.now(), economy.config.dayStartUtc);
  const prog = (p) => {
    p.progress ??= { xp: 0, badges: {}, owned: {}, equipped: { frame: "frame-none", back: "back-prune", felt: "felt-emeraude" }, finished: 0, wins: 0, daily: {} };
    return p.progress;
  };
  function unlocked(p, item) {
    const g = prog(p),
      u = item.unlock;
    if (u.type === "free") return true;
    if (u.type === "level") return levelInfo(g.xp).index >= u.value;
    if (u.type === "badge") return !!g.badges[u.value];
    return !!g.owned[item.id]; // défi, événement : attribué explicitement
  }
  function badge(p, id, out) {
    const g = prog(p);
    if (!g.badges[id]) {
      g.badges[id] = Date.now();
      out.badges.push(BADGES.find((b) => b.id === id));
    }
  }
  return {
    challenges,
    view(p) {
      const g = prog(p);
      const today = g.daily[day()] ?? {};
      return {
        level: levelInfo(g.xp),
        finished: g.finished,
        wins: g.wins,
        badges: BADGES.map((b) => ({ ...b, at: g.badges[b.id] ?? null })),
        equipped: g.equipped,
        cosmetics: COSMETICS.map((c) => ({ ...c, owned: unlocked(p, c) })),
        challenges: challenges.map((c) => ({ ...c, progress: Math.min(c.goal, today[c.id] ?? 0), done: !!today["done:" + c.id] })),
        nextReset: nextReset(Date.now(), economy.config.dayStartUtc),
      };
    },
    equip(p, id) {
      const item = COSMETICS.find((c) => c.id === id);
      if (!item) throw Error("Élément inconnu");
      if (!unlocked(p, item)) throw Error(`Verrouillé : ${item.unlock.label}`);
      prog(p).equipped[item.kind] = id;
    },
    grant(p, id) {
      if (!COSMETICS.some((c) => c.id === id)) throw Error("Élément inconnu");
      prog(p).owned[id] = Date.now();
    },
    // Récompense de tournoi : badge ou objet exclusif, sans effet si déjà possédé.
    award(p, id) {
      const g = prog(p);
      if (BADGES.some((b) => b.id === id && b.reward)) {
        if (g.badges[id]) return false;
        g.badges[id] = Date.now();
        return true;
      }
      if (!COSMETICS.some((c) => c.id === id)) throw Error("Récompense inconnue");
      if (g.owned[id]) return false;
      g.owned[id] = Date.now();
      return true;
    },
    // Partie réellement terminée par ce joueur (pas d'abandon). Renvoie le résumé affiché.
    record(p, info) {
      const g = prog(p);
      const out = { xp: 0, badges: [], challenges: [], counted: true };
      const factor = info.practice ? XP.practiceFactor : 1;
      out.xp += Math.round((XP.finished + Math.min(info.deals, 12) * XP.perDeal) * factor);
      if (info.won) out.xp += Math.round(XP.win * factor);
      if (info.won && info.rubicon) out.xp += Math.round(XP.rubicon * factor);
      g.xp += out.xp;
      g.finished++;
      if (info.won) g.wins++;
      badge(p, "first-game", out);
      if (info.won) badge(p, "first-win", out);
      if (g.finished >= 10) badge(p, "games-10", out);
      if (g.finished >= 50) badge(p, "games-50", out);
      if (info.won && info.rubicon && !info.practice) badge(p, "first-rubicon", out);
      if (info.capot) badge(p, "capot", out);
      if (info.counterWin) badge(p, "contreur", out);
      if (info.vipHost) badge(p, "vip-host", out);
      // Défis : seules les vraies parties comptent ; la même tablée ne compte que deux fois par jour.
      const d = day();
      g.daily = { [d]: g.daily[d] ?? {} };
      const today = g.daily[d];
      const lineup = "lineup:" + info.lineup;
      const genuine = info.deals >= 2 || info.durationMs >= 4 * 60_000;
      if (!genuine || (!info.practice && (today[lineup] ?? 0) >= maxSameLineup)) out.counted = false;
      if (!info.practice) today[lineup] = (today[lineup] ?? 0) + 1;
      if (out.counted) {
        const bump = (id) => (today[id] = (today[id] ?? 0) + 1);
        if (!info.practice) bump("play3");
        if (!info.practice && info.won) bump("win1");
        if (info.practice) bump("practice1");
        for (const c of challenges) {
          if ((today[c.id] ?? 0) < c.goal || today["done:" + c.id]) continue;
          // Récompense unique : clé de journal par joueur, jour et défi.
          today["done:" + c.id] = true;
          if (c.reward.xp) g.xp += c.reward.xp;
          if (c.reward.cosmetic) g.owned[c.reward.cosmetic] = Date.now();
          if (c.reward.credits && p.accountId)
            economy.post(p, `challenge:${p.id}:${d}:${c.id}`, "challenge", toUnits(c.reward.credits), { label: `Défi : ${c.label}` });
          out.challenges.push(c);
        }
      }
      out.level = levelInfo(g.xp);
      return out;
    },
  };
}
