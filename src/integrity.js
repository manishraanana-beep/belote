// Détection de comportements suspects : on combine plusieurs indices avant d'alerter.
// Jouer souvent entre amis ou perdre plusieurs parties ne suffit jamais.
// Les alertes sont examinées par un humain ; aucune sanction ni confiscation automatique.
import { randomBytes } from "node:crypto";

export function integrityConfig(env = process.env) {
  const n = (k, d) => (env[k] ? Number(env[k]) : d);
  return {
    windowDays: n("BELOTE_ALERT_WINDOW_DAYS", 7),
    sameLineupGames: n("BELOTE_ALERT_SAME_LINEUP", 6), // même tablée de 4 comptes
    sameWinnersShare: n("BELOTE_ALERT_WINNERS_SHARE", 0.85), // toujours les mêmes gagnants
    flowCredits: n("BELOTE_ALERT_FLOW", 5000), // crédits nets transférés dans le groupe
    leaves: n("BELOTE_ALERT_LEAVES", 3), // abandons après engagement
    rewardRepeats: n("BELOTE_ALERT_REWARD_REPEAT", 5), // tablée répétée le même jour
  };
}

export function createIntegrity(db, config = integrityConfig()) {
  db.flows ??= [];
  db.alerts ??= [];
  db.leaves ??= [];
  const window = () => Date.now() - config.windowDays * 86400_000;
  function alert(key, kind, players, indicators, evidence) {
    const existing = db.alerts.find((a) => a.key === key && !a.reviewed);
    if (existing) {
      existing.indicators = indicators;
      existing.evidence = evidence;
      existing.updated = Date.now();
      return existing;
    }
    const a = { id: randomBytes(9).toString("base64url"), key, kind, players, indicators, evidence, at: Date.now(), reviewed: false };
    db.alerts.push(a);
    db.alerts = db.alerts.slice(-500);
    return a;
  }
  return {
    config,
    // Après chaque règlement : même tablée, mêmes gagnants, flux de crédits.
    settlement(gameId, result) {
      const lineup = result.rows.map((r) => r.pid).sort().join("|");
      const winners = result.rows.filter((r) => r.delta > 0).map((r) => r.pid).sort().join("|");
      db.flows.push({ at: Date.now(), gameId, lineup, winners, total: result.total });
      db.flows = db.flows.filter((f) => f.at > window()).slice(-20000);
      const games = db.flows.filter((f) => f.lineup === lineup);
      const counts = {};
      for (const f of games) counts[f.winners] = (counts[f.winners] ?? 0) + 1;
      const [topWinners, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const flow = games.filter((f) => f.winners === topWinners).reduce((a, f) => a + f.total, 0) / 2;
      const indicators = [];
      if (games.length >= config.sameLineupGames) indicators.push(`${games.length} parties avec exactement les mêmes 4 comptes`);
      if (games.length >= 3 && topCount / games.length >= config.sameWinnersShare)
        indicators.push(`les mêmes gagnants dans ${Math.round((100 * topCount) / games.length)} % des parties`);
      if (flow >= config.flowCredits) indicators.push(`${flow} crédits gagnés par la même paire dans ce groupe`);
      if (indicators.length >= 2)
        return alert(`collusion:${lineup}`, "Possible arrangement entre comptes", lineup.split("|"), indicators, { winners: topWinners.split("|"), games: games.length });
      return null;
    },
    // Abandon volontaire d'une partie avec crédits engagés.
    leave(pid, gameId) {
      db.leaves.push({ pid, gameId, at: Date.now() });
      db.leaves = db.leaves.filter((l) => l.at > window());
      const n = db.leaves.filter((l) => l.pid === pid).length;
      if (n >= config.leaves)
        return alert(`leaves:${pid}`, "Abandons répétés après engagement", [pid], [`${n} départs de parties avec crédits en ${config.windowDays} jours`], { games: db.leaves.filter((l) => l.pid === pid).map((l) => l.gameId) });
      return null;
    },
    // Tablée répétée artificiellement pour les défis.
    repetition(lineup, count) {
      if (count >= config.rewardRepeats)
        return alert(`repeat:${lineup}`, "Parties répétées pour les récompenses", lineup.split("|"), [`${count} parties le même jour avec la même tablée`], {});
      return null;
    },
  };
}
