import { cardImage } from "./cards.js";

// ———————————————————————————————————————————————————————————— utilitaires
const $ = (s) => document.querySelector(s);
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const SUITS = { S: "♠", H: "♥", C: "♣", D: "♦" };
const SUIT_NAMES = { S: "Pique", H: "Cœur", C: "Trèfle", D: "Carreau" };
const HAND_ORDER = ["S", "H", "C", "D"];
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_NAMES = { J: "Valet", Q: "Dame", K: "Roi", A: "As" };
const AVATARS = [
  "renard", "chat", "hibou", "panda", "ours", "lapin", "grenouille", "chien",
  "lea", "hugo", "nadia", "karim", "mamie", "papi", "lou", "sacha",
];
const BIDS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250];
const DEFAULT_RULES = {
  target: 1000,
  turnSeconds: 30,
  counterWindowSeconds: 8,
  reconnectSeconds: 90,
  capotValue: 250,
  scoring: "added",
  allPass: "redeal",
  flyingCounter: true,
  beloteRetained: true,
  beloteCountsContract: true,
};
const isRed = (s) => s === "H" || s === "D";
const amountLabel = (n) => (n === 250 ? "Capot" : String(n));
const cardName = (c) => {
  const r = c.slice(0, -1);
  return `${RANK_NAMES[r] ?? r} de ${SUIT_NAMES[c.slice(-1)].toLowerCase()}`;
};
const avatarUrl = (v) =>
  typeof v === "string" && v.startsWith("u:")
    ? `/u/${v.slice(2)}.jpg`
    : `/avatars/${/^[a-z-]+$/.test(v ?? "") ? v : "renard"}.svg`;
const avatar = (v, cls = "") => `<img class="avatar ${cls}" src="${avatarUrl(v)}" alt="" draggable="false">`;
const btn = (text, action, cls = "", data = "", disabled = false) =>
  `<button type="button" class="${cls}" data-action="${action}" ${data} ${disabled ? "disabled" : ""}>${text}</button>`;
const suitHtml = (s) => `<span class="suit ${isRed(s) ? "red" : ""}">${SUITS[s]}</span>`;

// ———————————————————————————————————————————————————————————— état local
let state = null,
  ws = null,
  retry = 0,
  authConfig = { google: null, apple: null, mail: false },
  sound = localStorage.getItem("beloteSound") !== "false",
  sheet = null, // menu | chat | auction | scores | lastTrick
  selected = null,
  bidAmount = null,
  lastMultiplier = 1,
  lastRenderedDeal = null,
  dealing = false,
  collection = null,
  lastTrickKey = null,
  collectionTimer = null,
  seenChat = 0,
  pendingInvite = null,
  cropper = null,
  resetToken = null;
try {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (raw.startsWith("{")) pendingInvite = JSON.parse(raw);
} catch {}

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("visible"), 3800);
}
function cmd(type, data = {}) {
  if (ws?.readyState !== 1) return toast("Connexion en cours…");
  ws.send(JSON.stringify({ id: crypto.randomUUID(), type, data }));
}
async function api(path, body, raw = false) {
  const res = await fetch(path, {
    method: "POST",
    headers: raw ? { "Content-Type": "image/jpeg" } : { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body ?? {}),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(d.error ?? "Une erreur est survenue");
  return d;
}
function tone(freqs, dur = 0.12, vol = 0.06) {
  if (!sound) return;
  try {
    const ctx = new AudioContext();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = "triangle";
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * dur;
      o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 1.6);
      o.start(t0);
      o.stop(t0 + dur * 1.7);
    });
    setTimeout(() => ctx.close(), (freqs.length + 2) * dur * 1000);
  } catch {}
}

// ———————————————————————————————————————————————————————————— modales
function modal(content, cls = "") {
  const m = $("#modal");
  m.className = cls;
  m.innerHTML = `<button type="button" class="modal-close" data-action="close" aria-label="Fermer">✕</button>${content}`;
  if (!m.open) m.showModal();
}
const closeModal = () => $("#modal").open && $("#modal").close();

function ruleText(r) {
  return [
    `${r.target} points`,
    r.scoring === "added" ? "points + contrat" : "contrat seul",
    `contre ${r.flyingCounter ? "à la volée" : "à son tour"}`,
    `capot ${r.capotValue}`,
    `tour ${r.turnSeconds} s`,
  ].join(" · ");
}
function rulesModal(r = DEFAULT_RULES, action = "") {
  modal(
    `<div class="modal-head"><span class="modal-icon">📜</span><h2>Les règles de la table</h2></div>
    <ul class="rule-list">
      <li><b>${r.target}</b> points pour gagner · ${r.scoring === "added" ? "points réalisés + contrat" : "contrat seul"}</li>
      <li>Enchères de 80 à 160, puis capot (${r.capotValue})</li>
      <li>Contre ${r.flyingCounter ? "<b>à la volée</b> : les deux adversaires peuvent contrer à tout moment" : "à son tour"} · surcontre pendant ${r.counterWindowSeconds} s</li>
      <li>Contré ×2, surcontré ×4 · belote jamais multipliée, ${r.beloteRetained ? "conservée" : "perdue"} à la chute</li>
      <li>Atout : V 9 A 10 R D 8 7 · hors atout : A 10 R D V 9 8 7 · dix de der</li>
      <li>Fournir, couper, surcouper, monter à l’atout ; partenaire maître : défausse libre</li>
      <li>Tour de ${r.turnSeconds} s · absence : un robot joue après ${r.reconnectSeconds} s, jusqu’à votre retour</li>
    </ul>${action}`,
    "sheet-modal",
  );
}

// ———————————————————————————————————————————————————————————— lobby
function topNav() {
  const p = state.player;
  return `<header class="topnav">
    <a class="logo" href="/" aria-label="Maison Belote"><span class="logo-mark">♠</span><span class="logo-text">Maison <b>Belote</b></span></a>
    <div class="nav-actions">
      ${p.account ? "" : btn("Se connecter", "auth", "chip-btn ghost hide-xs")}
      <button type="button" class="profile-chip" data-action="profile" aria-label="Mon profil">${avatar(p.avatar)}<span><b>${e(p.name)}</b><small>${p.account ? (p.account.verified ? "Compte vérifié" : "E-mail à confirmer") : "Invité"}</small></span></button>
    </div>
  </header>`;
}
function tableCard(t) {
  const taken = 4 - t.available;
  const seats = Array.from({ length: 4 }, (_, i) => `<i class="${i < t.humans ? "on" : i < taken ? "bot" : ""}"></i>`).join("");
  const busy = t.status === "Partie en cours";
  return `<article class="table-card ${busy ? "busy" : ""}">
    <div class="table-card-top"><span class="tag ${t.quick ? "tag-quick" : "tag-public"}">${t.quick ? "⚡ Rapide" : "🌍 Publique"}</span><span class="table-status ${busy ? "" : "open"}">${busy ? "En jeu" : "Ouverte"}</span></div>
    <h3>${e(t.name)}</h3>
    <p>${t.rules.target} points · contre ${t.rules.flyingCounter ? "à la volée" : "à son tour"}</p>
    <div class="table-card-bottom"><span class="seat-dots" aria-label="${taken} places occupées sur 4">${seats}</span>
    ${btn(busy ? "En jeu" : "Rejoindre", "join", "pill small", `data-table="${t.id}"`, busy || !t.available)}</div>
  </article>`;
}
function lobby() {
  const p = state.player;
  const rate = p.stats.games ? Math.round((100 * p.stats.wins) / p.stats.games) : 0;
  return `<div class="screen lobby">${topNav()}
  <main class="lobby-main">
    <section class="hero">
      <div class="hero-copy">
        <span class="kicker">Belote contrée · 4 joueurs · 2 équipes</span>
        <h1>La contrée,<br><em>comme au café.</em></h1>
        <p>Un partenaire, du bluff, des belotes et des contres à la volée. Jouez entre amis ou contre nos robots facétieux.</p>
        <div class="hero-cta">
          ${btn('<span class="play-icon">▶</span> Jouer maintenant', "quick", "cta")}
          <small>On cherche des joueurs ; des robots complètent la table en quelques secondes.</small>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-fan">${["AS", "KH", "JC", "QD", "10S"].map((c, i) => `<img class="fan-card f${i}" src="${cardImage(c)}" alt="">`).join("")}</div>
        <img class="hero-av a1" src="/avatars/renard.svg" alt=""><img class="hero-av a2" src="/avatars/mamie.svg" alt=""><img class="hero-av a3" src="/avatars/hugo.svg" alt="">
        <span class="hero-bubble">Belote !</span>
      </div>
    </section>
    <section class="tiles">
      <button type="button" class="tile tile-vip" data-action="create"><span class="tile-icon">👑</span><b>Table VIP</b><small>Privée, sur invitation, vos règles</small></button>
      <button type="button" class="tile tile-bots" data-action="practice"><span class="tile-icon">🤖</span><b>Entraînement</b><small>Vous contre trois robots</small></button>
      <button type="button" class="tile tile-code" data-action="joinCode"><span class="tile-icon">🔑</span><b>Rejoindre</b><small>Avec un lien ou un code</small></button>
      <button type="button" class="tile tile-rules" data-action="rulesInfo"><span class="tile-icon">📜</span><b>Les règles</b><small>Contrée, belote, capot</small></button>
    </section>
    ${state.requests.length ? `<div class="notice">⏳ Demande envoyée à <b>${state.requests.map((r) => e(r.name)).join(", ")}</b>. L’hôte doit l’accepter.</div>` : ""}
    <section class="lobby-grid">
      <div class="panel">
        <div class="panel-head"><h2>Tables publiques</h2><span class="count">${state.tables.length}</span></div>
        <div class="table-list">${state.tables.map(tableCard).join("") || '<p class="empty">Aucune table ouverte : lancez « Jouer maintenant » !</p>'}</div>
      </div>
      <div class="panel me-panel">
        <div class="me-head">${avatar(p.avatar, "xl")}<div><h2>${e(p.name)}</h2>${btn("Modifier mon profil", "profile", "link")}</div></div>
        <div class="stat-row"><div><b>${p.stats.games}</b><small>parties</small></div><div><b>${p.stats.wins}</b><small>victoires</small></div><div><b>${rate}%</b><small>réussite</small></div></div>
        ${p.account ? "" : `<div class="account-hint"><b>Créez votre compte</b><p>Retrouvez avatar, statistiques et tables VIP sur le site et dans l’application.</p>${btn("Créer un compte", "auth", "pill small", 'data-mode="register"')}</div>`}
      </div>
    </section>
  </main>
  <footer class="footnote"><span>Maison Belote · contrée française</span>${btn("Règles", "rulesInfo", "link")}${btn("Administration", "admin", "link")}<a class="link" href="/cards-LICENSE.txt">Crédits des cartes</a></footer>
  </div>`;
}

// ———————————————————————————————————————————————————————————— salon d'attente
function roomView() {
  const t = state.table,
    me = t.seats.findIndex((s) => s?.id === state.player.id),
    owner = t.owner === state.player.id;
  const base = me < 0 ? 0 : me;
  const slot = (i) => {
    const s = t.seats[i],
      rel = (i - base + 4) % 4,
      team = i % 2 === base % 2 ? "us" : "them";
    if (!s)
      return `<div class="room-seat r${rel} empty ${team}">
        <div class="seat-ring searching"><span class="dots"><i></i><i></i><i></i></span></div>
        <b>${t.quick ? "Recherche…" : "Place libre"}</b>
        <div class="room-seat-actions">${me < 0 || t.quick ? "" : btn("S’asseoir", "seat", "chip-btn", `data-seat="${i}"`)}${owner && !t.quick ? btn("+ Robot", "bot", "chip-btn", `data-seat="${i}"`) : ""}</div>
      </div>`;
    return `<div class="room-seat r${rel} ${team} ${s.bot ? "is-bot" : ""}">
      <div class="seat-ring">${avatar(s.avatar)}${s.bot ? '<span class="bot-badge" title="Robot">🤖</span>' : ""}</div>
      <b>${e(s.name)}${i === me ? " (vous)" : ""}</b>
      <small>${s.bot ? "Robot" : s.connected ? (t.owner === s.id ? "Hôte" : "Prêt") : "Reconnexion…"}</small>
      ${owner && i !== me && !t.quick ? btn("Retirer", "kick", "chip-btn ghost", `data-seat="${i}"`) : ""}
    </div>`;
  };
  const free = t.seats.filter((s) => !s).length;
  const center = t.quick
    ? `<div class="room-center"><span class="room-kicker">⚡ Partie rapide</span><h2>${free ? "On cherche des joueurs" : "C’est parti !"}</h2>
       ${free ? `<p>${t.humans} joueur${t.humans > 1 ? "s" : ""} · ${free} place${free > 1 ? "s" : ""} en recherche</p><div class="fill-timer">🤖 Robots dans <b data-deadline="${t.fillAt ?? 0}"></b></div>` : ""}</div>`
    : `<div class="room-center"><span class="room-kicker">${t.vip ? "👑 Table VIP" : "🌍 Table publique"}</span><h2>${e(t.name)}</h2><p>${e(ruleText(t.rules))}</p>
       ${owner ? btn("▶ Lancer la partie", "start", "cta small", "", t.seats.some((s) => !s)) : '<p class="muted">L’hôte lancera la partie.</p>'}
       ${owner && free ? `<p class="muted small">Complétez les places libres avec des robots.</p>` : ""}</div>`;
  const vip =
    t.vip && owner
      ? `<div class="room-invite"><b>Inviter des amis</b>
        <div class="invite-row">${btn("🔗 Copier le lien", "copyInvite", "pill small")}<span class="muted small">Code : <code>${e(t.invite)}</code></span></div>
        ${t.pending.map((p) => `<div class="request"><span>✋ <b>${e(p.name)}</b> veut jouer</span>${btn("Accepter", "admit", "pill small", `data-player="${p.id}"`)}${btn("Refuser", "reject", "chip-btn ghost", `data-player="${p.id}"`)}</div>`).join("")}
      </div>`
      : "";
  return `<div class="screen room">
    <header class="room-bar">${btn("← Quitter", "leave", "chip-btn ghost")}<span class="room-title">${e(t.name)}</span>
      <div class="room-bar-actions">${btn("📜", "rulesInfo", "icon-btn", 'aria-label="Règles"')}${owner && !t.quick ? btn("⚙️", "editRules", "icon-btn", 'aria-label="Modifier les règles"') : ""}</div></header>
    <div class="room-felt">${[0, 1, 2, 3].map(slot).join("")}${center}</div>
    ${vip}
    <p class="room-teams"><span class="team-dot us"></span> Votre équipe : vous et la place en face <span class="team-dot them"></span> Adversaires à gauche et à droite</p>
  </div>`;
}

// ———————————————————————————————————————————————————————————— table de jeu
function contractInfo(g, t, me) {
  if (!g.contract) return null;
  const s = t.seats[g.contract.seat];
  const ours = g.contract.seat % 2 === me % 2;
  return {
    name: s?.name ?? "?",
    avatar: s?.avatar,
    ours,
    team: ours ? "Votre équipe" : "Équipe adverse",
    amount: amountLabel(g.contract.amount),
    suit: g.contract.suit,
    mult: g.multiplier,
  };
}
const multLabel = (m) => (m === 4 ? "Surcontré" : m === 2 ? "Contré" : "");
function topBar(g, t, me) {
  const c = contractInfo(g, t, me);
  const unread = t.chat.length > seenChat && sheet !== "chat";
  return `<header class="game-bar">
    ${btn('<span class="burger"><i></i><i></i><i></i></span>', "menu", "icon-btn", 'aria-label="Menu de la partie"')}
    <div class="scoreboard" aria-label="Scores">
      <div class="score us"><small>Nous</small><b>${g.scores[me % 2]}</b></div>
      <div class="score-target" title="Objectif">${t.rules.target}</div>
      <div class="score them"><small>Eux</small><b>${g.scores[1 - (me % 2)]}</b></div>
    </div>
    ${
      c
        ? `<div class="contract-badge ${c.ours ? "us" : "them"}" aria-label="Contrat">${avatar(c.avatar)}<div><b>${c.amount} ${suitHtml(c.suit)}</b><small>${e(c.name)} · ${c.ours ? "Nous" : "Eux"}</small></div>${c.mult > 1 ? `<span class="mult">×${c.mult}</span>` : ""}</div>`
        : `<div class="contract-badge pending"><div><b>${g.phase === "bidding" ? "Enchères" : "—"}</b><small>Donne ${g.deal}</small></div></div>`
    }
    <div class="bar-right">
      ${btn("🃏", "lastTrick", "icon-btn", `aria-label="Dernier pli"${g.tricks.length ? "" : " disabled"}`)}
      ${btn(`💬${unread ? '<i class="dot"></i>' : ""}`, "chat", "icon-btn", 'aria-label="Discussion"')}
    </div>
  </header>`;
}
function seatBubble(g, i) {
  if (!["bidding", "counter"].includes(g.phase)) return "";
  const a = (g.auction ?? []).filter((x) => x.seat === i).at(-1);
  if (!a) return "";
  const text =
    a.type === "bid"
      ? `${amountLabel(a.amount)} ${suitHtml(a.suit)}`
      : a.type === "pass"
        ? "Passe"
        : a.type === "counter"
          ? "Contre !"
          : "Surcontre !";
  return `<span class="bubble ${a.type}">${text}</span>`;
}
function chatBubble(t, s) {
  const m = t.chat.at(-1);
  if (!m || !s || m.pid !== s.id || Date.now() - m.at > 5000) return "";
  return `<span class="bubble chat-bubble">${e(m.text)}</span>`;
}
function seatView(g, t, me, i) {
  const s = t.seats[i],
    rel = (i - me + 4) % 4,
    team = i % 2 === me % 2 ? "us" : "them",
    active = ["bidding", "playing"].includes(g.phase) && g.turn === i,
    offline = s && !s.bot && !s.connected;
  const status = active
    ? `<span class="seat-timer" data-deadline="${t.deadline ?? 0}"></span>`
    : offline
      ? `<span class="seat-off">${Date.now() - (s.disconnectedAt ?? 0) < t.rules.reconnectSeconds * 1000 ? "Reconnexion…" : "Robot en relais"}</span>`
      : s?.replaced
        ? `<span class="seat-off">remplace ${e(s.replaced)}</span>`
        : "";
  return `<div class="seat p${rel} ${team} ${active ? "active" : ""} ${offline ? "offline" : ""}">
    <div class="seat-avatar">${avatar(s?.avatar)}${s?.bot ? '<span class="bot-badge" title="Robot">🤖</span>' : ""}${g.dealer === i ? '<span class="dealer" title="Donneur">D</span>' : ""}${g.contract?.seat === i ? '<span class="taker" title="Preneur">★</span>' : ""}</div>
    <div class="seat-label"><b>${e(s?.name ?? "—")}</b>${status}</div>
    ${rel !== 0 ? `<div class="backs">${Array.from({ length: Math.min(8, g.handCounts[i]) }, () => "<i></i>").join("")}</div>` : ""}
    ${seatBubble(g, i)}${chatBubble(t, s)}
  </div>`;
}
function trickCards(cards, me, cls = "") {
  return `<div class="trick ${cls}">${cards.map((p) => `<div class="tcard p${(p.seat - me + 4) % 4}"><img src="${cardImage(p.card)}" alt="${cardName(p.card)}"></div>`).join("")}</div>`;
}
function contractBanner(c, g) {
  return `<div class="contract-banner ${c.ours ? "us" : "them"}" role="status">
    ${avatar(c.avatar, "lg")}
    <div class="cb-text"><span class="cb-who"><b>${e(c.name)}</b> a pris</span>
    <span class="cb-bid">${c.amount} ${suitHtml(c.suit)}</span>
    <span class="cb-team">${c.team}${c.mult > 1 ? ` · <b>${multLabel(c.mult)}</b>` : ""}</span>
    ${g.phase === "counter" ? `<span class="cb-counter">Surcontre possible · <b data-deadline="${g.counterDeadline ?? 0}"></b></span>` : ""}</div>
    ${c.mult > 1 ? `<span class="stamp">${multLabel(c.mult).toUpperCase()} !</span>` : ""}
  </div>`;
}
function centerView(g, t, me) {
  if (collection) return trickCards(collection.cards, me, `collecting to${(collection.winner - me + 4) % 4}`);
  if (["summary", "finished"].includes(g.phase)) return summaryView(g, t, me);
  const c = contractInfo(g, t, me);
  if (g.phase === "counter") return contractBanner(c, g);
  if (g.phase === "playing") {
    // L'annonce du preneur occupe le centre jusqu'à la première carte.
    if (!g.tricks.length && !g.trick.length) return contractBanner(c, g);
    return trickCards(g.trick, me);
  }
  return `<div class="bid-status">
    <span class="bs-kicker">Donne ${g.deal} · enchères</span>
    ${c ? `<span class="bs-best">${c.amount} ${suitHtml(c.suit)}</span><span class="bs-by">${e(c.name)} · ${c.team}</span>` : `<span class="bs-best none">Pas encore d’annonce</span>`}
    <span class="bs-turn">${g.turn === me ? "À vous de parler" : `${e(t.seats[g.turn]?.name)} réfléchit…`}</span>
  </div>`;
}
function summaryView(g, t, me) {
  const h = g.history.at(-1);
  if (!h) return "";
  const ours = h.contract.seat % 2 === me % 2;
  const good = ours === h.made;
  const finished = g.phase === "finished";
  const won = g.scores[me % 2] > g.scores[1 - (me % 2)];
  const owner = t.owner === state.player.id;
  return `<div class="summary ${(finished ? won : good) ? "win" : "lose"}">
    <span class="sum-emoji">${finished ? (won ? "🏆" : "🤝") : good ? "🎉" : "😬"}</span>
    <h2>${finished ? (won ? "Victoire !" : "Défaite… revanche ?") : h.made ? "Contrat réussi" : "Dedans !"}</h2>
    <p>${e(t.seats[h.contract.seat]?.name)} · ${amountLabel(h.contract.amount)} ${suitHtml(h.contract.suit)} · ${ours ? "Votre équipe" : "Équipe adverse"}${h.multiplier > 1 ? ` · ${multLabel(h.multiplier)}` : ""}</p>
    <div class="sum-scores"><div class="us"><small>Nous</small><b>+${h.score[me % 2]}</b><span>${g.scores[me % 2]}</span></div><div class="them"><small>Eux</small><b>+${h.score[1 - (me % 2)]}</b><span>${g.scores[1 - (me % 2)]}</span></div></div>
    <p class="muted small">Points ${h.points[me % 2]} / ${h.points[1 - (me % 2)]}${h.belote[0] + h.belote[1] ? ` · belote ${h.belote[me % 2]} / ${h.belote[1 - (me % 2)]}` : ""}</p>
    <div class="row">${finished ? (owner ? btn("Revanche", "rematch", "cta small") : "") + btn("Retour au salon", "leave", "chip-btn ghost") : btn("Donne suivante", "next", "cta small")}</div>
  </div>`;
}
function bidPanel(g, me) {
  const options = BIDS.filter((n) => !g.contract || n > g.contract.amount);
  if (!options.includes(bidAmount)) bidAmount = options[0] ?? null;
  const canCounter = g.contract && g.contract.seat % 2 !== me % 2;
  return `<form id="bid-form" class="bid-panel" aria-label="Votre enchère">
    <input type="hidden" name="amount" value="${bidAmount ?? ""}">
    <div class="bid-amounts">${BIDS.map((n) => `<button type="button" class="amount ${n === bidAmount ? "on" : ""}" data-action="pickAmount" data-amount="${n}" ${options.includes(n) ? "" : "disabled"}>${amountLabel(n)}</button>`).join("")}</div>
    <div class="bid-suits">${HAND_ORDER.map((s) => `<button class="suit-btn ${isRed(s) ? "red" : ""}" name="suit" value="${s}" aria-label="Annoncer ${SUIT_NAMES[s]}" ${options.length ? "" : "disabled"}>${SUITS[s]}</button>`).join("")}</div>
    <div class="bid-actions">${canCounter ? btn("Contrer !", "counter", "danger-btn") : ""}${btn("Passer", "pass", "pass-btn")}</div>
  </form>`;
}
function floatingAction(g, me) {
  const flying = g.phase === "bidding" && g.contract && g.contract.seat % 2 !== me % 2 && g.turn !== me && g.rules.flyingCounter;
  if (flying) return `<div class="float-action">${btn("Contrer !", "counter", "danger-btn big")}</div>`;
  if (g.phase === "counter" && g.contract.seat % 2 === me % 2)
    return `<div class="float-action">${btn(`Surcontrer ! <small data-deadline="${g.counterDeadline ?? 0}"></small>`, "surcounter", "danger-btn big")}</div>`;
  return "";
}
function handView(g, me) {
  const hand = [...g.hand].sort(
    (a, b) =>
      HAND_ORDER.indexOf(a.slice(-1)) - HAND_ORDER.indexOf(b.slice(-1)) ||
      RANKS.indexOf(a.slice(0, -1)) - RANKS.indexOf(b.slice(0, -1)),
  );
  if (selected && !hand.includes(selected)) selected = null;
  const myTurn = g.phase === "playing" && g.turn === me && !collection;
  const glow = g.phase === "bidding" && g.turn === me;
  return `<div class="hand n${hand.length} ${dealing ? "dealing" : ""} ${glow ? "glow" : ""} ${myTurn ? "my-turn" : ""}" aria-label="Votre main">
    ${hand.map((c, i) => `<button type="button" class="hcard c${i} ${c === selected ? "selected" : ""}" data-action="pick" data-card="${c}" aria-label="${cardName(c)}" aria-pressed="${c === selected}"><img src="${cardImage(c)}" alt="" draggable="false"></button>`).join("")}
  </div>
  <div class="hand-hint">${myTurn ? (selected ? `Touchez encore pour jouer : <b>${cardName(selected)}</b>` : "À vous de jouer !") : ""}</div>`;
}
function sheetView(g, t, me) {
  if (!sheet) return "";
  const close = btn("✕", "closeSheet", "sheet-close", 'aria-label="Fermer"');
  let body = "";
  if (sheet === "menu")
    body = `<h3>Menu de la partie</h3><div class="menu-list">
      ${btn("📣 Annonces de la donne", "auction", "menu-item")}
      ${btn("📊 Scores des donnes", "scores", "menu-item")}
      ${btn("💬 Discussion", "chat", "menu-item")}
      ${btn("📜 Règles de la table", "rulesInfo", "menu-item")}
      ${btn(sound ? "🔊 Sons activés" : "🔇 Sons coupés", "sound", "menu-item")}
      ${t.vip && t.owner === state.player.id ? btn("🔗 Copier le lien d’invitation", "copyInvite", "menu-item") : ""}
      ${btn("🚩 Signaler un problème", "report", "menu-item")}
      ${btn("🚪 Quitter la partie", "quitGame", "menu-item danger")}
    </div>`;
  if (sheet === "auction")
    body = `<h3>Annonces · donne ${g.deal}</h3><ol class="auction-list">${(g.auction ?? []).map((a) => `<li class="${a.seat % 2 === me % 2 ? "us" : "them"}">${avatar(t.seats[a.seat]?.avatar)}<b>${e(t.seats[a.seat]?.name)}</b><span>${a.type === "bid" ? `${amountLabel(a.amount)} ${suitHtml(a.suit)}` : a.type === "pass" ? "Passe" : a.type === "counter" ? "Contre !" : "Surcontre !"}</span></li>`).join("") || '<li class="empty">Aucune annonce pour l’instant.</li>'}</ol>`;
  if (sheet === "scores")
    body = `<h3>Scores · objectif ${t.rules.target}</h3><div class="score-table"><div class="st-head"><span>Donne</span><span>Contrat</span><span>Nous</span><span>Eux</span></div>${g.history.slice(-6).map((h) => `<div class="st-row"><span>${h.deal}</span><span>${amountLabel(h.contract.amount)} ${suitHtml(h.contract.suit)} ${h.made ? "✓" : "✗"}</span><b>${h.score[me % 2]}</b><b>${h.score[1 - (me % 2)]}</b></div>`).join("") || '<p class="empty">Les scores apparaîtront après la première donne.</p>'}<div class="st-total"><span>Total</span><span></span><b>${g.scores[me % 2]}</b><b>${g.scores[1 - (me % 2)]}</b></div></div>`;
  if (sheet === "chat") {
    seenChat = t.chat.length;
    body = `<h3>Discussion</h3><div class="chat-log">${t.chat.slice(-30).map((m) => `<p class="${m.pid === state.player.id ? "mine" : ""}"><b>${e(m.name)}</b>${e(m.text)}</p>`).join("") || '<p class="empty">Un petit mot pour la table ?</p>'}</div>
      <div class="reactions">${["👏", "😂", "🔥", "Bien joué !", "Belote !", "Oups…"].map((x) => btn(e(x), "reaction", "chip-btn", `data-text="${e(x)}"`)).join("")}</div>
      <form id="chat-form" class="chat-form"><input name="text" maxlength="280" placeholder="Votre message…" aria-label="Message" autocomplete="off" required><button class="pill small">Envoyer</button></form>`;
  }
  if (sheet === "lastTrick") {
    const p = g.tricks.at(-1);
    const c = contractInfo(g, t, me);
    body = p
      ? `<h3>Dernier pli</h3>${c ? `<p class="lt-contract ${c.ours ? "us" : "them"}">${c.team} — ${c.amount} ${suitHtml(c.suit)}${c.mult > 1 ? ` · ${multLabel(c.mult)}` : ""}</p>` : ""}
        <div class="lt-cards">${p.cards.map((x) => `<figure class="${x.seat === p.winner ? "winner" : ""}"><img src="${cardImage(x.card)}" alt="${cardName(x.card)}"><figcaption>${e(t.seats[x.seat]?.name)}</figcaption></figure>`).join("")}</div>
        <p class="lt-winner">★ <b>${e(t.seats[p.winner]?.name)}</b> remporte ${p.points} points</p><p class="muted small">Touchez pour fermer</p>`
      : '<h3>Dernier pli</h3><p class="empty">Aucun pli joué pour l’instant.</p>';
  }
  return `<div class="sheet-backdrop ${sheet === "lastTrick" ? "centered" : ""}" data-action="closeSheet"><section class="sheet sheet-${sheet}" role="dialog" aria-modal="true">${close}${body}</section></div>`;
}
function gameView() {
  const t = state.table,
    g = t.game,
    me = Math.max(0, t.seats.findIndex((s) => s?.id === state.player.id));
  const myBid = g.phase === "bidding" && g.turn === me;
  return `<div class="screen game ${myBid ? "bidding-me" : ""}">
    ${topBar(g, t, me)}
    <main class="arena">
      <div class="felt"></div>
      ${[1, 2, 3, 0].map((r) => seatView(g, t, me, (me + r) % 4)).join("")}
      <div class="center">${centerView(g, t, me)}</div>
      ${myBid ? bidPanel(g, me) : floatingAction(g, me)}
    </main>
    <footer class="dock">${handView(g, me)}</footer>
    ${sheetView(g, t, me)}
  </div>`;
}

// ———————————————————————————————————————————————————————————— rendu
// Un rafraîchissement pendant un appui ferait perdre la touche : on le diffère au relâchement.
let pressing = false,
  pendingRender = false;
document.addEventListener("pointerdown", () => (pressing = true), true);
const release = () =>
  setTimeout(() => {
    pressing = false;
    if (pendingRender) {
      pendingRender = false;
      render();
    }
  }, 0);
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
function render() {
  if (!state) return;
  if (pressing) {
    pendingRender = true;
    return;
  }
  const t = state.table,
    g = t?.game;
  document.body.className = g ? "in-game" : t ? "in-room" : "in-lobby";
  const dealKey = g ? t.gameId + ":" + g.deal : null;
  const trickKey = dealKey + ":" + (g?.tricks.length ?? 0);
  if (dealKey !== lastRenderedDeal) {
    collection = null;
    clearTimeout(collectionTimer);
    selected = null;
  } else if (trickKey !== lastTrickKey && g?.tricks.length) {
    // Ramassage animé du pli vers son gagnant.
    collection = { ...g.tricks.at(-1), startedAt: performance.now() };
    tone([660, 880], 0.08, 0.04);
    clearTimeout(collectionTimer);
    collectionTimer = setTimeout(() => {
      collection = null;
      render();
    }, 1150);
  }
  lastTrickKey = trickKey;
  dealing = !!g && dealKey !== lastRenderedDeal;
  if (dealing) tone([392, 523, 659], 0.07, 0.035);
  lastRenderedDeal = dealKey;
  if (!g) sheet = null;
  const focus = document.activeElement,
    focusForm = focus?.closest("form")?.id,
    focusName = focus?.name,
    fields = {};
  document.querySelectorAll("#app form[id] input:not([type=hidden])").forEach((el) => (fields[el.closest("form").id + ":" + el.name] = el.value));
  $("#app").innerHTML = g ? gameView() : t ? roomView() : lobby();
  document.querySelectorAll("#app form[id] input:not([type=hidden])").forEach((el) => {
    const v = fields[el.closest("form").id + ":" + el.name];
    if (v !== undefined) el.value = v;
  });
  if (focusForm && focusName) document.querySelector(`#app #${focusForm} [name="${focusName}"]`)?.focus();
  const log = $(".chat-log");
  if (log) log.scrollTop = log.scrollHeight;
  if (collection) $(".collecting")?.getAnimations({ subtree: true }).forEach((a) => (a.currentTime = performance.now() - collection.startedAt));
  clock();
}
function clock() {
  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const d = Number(el.dataset.deadline);
    const n = Math.max(0, Math.ceil((d - Date.now()) / 1000));
    el.textContent = d ? `${n} s` : "";
    el.classList.toggle("urgent", d > 0 && n <= 5);
  });
}
setInterval(clock, 250);
setInterval(() => {
  // Les bulles de discussion s'effacent toutes seules.
  const m = state?.table?.chat?.at(-1);
  if (m && state.table.game && Date.now() - m.at > 5000 && Date.now() - m.at < 5600) render();
}, 500);

// ———————————————————————————————————————————————————————————— comptes et profil
async function loadAuthConfig() {
  try {
    authConfig = await (await fetch("/api/auth/config")).json();
  } catch {}
}
function socialButtons() {
  const b = (p, label, icon) =>
    `<button type="button" class="social ${p}" data-action="oidc" data-provider="${p}" ${authConfig[p] ? "" : "disabled"}>${icon}<span>${label}</span>${authConfig[p] ? "" : "<small>bientôt</small>"}</button>`;
  return `<div class="socials">${b("apple", "Continuer avec Apple", '<span class="s-icon"></span>')}${b("google", "Continuer avec Google", '<span class="s-icon g">G</span>')}</div><div class="or"><span>ou par e-mail</span></div>`;
}
function authModal(mode = "login") {
  const tabs = `<div class="seg tabs">${btn("Connexion", "auth", mode === "login" ? "on" : "", 'data-mode="login"')}${btn("Inscription", "auth", mode === "register" ? "on" : "", 'data-mode="register"')}</div>`;
  const forms = {
    login: `${tabs}${socialButtons()}<form id="login-form" class="form"><label>Adresse e-mail<input name="email" type="email" autocomplete="email" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required minlength="8"></label><button class="cta small wide">Se connecter</button></form>${btn("Mot de passe oublié ?", "auth", "link center", 'data-mode="forgot"')}`,
    register: `${tabs}${socialButtons()}<form id="register-form" class="form"><label>Adresse e-mail<input name="email" type="email" autocomplete="email" required></label><label>Mot de passe <small>8 caractères minimum</small><input name="password" type="password" autocomplete="new-password" required minlength="8"></label><button class="cta small wide">Créer mon compte</button></form><p class="muted small center">Votre profil invité, vos statistiques et vos tables sont conservés.</p>`,
    forgot: `<form id="forgot-form" class="form"><p class="muted">Indiquez votre adresse : nous vous envoyons un lien pour choisir un nouveau mot de passe.</p><label>Adresse e-mail<input name="email" type="email" autocomplete="email" required></label><button class="cta small wide">Envoyer le lien</button></form>${btn("← Retour", "auth", "link center", 'data-mode="login"')}`,
    reset: `<form id="reset-form" class="form"><label>Nouveau mot de passe <small>8 caractères minimum</small><input name="password" type="password" autocomplete="new-password" required minlength="8"></label><button class="cta small wide">Enregistrer</button></form>`,
  };
  const titles = { login: "Bon retour parmi nous !", register: "Rejoignez la Maison", forgot: "Mot de passe oublié", reset: "Nouveau mot de passe" };
  modal(`<div class="auth"><div class="auth-art">${["lea", "renard", "papi"].map((a) => avatar(a)).join("")}</div><h2>${titles[mode]}</h2><p class="muted center small">Un seul compte pour le site, l’App Store et Google Play.</p>${forms[mode]}</div>`, "auth-modal");
}
function avatarGrid(current) {
  return `<div class="avatar-grid">${AVATARS.map((a) => `<button type="button" class="av-pick ${a === current ? "on" : ""}" data-action="setAvatar" data-avatar="${a}" aria-label="Avatar ${a}">${avatar(a)}</button>`).join("")}
  <label class="av-pick upload ${String(current).startsWith("u:") ? "on" : ""}" aria-label="Importer une photo"><input type="file" accept="image/*" id="photo-input" hidden><span>📷<small>Photo</small></span></label></div>`;
}
function profileModal() {
  const p = state.player,
    a = p.account;
  const account = a
    ? `<div class="account-box"><div class="ab-row"><span>📧 ${e(a.email ?? "Compte " + a.providers.join(" / "))}</span>${a.verified ? '<span class="ok">✓ vérifiée</span>' : btn("Renvoyer le lien", "resend", "chip-btn")}</div>
       ${a.providers.length ? `<p class="muted small">Connecté avec ${a.providers.map((x) => (x === "apple" ? "Apple" : "Google")).join(" et ")}</p>` : ""}
       ${a.hasPassword ? `<details><summary>Changer de mot de passe</summary><form id="password-form" class="form"><label>Actuel<input name="current" type="password" autocomplete="current-password" required></label><label>Nouveau<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><button class="pill small">Enregistrer</button></form></details>` : ""}
       <div class="ab-actions">${btn("Se déconnecter", "logout", "chip-btn ghost")}${btn("Supprimer mon compte", "deleteAccount", "chip-btn danger")}</div></div>`
    : `<div class="account-box guest"><b>Profil invité</b><p class="muted small">Lié à ce navigateur. Créez un compte pour le retrouver sur le site et dans l’application.</p><div class="row">${btn("Créer un compte", "auth", "pill small", 'data-mode="register"')}${btn("J’ai déjà un compte", "auth", "link", 'data-mode="login"')}</div></div>`;
  modal(
    `<div class="profile">
      <div class="profile-head">${avatar(p.avatar, "xxl")}<div><h2>${e(p.name)}</h2><p class="muted">${p.stats.games} parties · ${p.stats.wins} victoires</p></div></div>
      <form id="profile-form" class="form inline"><label>Pseudo<input name="name" maxlength="24" minlength="2" required value="${e(p.name)}" autocomplete="nickname"></label><button class="pill small">OK</button></form>
      <h3>Votre avatar</h3>${avatarGrid(p.avatar)}
      ${account}
      <div class="profile-foot">${btn(sound ? "🔊 Sons activés" : "🔇 Sons coupés", "sound", "chip-btn ghost")}${p.history.length ? `<span class="muted small">Dernière partie : ${p.history[0].won ? "victoire" : "défaite"} ${p.history[0].scores.join(" / ")}</span>` : ""}</div>
    </div>`,
    "profile-modal",
  );
}
function avatarStep() {
  modal(`<div class="profile"><h2>Choisissez votre avatar</h2><p class="muted">Vous pourrez le changer à tout moment depuis votre profil.</p>${avatarGrid(state.player.avatar)}${btn("C’est parti !", "close", "cta small wide")}${state.player.account && !state.player.account.verified ? '<p class="muted small center">📧 Un lien de confirmation vous a été envoyé par e-mail.</p>' : ""}</div>`, "profile-modal");
}
// Recadrage : glisser pour cadrer, curseur pour zoomer, aperçu rond en direct.
function openCropper(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    cropper = { img, url, x: 0, y: 0, zoom: 1 };
    modal(
      `<div class="cropper"><h2>Votre photo</h2><div class="crop-stage"><canvas id="crop-canvas" width="280" height="280"></canvas><div class="crop-mask"></div></div>
      <label class="zoom">Zoom<input id="crop-zoom" type="range" min="1" max="3" step="0.01" value="1"></label>
      <div class="crop-preview"><canvas id="crop-preview" width="64" height="64"></canvas><span class="muted small">Aperçu à la table</span></div>
      <div class="row">${btn("Annuler", "profile", "chip-btn ghost")}${btn("Utiliser cette photo", "savePhoto", "cta small")}</div></div>`,
      "profile-modal",
    );
    drawCrop();
    const c = $("#crop-canvas");
    let drag = null;
    c.addEventListener("pointerdown", (ev) => {
      drag = { x: ev.clientX, y: ev.clientY, ox: cropper.x, oy: cropper.y };
      c.setPointerCapture(ev.pointerId);
    });
    c.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      cropper.x = drag.ox + ev.clientX - drag.x;
      cropper.y = drag.oy + ev.clientY - drag.y;
      drawCrop();
    });
    c.addEventListener("pointerup", () => (drag = null));
    $("#crop-zoom").addEventListener("input", (ev) => {
      cropper.zoom = Number(ev.target.value);
      drawCrop();
    });
  };
  img.onerror = () => toast("Image illisible");
  img.src = url;
}
function cropTo(canvas) {
  const { img, zoom } = cropper,
    S = 280,
    k = canvas.width / S;
  const base = S / Math.min(img.width, img.height);
  const w = img.width * base * zoom,
    h = img.height * base * zoom;
  cropper.x = Math.max(-(w - S) / 2, Math.min((w - S) / 2, cropper.x));
  cropper.y = Math.max(-(h - S) / 2, Math.min((h - S) / 2, cropper.y));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, ((S - w) / 2 + cropper.x) * k, ((S - h) / 2 + cropper.y) * k, w * k, h * k);
}
function drawCrop() {
  cropTo($("#crop-canvas"));
  cropTo($("#crop-preview"));
}
async function savePhoto() {
  const out = document.createElement("canvas");
  out.width = out.height = 256;
  cropTo(out);
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", 0.86));
  try {
    await api("/api/avatar", blob, true);
    URL.revokeObjectURL(cropper.url);
    cropper = null;
    toast("Photo enregistrée");
    closeModal();
  } catch (err) {
    toast(err.message);
  }
}
const scripts = {};
function loadScript(src) {
  scripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(Error("Service de connexion indisponible"));
    document.head.append(s);
  });
  return scripts[src];
}
async function oidc(provider) {
  try {
    let idToken;
    if (provider === "google") {
      await loadScript("https://accounts.google.com/gsi/client");
      idToken = await new Promise((resolve, reject) => {
        window.google.accounts.id.initialize({ client_id: authConfig.google, callback: (r) => resolve(r.credential) });
        window.google.accounts.id.prompt((n) => n.isNotDisplayed?.() && reject(Error("Connexion Google indisponible dans ce navigateur")));
      });
    } else {
      await loadScript("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js");
      window.AppleID.auth.init({ clientId: authConfig.apple, scope: "name email", redirectURI: location.origin + "/", usePopup: true });
      idToken = (await window.AppleID.auth.signIn()).authorization.id_token;
    }
    await api("/api/auth/oidc", { provider, idToken });
    closeModal();
    toast("Connexion réussie");
  } catch (err) {
    toast(err.message ?? "Connexion annulée");
  }
}

// ———————————————————————————————————————————————————————————— création de table
function createModal(r = DEFAULT_RULES, editing = false) {
  const num = (k, label, min, max) => `<label>${label}<input name="${k}" type="number" value="${r[k]}" min="${min}" max="${max}" required></label>`;
  const sw = (k, label) => `<label class="switch"><input name="${k}" type="checkbox" ${r[k] ? "checked" : ""}><span class="knob"></span>${label}</label>`;
  modal(
    `<div class="modal-head"><span class="modal-icon">${editing ? "⚙️" : "👑"}</span><h2>${editing ? "Règles de la table" : "Créer une table VIP"}</h2></div>
    <form id="${editing ? "rules-form" : "create-form"}" class="form">
      ${editing ? "" : `<label>Nom de la table<input name="name" placeholder="Le salon de Sophie" maxlength="40" required></label>
      <div class="seg radio"><label><input type="radio" name="vip" value="true" checked><span>👑 Privée</span></label><label><input type="radio" name="vip" value="false"><span>🌍 Publique</span></label></div>
      <label>Mot de passe <small>facultatif</small><input name="password" type="password" maxlength="128" autocomplete="new-password"></label>`}
      <details class="advanced" ${editing ? "open" : ""}><summary>Règles et délais</summary>
      <div class="form-grid">${num("target", "Points pour gagner", 100, 10000)}${num("turnSeconds", "Temps par tour (s)", 5, 120)}${num("counterWindowSeconds", "Délai de surcontre (s)", 2, 30)}${num("capotValue", "Valeur du capot", 160, 500)}${num("reconnectSeconds", "Délai d’absence (s)", 10, 600)}
      <label>Score<select name="scoring"><option value="added" ${r.scoring === "added" ? "selected" : ""}>Points + contrat</option><option value="contract" ${r.scoring === "contract" ? "selected" : ""}>Contrat seul</option></select></label>
      <label>Si tous passent<select name="allPass"><option value="redeal" ${r.allPass === "redeal" ? "selected" : ""}>Même donneur</option><option value="rotate" ${r.allPass === "rotate" ? "selected" : ""}>Donneur suivant</option></select></label></div>
      ${sw("flyingCounter", "Contre à la volée")}${sw("beloteRetained", "Belote conservée à la chute")}${sw("beloteCountsContract", "La belote compte pour le contrat")}
      </details>
      <button class="cta small wide">${editing ? "Enregistrer" : "Créer la table"}</button>
    </form>`,
    "sheet-modal",
  );
}
function joinModal(prefill = {}) {
  modal(
    `<div class="modal-head"><span class="modal-icon">🔑</span><h2>Rejoindre une table privée</h2></div>
    <form id="invite-form" class="form"><label>Identifiant de la table<input name="tableId" value="${e(prefill.tableId)}" required></label><label>Code d’invitation<input name="invite" value="${e(prefill.invite)}" required></label><label>Mot de passe <small>si demandé</small><input name="password" type="password" maxlength="128"></label><button class="cta small wide">Voir les règles</button></form>`,
    "sheet-modal",
  );
}

// ———————————————————————————————————————————————————————————— interactions
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const a = el.dataset.action,
    t = state?.table,
    g = t?.game;
  const me = t ? t.seats.findIndex((s) => s?.id === state.player.id) : -1;
  switch (a) {
    case "close":
      closeModal();
      break;
    case "closeSheet":
      // Le fond ferme le panneau ; le dernier pli se ferme d'une touche n'importe où.
      if (el.classList.contains("sheet-close") || ev.target === el || sheet === "lastTrick") {
        sheet = null;
        render();
      }
      break;
    case "menu":
    case "chat":
    case "auction":
    case "scores":
    case "lastTrick":
      sheet = sheet === a ? null : a;
      render();
      break;
    case "sound":
      sound = !sound;
      localStorage.setItem("beloteSound", sound);
      tone([523, 784]);
      render();
      if ($("#modal").open && $(".profile")) profileModal();
      break;
    case "auth":
      authModal(el.dataset.mode ?? "login");
      break;
    case "oidc":
      oidc(el.dataset.provider);
      break;
    case "profile":
      profileModal();
      break;
    case "setAvatar":
      cmd("profile", { avatar: el.dataset.avatar });
      document.querySelectorAll(".av-pick").forEach((b) => b.classList.toggle("on", b === el));
      document.querySelectorAll(".profile-head .avatar").forEach((img) => (img.src = avatarUrl(el.dataset.avatar)));
      break;
    case "savePhoto":
      savePhoto();
      break;
    case "resend":
      try {
        await api("/api/auth/resend");
        toast("Lien de confirmation renvoyé");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "logout":
      try {
        await api("/api/auth/logout");
        closeModal();
        toast("Vous êtes déconnecté");
      } catch (err) {
        toast(err.message);
      }
      break;
    case "deleteAccount":
      modal(`<div class="confirm"><span class="confirm-icon">⚠️</span><h2>Supprimer votre compte ?</h2><p>Profil, avatar, statistiques et tables seront définitivement effacés.</p><form id="delete-form" class="form">${state.player.account?.hasPassword ? '<label>Mot de passe<input name="password" type="password" required autocomplete="current-password"></label>' : ""}<div class="row">${btn("Annuler", "profile", "chip-btn ghost")}<button class="danger-btn">Supprimer</button></div></form></div>`, "confirm-modal");
      break;
    case "quick":
      cmd("quick");
      break;
    case "create":
      createModal();
      break;
    case "editRules":
      createModal(t.rules, true);
      break;
    case "joinCode":
      joinModal();
      break;
    case "join": {
      const target = state.tables.find((x) => x.id === el.dataset.table);
      rulesModal(target.rules, btn("Accepter et rejoindre", "confirmJoin", "cta small wide", `data-table="${target.id}"`));
      break;
    }
    case "confirmJoin":
      cmd("join", { tableId: el.dataset.table });
      closeModal();
      break;
    case "confirmVip":
      cmd("join", pendingInvite);
      closeModal();
      break;
    case "rulesInfo":
      if (sheet) {
        sheet = null;
        render();
      }
      rulesModal(t?.rules ?? DEFAULT_RULES);
      break;
    case "practice":
      rulesModal(DEFAULT_RULES, btn("🤖 Jouer contre les robots", "confirmPractice", "cta small wide"));
      break;
    case "confirmPractice":
      cmd("practice");
      closeModal();
      break;
    case "copyInvite": {
      const link = location.origin + "/#" + encodeURIComponent(JSON.stringify({ tableId: t.id, invite: t.invite }));
      try {
        await navigator.clipboard.writeText(link);
        toast("Lien d’invitation copié !");
      } catch {
        modal(`<h2>Lien d’invitation</h2><input class="copy-field" readonly value="${e(link)}" aria-label="Lien à copier">`);
      }
      break;
    }
    case "pickAmount":
      bidAmount = Number(el.dataset.amount);
      el.form.amount.value = bidAmount;
      el.form.querySelectorAll(".amount").forEach((b) => b.classList.toggle("on", b === el));
      break;
    case "pass":
    case "counter":
    case "surcounter":
      cmd("action", { version: g.version, action: { type: a } });
      break;
    case "pick": {
      // Première touche : la carte ressort. Deuxième touche : elle est jouée.
      const c = el.dataset.card;
      const myTurn = g.phase === "playing" && g.turn === me && !collection;
      if (selected === c && myTurn) {
        cmd("action", { version: g.version, action: { type: "play", card: c } });
        selected = null;
      } else selected = selected === c ? null : c;
      render();
      break;
    }
    case "quitGame":
      sheet = null;
      render();
      modal(`<div class="confirm"><span class="confirm-icon">🚪</span><h2>Quitter la partie ?</h2><p>Un robot prendra votre place.</p><div class="row">${btn("Rester", "close", "chip-btn ghost")}${btn("Quitter", "confirmLeave", "danger-btn")}</div></div>`, "confirm-modal");
      break;
    case "confirmLeave":
      closeModal();
      cmd("leave");
      break;
    case "bot":
    case "kick":
    case "seat":
      cmd(a, { seat: Number(el.dataset.seat) });
      break;
    case "admit":
    case "reject":
      cmd(a, { playerId: el.dataset.player });
      break;
    case "start":
    case "next":
    case "rematch":
    case "leave":
      cmd(a);
      break;
    case "reaction":
      cmd("chat", { text: el.dataset.text });
      sheet = null;
      render();
      break;
    case "report":
      sheet = null;
      render();
      modal('<div class="modal-head"><span class="modal-icon">🚩</span><h2>Signaler un problème</h2></div><form id="report-form" class="form"><label>Que s’est-il passé ?<textarea name="reason" maxlength="500" required></textarea></label><button class="cta small wide">Envoyer</button></form>', "sheet-modal");
      break;
    case "admin":
      modal('<h2>Administration</h2><p class="muted">Accès réservé (clé BELOTE_ADMIN_KEY du serveur).</p><form id="admin-form" class="form"><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="pill small">Ouvrir</button></form><div id="admin-result"></div>', "sheet-modal");
      break;
    case "suspendPlayer":
      await adminRequest({ type: "suspend", id: el.dataset.id, enabled: el.dataset.enabled === "true" });
      break;
    case "deleteTable":
      await adminRequest({ type: "deleteTable", id: el.dataset.id });
      break;
    case "resolveReport":
      await adminRequest({ type: "resolve", id: el.dataset.id });
      break;
    case "maintenance":
      await adminRequest({ type: "maintenance", enabled: el.dataset.enabled === "true" });
      break;
  }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "photo-input" && ev.target.files[0]) openCropper(ev.target.files[0]);
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && sheet) {
    sheet = null;
    render();
  }
});
let adminToken = "";
async function adminRequest(data) {
  try {
    const res = await fetch("/api/admin", {
      method: data ? "POST" : "GET",
      headers: { Authorization: "Bearer " + adminToken, ...(data ? { "Content-Type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw Error(await res.text());
    const d = await res.json();
    const row = (l, r) => `<div class="admin-row"><span>${l}</span>${r}</div>`;
    $("#admin-result").innerHTML =
      `<h3>${d.players.length} joueurs · ${d.tables.length} tables</h3>${btn(d.settings.maintenance ? "Rouvrir les entrées" : "Suspendre les nouvelles entrées", "maintenance", "chip-btn", `data-enabled="${!d.settings.maintenance}"`)}<h3>Joueurs</h3>${d.players.map((p) => row(`${e(p.name)} · ${p.stats.games} parties`, btn(p.banned ? "Réactiver" : "Suspendre", "suspendPlayer", "chip-btn", `data-id="${p.id}" data-enabled="${!p.banned}"`))).join("")}<h3>Tables</h3>${d.tables.map((t) => row(`${e(t.name)} · ${e(t.status)}`, btn("Supprimer", "deleteTable", "chip-btn", `data-id="${t.id}"`, t.status === "Partie en cours"))).join("")}<h3>Signalements</h3>${d.reports.map((r) => row(`${e(r.reason)} <small>${new Date(r.at).toLocaleString("fr-FR")}</small>`, r.resolved ? "Traité" : btn("Traiter", "resolveReport", "chip-btn", `data-id="${r.id}"`))).join("") || "<p>Aucun signalement.</p>"}`;
  } catch (err) {
    toast(err.message);
  }
}
document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(f, ev.submitter));
  try {
    switch (f.id) {
      case "bid-form":
        cmd("action", { version: state.table.game.version, action: { type: "bid", amount: Number(d.amount), suit: d.suit } });
        return;
      case "chat-form":
        cmd("chat", { text: d.text });
        f.reset();
        return;
      case "create-form":
      case "rules-form": {
        const r = {};
        for (const k of ["target", "turnSeconds", "counterWindowSeconds", "reconnectSeconds", "capotValue"]) r[k] = Number(d[k]);
        for (const k of ["scoring", "allPass"]) r[k] = d[k];
        for (const k of ["flyingCounter", "beloteRetained", "beloteCountsContract"]) r[k] = d[k] === "on";
        cmd(f.id === "create-form" ? "create" : "rules", { name: d.name, password: d.password || undefined, vip: d.vip === "true", rules: r });
        break;
      }
      case "profile-form":
        cmd("profile", { name: d.name });
        toast("Pseudo enregistré");
        return;
      case "invite-form":
        pendingInvite = d;
        cmd("inspectInvite", d);
        return;
      case "report-form":
        cmd("report", d);
        toast("Merci, signalement envoyé");
        break;
      case "admin-form":
        adminToken = d.key;
        f.reset();
        adminRequest();
        return;
      case "login-form":
        await api("/api/auth/login", d);
        toast("Bon retour à la Maison !");
        break;
      case "register-form":
        await api("/api/auth/register", d);
        avatarStep();
        return;
      case "forgot-form":
        await api("/api/auth/forgot", d);
        toast("Si un compte existe, un e-mail vient de partir.");
        break;
      case "reset-form":
        await api("/api/auth/reset", { ...d, token: resetToken });
        history.replaceState(null, "", "/");
        toast("Mot de passe modifié, vous êtes connecté");
        break;
      case "password-form":
        await api("/api/auth/password", d);
        toast("Mot de passe modifié");
        break;
      case "delete-form":
        await api("/api/auth/delete", d);
        toast("Compte supprimé");
        break;
    }
    closeModal();
  } catch (err) {
    toast(err.message);
  }
});

// ———————————————————————————————————————————————————————————— connexion
function handleHash() {
  const h = location.hash;
  if (h === "#verified") toast("Adresse e-mail confirmée, merci !");
  if (h === "#verify-failed") toast("Ce lien de confirmation n’est plus valable.");
  if (h.startsWith("#reset=")) {
    resetToken = h.slice(7);
    authModal("reset");
  }
  if (["#verified", "#verify-failed"].includes(h)) history.replaceState(null, "", "/");
}
async function connect() {
  try {
    const session = await fetch("/api/session", { method: "POST" });
    if (!session.ok) return toast("Accès au profil indisponible. Contactez l’administrateur.");
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => {
      if (retry) toast("Connexion rétablie · partie restaurée");
      retry = 0;
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") {
        const first = !state;
        const m = msg.table?.game?.multiplier ?? 1;
        if (m > lastMultiplier) tone([880, 660, 990], 0.1, 0.07);
        lastMultiplier = m;
        if (msg.table?.game?.trick.length > (state?.table?.game?.trick.length ?? 0)) tone([300], 0.05, 0.05);
        state = msg;
        render();
        if (first && pendingInvite && !state.table) joinModal(pendingInvite);
      }
      if (msg.type === "ack" && msg.invitation)
        rulesModal(msg.invitation.rules, `<p class="muted small">Table « ${e(msg.invitation.name)} »</p>${btn("Accepter et demander une place", "confirmVip", "cta small wide")}`);
      if (msg.type === "error") toast(msg.message);
    };
    ws.onclose = (ev) => {
      if (ev.code === 4001) return connect(); // session changée (connexion, déconnexion)
      toast("Connexion perdue · reconnexion…");
      setTimeout(connect, Math.min(8000, 800 * 2 ** retry++));
    };
  } catch {
    setTimeout(connect, 3000);
  }
}
loadAuthConfig();
handleHash();
connect();
