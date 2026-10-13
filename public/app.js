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
const STAKES = [100, 200, 500, 1000];
const REACTIONS = [
  { id: "bravo", text: "Bien joué !", emoji: "👏" },
  { id: "merci", text: "Merci partenaire !", emoji: "🤝" },
  { id: "belle", text: "Belle partie !", emoji: "🎉" },
  { id: "dommage", text: "Pas de chance !", emoji: "🍀" },
  { id: "rire", text: "", emoji: "😂" },
  { id: "feu", text: "", emoji: "🔥" },
  { id: "wow", text: "", emoji: "😮" },
  { id: "coeur", text: "", emoji: "❤️" },
];
const REPORT_REASONS = {
  abuse: "Insultes ou harcèlement",
  spam: "Spam",
  cheat: "Suspicion de triche ou d’arrangement",
  profile: "Pseudo ou photo inappropriés",
  other: "Autre",
};
const fmt = (n) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const coins = (n, cls = "") => `<span class="coins ${cls}"><i class="coin"></i>${fmt(n)}</span>`;
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
const stakeRisk = (s) => `Mise : ${fmt(s)} crédits. En rubicon, vous risquez jusqu’à ${fmt(3 * s)} crédits, dans la limite de votre solde engagé. Les gains dépendent des crédits engagés par les adversaires.`;
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
  resetToken = null,
  shopConfig = null,
  seenInvites = 0,
  lastReactionSeen = null;
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
      <button type="button" class="wallet-chip" data-action="wallet" aria-label="Mon portefeuille">${coins(p.wallet.available / 2)}${p.wallet.dailyReady && p.account ? '<span class="gift" title="Bonus du jour">🎁</span>' : ""}</button>
      ${p.account ? "" : btn("Se connecter", "auth", "chip-btn ghost hide-xs")}
      <button type="button" class="profile-chip" data-action="profile" aria-label="Mon profil">${avatar(p.avatar)}<span><b>${e(p.name)}</b><small>${p.account ? (p.account.verified ? "Compte vérifié" : "E-mail à confirmer") : "Invité"}</small></span></button>
    </div>
  </header>`;
}
function navRow() {
  const p = state.player;
  const pending = p.friendIn.length + p.invites.length;
  const todo = p.progress.challenges.filter((c) => !c.done).length;
  return `<nav class="nav-row" aria-label="Raccourcis">
    ${btn(`👥 <span>Amis</span>${pending ? `<i class="count-dot">${pending}</i>` : ""}`, "friends", "nav-pill")}
    ${btn(`🎯 <span>Défis</span>${todo ? `<i class="count-dot soft">${todo}</i>` : ""}`, "challenges", "nav-pill")}
    ${btn(`🏅 <span>Niveau ${p.progress.level.index + 1}</span>`, "progress", "nav-pill")}
    ${btn("🎨 <span>Collection</span>", "collection", "nav-pill")}
    ${btn("🪙 <span>Boutique</span>", "shop", "nav-pill")}
  </nav>`;
}
function invitesBlock() {
  const inv = state.player.invites;
  if (!inv.length) return "";
  return `<section class="invites">${inv.map((i) => `<article class="invite-card ${i.vip ? "vip" : ""}">
    <span class="inv-icon">${i.vip ? "👑" : "🃏"}</span>
    <div><b>${e(i.from)} vous invite</b><small>${e(i.table)} · ${i.stake ? `mise ${fmt(i.stake)} crédits` : "partie gratuite"} · ${i.free} place${i.free > 1 ? "s" : ""} libre${i.free > 1 ? "s" : ""} · ${i.rules.target} pts</small></div>
    ${btn("Voir", "inviteOpen", "pill small", `data-id="${i.id}"`)}${btn("✕", "inviteDecline", "chip-btn ghost", `data-id="${i.id}" aria-label="Refuser"`)}
  </article>`).join("")}</section>`;
}
function tableCard(t) {
  const taken = 4 - t.available;
  const seats = Array.from({ length: 4 }, (_, i) => `<i class="${i < t.humans ? "on" : i < taken ? "bot" : ""}"></i>`).join("");
  const busy = t.status === "Partie en cours";
  return `<article class="table-card ${busy ? "busy" : ""}">
    <div class="table-card-top"><span class="tag ${t.quick ? "tag-quick" : "tag-public"}">${t.quick ? "⚡ Rapide" : "🌍 Publique"}</span>${t.stake ? coins(t.stake, "stake") : '<span class="tag tag-free">Gratuite</span>'}<span class="table-status ${busy ? "" : "open"}">${busy ? "En jeu" : "Ouverte"}</span></div>
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
    ${navRow()}
    ${invitesBlock()}
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
        ${levelBar(p.progress.level)}
        <button type="button" class="wallet-card" data-action="wallet">${coins(p.wallet.available / 2, "big")}<small>${p.wallet.reserved ? `dont ${fmt(p.wallet.reserved / 2)} engagés en partie · ` : ""}crédits de jeu</small></button>
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
        <div class="room-seat-actions">${me < 0 || t.quick ? "" : btn("S’asseoir", "seat", "chip-btn", `data-seat="${i}"`)}${owner && !t.quick && !t.stake ? btn("+ Robot", "bot", "chip-btn", `data-seat="${i}"`) : ""}${me >= 0 ? btn("+ Ami", "friends", "chip-btn", 'data-tab="friends"') : ""}</div>
      </div>`;
    return `<div class="room-seat r${rel} ${team} ${s.bot ? "is-bot" : ""}">
      <div class="seat-ring">${avatar(s.avatar)}${s.bot ? '<span class="bot-badge" title="Robot">🤖</span>' : ""}</div>
      <b>${e(s.name)}${i === me ? " (vous)" : ""}</b>
      <small>${s.bot ? "Robot" : s.connected ? (t.owner === s.id ? "Hôte" : "Prêt") : "Reconnexion…"}</small>
      ${t.stake && t.engagedPreview?.[i] ? `<span class="engaged ${t.engagedPreview[i].enough && t.engagedPreview[i].account ? "" : "short"}">${t.engagedPreview[i].account ? (t.engagedPreview[i].enough ? `${coins(t.engagedPreview[i].engaged)} engagés` : "Solde insuffisant") : "Compte requis"}</span>` : ""}
      ${owner && i !== me && !t.quick ? btn("Retirer", "kick", "chip-btn ghost", `data-seat="${i}"`) : ""}
    </div>`;
  };
  const free = t.seats.filter((s) => !s).length;
  const center = t.quick
    ? `<div class="room-center"><span class="room-kicker">⚡ Partie rapide</span><h2>${free ? "On cherche des joueurs" : "C’est parti !"}</h2>
       ${free ? `<p>${t.humans} joueur${t.humans > 1 ? "s" : ""} · ${free} place${free > 1 ? "s" : ""} en recherche</p><div class="fill-timer">🤖 Robots dans <b data-deadline="${t.fillAt ?? 0}"></b></div>` : ""}</div>`
    : `<div class="room-center"><span class="room-kicker">${t.vip ? "👑 Table VIP" : "🌍 Table publique"}</span><h2>${e(t.name)}</h2><p>${e(ruleText(t.rules))}</p>
       ${t.stake ? `<div class="stake-banner">${coins(t.stake)} <span>par joueur · rubicon jusqu’à ${fmt(3 * t.stake)}</span></div><p class="muted small">Engagé au lancement : le plus petit entre votre solde et ${fmt(3 * t.stake)}.</p>` : '<span class="tag tag-free">Partie gratuite</span>'}
       ${owner ? btn("▶ Lancer la partie", "start", "cta small", "", t.seats.some((s) => !s)) : '<p class="muted">L’hôte lancera la partie.</p>'}
       ${owner && free ? `<p class="muted small">${t.stake ? "Les parties avec crédits se jouent à quatre joueurs : invitez vos amis." : "Complétez les places libres avec des robots."}</p>` : ""}</div>`;
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
      ${btn("😊", "react", "icon-btn hide-xxs", 'aria-label="Réactions"')}
      ${btn("🃏", "lastTrick", "icon-btn", `aria-label="Dernier pli"${g.tricks.length ? "" : " disabled"}`)}
      ${btn(`💬${unread ? '<i class="dot"></i>' : ""}`, "chat", "icon-btn", 'aria-label="Discussion"')}
    </div>
  </header>`;
}
function reactionBubble(t, s) {
  if (!s || state.player.hidden.includes(s.id)) return "";
  const r = (t.reactions ?? []).filter((x) => x.pid === s.id && Date.now() - x.at < 3500).at(-1);
  const def = r && REACTIONS.find((x) => x.id === r.reaction);
  return def ? `<span class="reaction-pop" aria-label="${e(def.text || def.emoji)}"><b>${def.emoji}</b>${def.text ? `<small>${e(def.text)}</small>` : ""}</span>` : "";
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
  if (!m || !s || m.pid !== s.id || Date.now() - m.at > 5000 || state.player.hidden.includes(s.id)) return "";
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
  const human = s && !s.bot && s.id !== state.player.id;
  return `<div class="seat p${rel} ${team} ${active ? "active" : ""} ${offline ? "offline" : ""} ${s?.frame ?? ""}">
    <div class="seat-avatar ${human ? "tappable" : ""}" ${human ? `data-action="player" data-id="${s.id}" role="button" aria-label="Profil de ${e(s.name)}"` : ""}>${avatar(s?.avatar)}${s?.bot ? '<span class="bot-badge" title="Robot">🤖</span>' : ""}${g.dealer === i ? '<span class="dealer" title="Donneur">D</span>' : ""}${g.contract?.seat === i ? '<span class="taker" title="Preneur">★</span>' : ""}</div>
    <div class="seat-label"><b>${e(s?.name ?? "—")}</b>${status}</div>
    ${rel !== 0 ? `<div class="backs">${Array.from({ length: Math.min(8, g.handCounts[i]) }, () => "<i></i>").join("")}</div>` : ""}
    ${seatBubble(g, i)}${chatBubble(t, s)}${reactionBubble(t, s)}
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
    ${finished ? resultBlock(t.result) + rematchBlock(t, me) : `<div class="row">${btn("Donne suivante", "next", "cta small")}</div>`}
  </div>`;
}
function moneyLines(r) {
  if (!r || !r.stake) return "";
  const kind = r.rubicon ? "Rubicon" : "Victoire simple";
  if (r.delta > 0)
    return `<div class="money win"><b>Bénéfice : ${signed(r.delta)} crédits</b><small>${fmt(r.stake + r.delta)} récupérés, dont ${fmt(r.stake)} de mise — bénéfice ${signed(r.delta)} · ${kind}</small>${r.adjusted ? "<small class=\"adjusted\">Gain ajusté aux crédits engagés par les adversaires.</small>" : ""}<span>Nouveau solde ${coins(r.balance)}</span></div>`;
  return `<div class="money lose"><b>Perte : ${signed(r.delta)} crédits</b><small>${kind} · ${fmt(r.engaged)} étaient engagés</small><span>Nouveau solde ${coins(r.balance)}</span></div>`;
}
function resultBlock(r) {
  if (!r) return "";
  return `${moneyLines(r)}<div class="xp-line">✨ +${r.xp} XP ${r.level ? `· ${e(r.level.name)}` : ""}${r.badges?.length ? ` · ${r.badges.map((b) => `${b.icon} ${e(b.name)}`).join(", ")}` : ""}${r.challenges?.length ? ` · 🎯 ${r.challenges.map(e).join(", ")}` : ""}</div>`;
}
function rematchBlock(t, me) {
  const votes = t.rematch?.votes ?? {};
  const mine = votes[state.player.id];
  const blocked = t.rematch?.blocked ?? [];
  return `<div class="rematch">
    <div class="votes">${t.seats.map((s) => `<span class="vote ${s && votes[s.id] ? "ok" : ""}" title="${e(s?.name ?? "")}">${avatar(s?.avatar)}<i>${s && votes[s.id] ? "✓" : "…"}</i></span>`).join("")}</div>
    ${t.stake ? `<p class="muted small">${e(stakeRisk(t.stake))}</p>` : ""}
    ${blocked.length ? `<p class="warn">Solde insuffisant pour ${blocked.map(e).join(", ")}. ${btn("Boutique", "shop", "link")} · ${btn("Tables moins chères", "cheaper", "link")}</p>` : ""}
    <div class="row">${mine ? '<span class="waiting-vote">En attente des autres joueurs…</span>' : btn("Revanche", "rematchYes", "cta small")}${btn("Quitter", "rematchNo", "chip-btn ghost")}</div>
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
  if (sheet === "react")
    body = `<h3>Réactions</h3><div class="react-grid">${REACTIONS.map((r) => btn(`<b>${r.emoji}</b>${r.text ? `<small>${e(r.text)}</small>` : ""}`, "sendReaction", "react-btn", `data-id="${r.id}"`)).join("")}</div><p class="muted small">Messages prédéfinis : impossible d’y décrire sa main. Une réaction toutes les quelques secondes.</p>`;
  if (sheet?.startsWith("player:")) body = playerSheet(sheet.slice(7));
  if (sheet === "menu")
    body = `<h3>Menu de la partie</h3><div class="menu-list">
      ${btn("📣 Annonces de la donne", "auction", "menu-item")}
      ${btn("📊 Scores des donnes", "scores", "menu-item")}
      ${btn("💬 Discussion", "chat", "menu-item")}
      ${btn("📜 Règles de la table", "rulesInfo", "menu-item")}
      ${btn(sound ? "🔊 Sons activés" : "🔇 Sons coupés", "sound", "menu-item")}
      ${btn(state.player.settings.animations ? "✨ Animations activées" : "✨ Animations réduites", "toggleAnim", "menu-item")}
      ${t.money ? `<div class="menu-info">${coins(t.money.stake)} mise · ${fmt(t.money.seats.find((x) => x.seat === me)?.engaged ?? 0)} engagés · rubicon jusqu’à ${fmt(3 * t.money.stake)}</div>` : ""}
      ${t.vip && t.owner === state.player.id ? btn("🔗 Copier le lien d’invitation", "copyInvite", "menu-item") : ""}
      ${btn("🚩 Signaler un problème", "report", "menu-item")}
      ${g.phase === "finished" ? "" : btn("🚪 Quitter la partie", "quitGame", "menu-item danger")}
    </div>`;
  if (sheet === "auction")
    body = `<h3>Annonces · donne ${g.deal}</h3><ol class="auction-list">${(g.auction ?? []).map((a) => `<li class="${a.seat % 2 === me % 2 ? "us" : "them"}">${avatar(t.seats[a.seat]?.avatar)}<b>${e(t.seats[a.seat]?.name)}</b><span>${a.type === "bid" ? `${amountLabel(a.amount)} ${suitHtml(a.suit)}` : a.type === "pass" ? "Passe" : a.type === "counter" ? "Contre !" : "Surcontre !"}</span></li>`).join("") || '<li class="empty">Aucune annonce pour l’instant.</li>'}</ol>`;
  if (sheet === "scores")
    body = `<h3>Scores · objectif ${t.rules.target}</h3><div class="score-table"><div class="st-head"><span>Donne</span><span>Contrat</span><span>Nous</span><span>Eux</span></div>${g.history.slice(-6).map((h) => `<div class="st-row"><span>${h.deal}</span><span>${amountLabel(h.contract.amount)} ${suitHtml(h.contract.suit)} ${h.made ? "✓" : "✗"}</span><b>${h.score[me % 2]}</b><b>${h.score[1 - (me % 2)]}</b></div>`).join("") || '<p class="empty">Les scores apparaîtront après la première donne.</p>'}<div class="st-total"><span>Total</span><span></span><b>${g.scores[me % 2]}</b><b>${g.scores[1 - (me % 2)]}</b></div></div>`;
  if (sheet === "chat") {
    seenChat = t.chat.length;
    const live = g.phase !== "finished";
    body = `<h3>Discussion</h3><div class="chat-log">${t.chat.filter((m) => !state.player.hidden.includes(m.pid)).slice(-30).map((m) => `<p class="${m.pid === state.player.id ? "mine" : ""}"><b>${e(m.name)}${m.pid && m.pid !== state.player.id ? ` ${btn("⋯", "player", "mini", `data-id="${m.pid}" aria-label="Options"`)}` : ""}</b>${e(m.text)}</p>`).join("") || '<p class="empty">Un petit mot pour la table ?</p>'}</div>
      <div class="reactions">${REACTIONS.map((r) => btn(e(r.text || r.emoji), "reaction", "chip-btn", `data-text="${e(r.text || r.emoji)}"`)).join("")}</div>
      ${live ? '<p class="muted small">Pendant la donne, seuls les messages prédéfinis sont permis.</p>' : '<form id="chat-form" class="chat-form"><input name="text" maxlength="280" placeholder="Votre message…" aria-label="Message" autocomplete="off" required><button class="pill small">Envoyer</button></form>'}`;
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
function playerSheet(id) {
  const t = state.table;
  const s = t?.seats.find((x) => x?.id === id) ?? state.player.friends.find((f) => f.id === id);
  const name = s?.name ?? "Joueur";
  const friend = state.player.friends.some((f) => f.id === id);
  const hidden = state.player.hidden.includes(id);
  const blocked = state.player.blocked.includes(id);
  return `<div class="player-card">${avatar(s?.avatar, "lg")}<div><h3>${e(name)}</h3><small class="muted">${e(s?.tag ?? "")}</small></div></div>
    <div class="menu-list">
      ${friend || blocked ? "" : btn("👥 Demander en ami", "friendRequest", "menu-item", `data-id="${id}"`)}
      ${btn(hidden ? "👁️ Afficher ses messages et réactions" : "🙈 Masquer ses messages et réactions", "hide", "menu-item", `data-id="${id}" data-on="${!hidden}"`)}
      ${btn(blocked ? "✅ Débloquer" : "⛔ Bloquer", "block", "menu-item", `data-id="${id}" data-on="${!blocked}"`)}
      ${btn("🚩 Signaler", "reportPlayer", "menu-item danger", `data-id="${id}" data-name="${e(name)}"`)}
    </div><p class="muted small">Bloquer n’interrompt pas la partie en cours et ne change rien aux crédits engagés.</p>`;
}
function gameView() {
  const t = state.table,
    g = t.game,
    me = Math.max(0, t.seats.findIndex((s) => s?.id === state.player.id));
  const myBid = g.phase === "bidding" && g.turn === me;
  const eq = state.player.progress.equipped;
  const mine = t.money?.seats.find((x) => x.seat === me);
  return `<div class="screen game ${myBid ? "bidding-me" : ""} ${eq.back} ${t.vip ? "" : eq.felt}">
    ${topBar(g, t, me)}
    <main class="arena">
      <div class="felt"></div>
      ${t.money ? `<div class="stake-chip" title="Mise et crédits engagés">${coins(t.money.stake)}<small>engagé ${fmt(mine?.engaged ?? 0)}</small></div>` : ""}
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
  document.body.className = `${g ? "in-game" : t ? "in-room" : "in-lobby"} ${t?.vip && !t.practice ? "night-vip" : "club-pop"} ${state.player.settings.animations ? "" : "calm"}`;
  sound = state.player.settings.sounds;
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

// ———————————————————————————————————————————————————————————— crédits, progression, social
function levelBar(l) {
  return `<div class="level"><div class="level-head"><b>${e(l.name)}</b><small>${l.next ? `${fmt(l.xp)} / ${fmt(l.next)} XP` : `${fmt(l.xp)} XP`}</small></div><div class="bar"><i class="w${Math.round(l.progress * 20) * 5}"></i></div></div>`;
}
const when = (ts) => new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function countdown(ts) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
function walletModal() {
  const w = state.player.wallet,
    acc = state.player.account;
  modal(
    `<div class="wallet">
      <div class="wallet-hero"><span class="big-coin"></span><div><small>Solde</small><b>${fmt(w.balance / 2)}</b><span>crédits de jeu</span></div></div>
      <div class="wallet-split"><div><small>Disponible</small><b>${fmt(w.available / 2)}</b></div><div><small>Engagé en partie</small><b>${fmt(w.reserved / 2)}</b></div></div>
      ${acc ? (w.dailyReady ? btn("🎁 Recevoir le bonus du jour", "daily", "cta small wide") : `<p class="daily-done">🎁 Bonus du jour reçu · prochain dans ${countdown(w.nextReset)}</p>`) : `<div class="account-box guest"><b>Créez un compte</b><p class="muted small">Recevez vos crédits de bienvenue et le bonus quotidien, sur le site et dans l’application.</p>${btn("Créer un compte", "auth", "pill small", 'data-mode="register"')}</div>`}
      <div class="row">${btn("🪙 Boutique", "shop", "pill small")}${btn("📜 Historique", "history", "chip-btn")}${btn("🤖 Entraînement gratuit", "practice", "chip-btn")}</div>
      <p class="muted small center">Les crédits servent uniquement à jouer : ils ne peuvent être ni retirés, ni transférés, ni convertis en argent.</p>
    </div>`,
    "wallet-modal",
  );
}
async function shopModal() {
  try {
    shopConfig = await (await fetch("/api/shop/config")).json();
  } catch {}
  const c = shopConfig ?? { packs: [], purchases: false };
  const open = c.purchases || c.test;
  modal(
    `<div class="modal-head"><span class="modal-icon">🪙</span><h2>Boutique de crédits</h2></div>
    <p class="muted">Solde : ${coins(state.player.wallet.balance / 2)}</p>
    <div class="packs">${c.packs.map((pk) => `<article class="pack">${pk.bonus ? `<span class="pack-tag">${e(pk.bonus)}</span>` : ""}<span class="pack-coins">${"<i class=\"coin\"></i>".repeat(Math.min(4, 1 + Math.round(Math.log10(pk.credits / 500))))}</span><b>${fmt(pk.credits)}</b><small>crédits</small>
      ${btn(open ? (c.test && !c.purchases ? "Acheter (test)" : e(pk.price)) : e(pk.price), "buy", "pill small", `data-pack="${pk.id}"`, !open || !state.player.account)}</article>`).join("")}</div>
    ${!state.player.account ? '<p class="warn">Créez un compte pour acheter des crédits.</p>' : open ? "" : '<p class="warn">Les achats ne sont pas encore ouverts. En attendant : bonus du jour, défis et entraînement gratuit.</p>'}
    ${c.test && !c.purchases ? '<p class="warn">Mode développement : paiement fictif, jamais disponible en production.</p>' : ""}
    <p class="muted small">Achats vérifiés par le serveur (App Store sur iPhone, Google Play sur Android, paiement sécurisé sur le site). Crédits sans valeur monétaire, non remboursables en argent, non transférables. Réservé aux joueurs majeurs.</p>`,
    "sheet-modal",
  );
}
async function historyModal() {
  const id = crypto.randomUUID();
  pendingAcks[id] = (m) => {
    const rows = m.wallet
      .map((x) => {
        const game = x.gameId ? `<small>Partie ${e(x.gameId.slice(0, 6))} · mise ${fmt(x.stake)} · engagé ${fmt(x.engaged)} · ${x.rubicon ? "rubicon" : "simple"}</small>${x.adjusted ? '<small class="adjusted">Gain ajusté aux crédits engagés par les adversaires.</small>' : ""}` : "";
        return `<li class="${x.amount > 0 ? "in" : x.amount < 0 ? "out" : ""}"><div><b>${e(x.label ?? x.type)}</b><small>${when(x.at)}</small>${game}</div><span><b>${x.amount ? signed(x.amount) : "0"}</b><small>solde ${fmt(x.balance)}</small></span></li>`;
      })
      .join("");
    modal(`<div class="modal-head"><span class="modal-icon">📜</span><h2>Historique des crédits</h2></div><ul class="ledger">${rows || '<li class="empty">Aucun mouvement pour l’instant.</li>'}</ul><p class="muted small">Journal en lecture seule : chaque règlement et chaque récompense ont un identifiant unique.</p>`, "sheet-modal");
  };
  ws.send(JSON.stringify({ id, type: "wallet", data: {} }));
}
function fundsModal(stake) {
  const cheaper = state.tables.filter((t) => t.stake < stake && t.available && t.status !== "Partie en cours");
  modal(
    `<div class="confirm"><span class="confirm-icon">🪙</span><h2>Solde insuffisant</h2>
    <p>Il faut ${coins(stake)} disponibles pour cette table. Vous avez ${coins(state.player.wallet.available / 2)}.</p>
    <div class="menu-list wide">
      ${cheaper.slice(0, 3).map((t) => btn(`${t.stake ? `🪙 ${fmt(t.stake)}` : "Gratuite"} · ${e(t.name)}`, "join", "menu-item", `data-table="${t.id}"`)).join("") || btn("⚡ Partie rapide gratuite", "quick", "menu-item")}
      ${btn("🪙 Boutique de crédits", "shop", "menu-item")}
      ${btn("🤖 Entraînement gratuit", "practice", "menu-item")}
      ${state.player.wallet.dailyReady && state.player.account ? btn("🎁 Bonus du jour", "daily", "menu-item") : ""}
    </div></div>`,
    "confirm-modal",
  );
}
function needFunds(stake) {
  if (!stake) return false;
  if (!state.player.account) {
    authModal("register");
    toast("Créez un compte pour jouer avec des crédits");
    return true;
  }
  if (state.player.wallet.available / 2 < stake) {
    fundsModal(stake);
    return true;
  }
  return false;
}
function friendsModal(tab = "friends") {
  const p = state.player;
  const at = state.table && state.table.seats.some((s) => s?.id === p.id);
  const status = { available: "Disponible", playing: "En partie", offline: "Hors ligne" };
  const list = p.friends.map((f) => `<li class="friend ${f.status}">${avatar(f.avatar)}<div><b>${e(f.name)} ${f.favorite ? "⭐" : ""}</b><small><i class="dot-status"></i>${status[f.status]}</small></div>
      ${at ? btn("Inviter", "inviteFriend", "pill small", `data-id="${f.id}"`) : ""}
      ${btn(f.favorite ? "★" : "☆", "favorite", "chip-btn", `data-id="${f.id}" data-on="${!f.favorite}" aria-label="Favori"`)}
      ${btn("⋯", "player", "chip-btn", `data-id="${f.id}" aria-label="Options"`)}</li>`).join("");
  const tabs = [["friends", `Amis (${p.friends.length})`], ["requests", `Demandes${p.friendIn.length ? ` (${p.friendIn.length})` : ""}`], ["search", "Rechercher"], ["settings", "Réglages"]];
  const body = {
    friends: `<ul class="friend-list">${list || '<li class="empty">Pas encore d’amis : cherchez un pseudo ou un identifiant.</li>'}</ul>`,
    requests: `<ul class="friend-list">${p.friendIn.map((r) => `<li class="friend">${avatar(r.avatar)}<div><b>${e(r.name)}</b><small>${e(r.tag)}</small></div>${btn("Accepter", "friendAccept", "pill small", `data-id="${r.id}"`)}${btn("Refuser", "friendDecline", "chip-btn", `data-id="${r.id}"`)}</li>`).join("") || '<li class="empty">Aucune demande reçue.</li>'}</ul>${p.friendOut.length ? `<p class="muted small">En attente : ${p.friendOut.map((r) => e(r.name)).join(", ")}</p>` : ""}`,
    search: `<form id="search-form" class="form inline"><label>Pseudo ou identifiant<input name="q" minlength="2" maxlength="30" placeholder="ex. Sophie ou MB-4F7K2A" required></label><button class="pill small">Chercher</button></form><ul class="friend-list" id="search-results"></ul><p class="muted small">Votre identifiant : <b>${e(p.tag)}</b></p>`,
    settings: `<div class="form"><label class="switch"><input type="checkbox" data-setting="hideStatus" ${p.settings.hideStatus ? "checked" : ""}><span class="knob"></span>Masquer mon statut en ligne</label>
      <label>Qui peut m’inviter ?<select data-setting="invites"><option value="friends" ${p.settings.invites === "friends" ? "selected" : ""}>Mes amis</option><option value="all" ${p.settings.invites === "all" ? "selected" : ""}>Tout le monde</option><option value="none" ${p.settings.invites === "none" ? "selected" : ""}>Personne</option></select></label>
      ${p.blocked.length ? `<p class="muted small">${p.blocked.length} joueur(s) bloqué(s) : touchez « ⋯ » sur un profil pour débloquer.</p>` : ""}</div>`,
  };
  modal(`<div class="modal-head"><span class="modal-icon">👥</span><h2>Amis</h2></div><div class="seg tabs">${tabs.map(([k, l]) => btn(l, "friends", k === tab ? "on" : "", `data-tab="${k}"`)).join("")}</div>${body[tab]}`, "sheet-modal friends-modal");
}
function challengesModal() {
  const pr = state.player.progress;
  modal(
    `<div class="modal-head"><span class="modal-icon">🎯</span><h2>Défis du jour</h2></div>
    <p class="muted small">Renouvellement dans ${countdown(pr.nextReset)} (à ${new Date(pr.nextReset).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}, heure locale).</p>
    <ul class="challenges">${pr.challenges.map((c) => `<li class="${c.done ? "done" : ""}"><span class="ch-icon">${c.done ? "✅" : "🎯"}</span><div><b>${e(c.label)}</b><div class="bar"><i class="w${Math.round((c.progress / c.goal) * 20) * 5}"></i></div><small>${c.progress} / ${c.goal}</small></div><span class="reward">${c.reward.credits ? coins(c.reward.credits) : ""}${c.reward.xp ? `<small>+${c.reward.xp} XP</small>` : ""}${c.reward.cosmetic ? "<small>🎨 dos de cartes</small>" : ""}</span></li>`).join("")}</ul>
    <p class="muted small">Seules les parties terminées comptent ; une même tablée compte au plus deux fois par jour.</p>`,
    "sheet-modal",
  );
}
function progressModal() {
  const pr = state.player.progress;
  modal(
    `<div class="modal-head"><span class="modal-icon">🏅</span><h2>Niveau d’activité</h2></div>
    ${levelBar(pr.level)}
    <p class="muted small">Le niveau récompense la participation : il ne mesure pas la force de jeu et ne se perd jamais, même si vous perdez des crédits.</p>
    <div class="stat-row light"><div><b>${pr.finished}</b><small>parties terminées</small></div><div><b>${pr.wins}</b><small>victoires</small></div><div><b>${pr.badges.filter((b) => b.at).length}</b><small>badges</small></div></div>
    <h3>Badges</h3><div class="badges">${pr.badges.map((b) => `<div class="badge ${b.at ? "on" : ""}"><span>${b.icon}</span><b>${e(b.name)}</b><small>${b.at ? new Date(b.at).toLocaleDateString("fr-FR") : e(b.hint)}</small></div>`).join("")}</div>`,
    "sheet-modal",
  );
}
function collectionModal(kind = "frame", preview = null) {
  const pr = state.player.progress;
  const items = pr.cosmetics.filter((c) => c.kind === kind);
  const sel = items.find((c) => c.id === preview) ?? items.find((c) => c.id === pr.equipped[kind]);
  const tabs = [["frame", "Cadres"], ["back", "Dos de cartes"], ["felt", "Décors"]];
  const prev = kind === "frame" ? `<div class="pv-avatar ${sel.id}"><div class="seat-avatar">${avatar(state.player.avatar)}</div></div>` : kind === "back" ? `<div class="pv-backs ${sel.id}"><div class="backs big">${"<i></i>".repeat(5)}</div></div>` : `<div class="pv-felt ${sel.id}"><div class="felt"></div></div>`;
  modal(
    `<div class="modal-head"><span class="modal-icon">🎨</span><h2>Collection</h2></div>
    <div class="seg tabs">${tabs.map(([k, l]) => btn(l, "collection", k === kind ? "on" : "", `data-kind="${k}"`)).join("")}</div>
    <div class="preview">${prev}<div><b>${e(sel.name)}</b><small>${sel.owned ? (pr.equipped[kind] === sel.id ? "Activé" : "Possédé") : `🔒 ${e(sel.unlock.label)}`}</small>${sel.owned && pr.equipped[kind] !== sel.id ? btn("Activer", "equip", "pill small", `data-id="${sel.id}" data-kind="${kind}"`) : ""}</div></div>
    <div class="items">${items.map((c) => btn(`<span class="swatch ${c.id}"></span><small>${e(c.name)}</small>${c.owned ? "" : '<i class="lock">🔒</i>'}`, "collection", `item ${c.id === sel.id ? "on" : ""} ${c.owned ? "" : "locked"}`, `data-kind="${kind}" data-preview="${c.id}"`)).join("")}</div>
    <p class="muted small">Purement visuel : aucun avantage, aucune règle modifiée. Le dos de cartes et le décor ne s’affichent que chez vous.</p>`,
    "sheet-modal",
  );
}
function reportModal(id, name) {
  modal(
    `<div class="modal-head"><span class="modal-icon">🚩</span><h2>Signaler ${e(name)}</h2></div>
    <form id="report-player-form" class="form"><input type="hidden" name="target" value="${e(id)}">
      <div class="radios">${Object.entries(REPORT_REASONS).map(([k, l], i) => `<label class="radio"><input type="radio" name="category" value="${k}" ${i ? "" : "checked"}><span>${l}</span></label>`).join("")}</div>
      <label>Commentaire <small>facultatif</small><textarea name="comment" maxlength="500"></textarea></label>
      <p class="muted small">La partie en cours et les derniers échanges sont joints automatiquement pour la modération.</p>
      <button class="cta small wide">Envoyer le signalement</button></form>`,
    "sheet-modal",
  );
}
function joinConfirm(t, action, data = "") {
  rulesModal(
    t.rules,
    `${t.stake ? `<div class="stake-warning">${coins(t.stake, "big")}<p>${e(stakeRisk(t.stake))}</p><small>Votre solde disponible : ${fmt(state.player.wallet.available / 2)} crédits</small></div>` : '<p class="free-note">Partie gratuite : aucun crédit engagé.</p>'}${btn(t.stake ? "J’ai compris, rejoindre" : "Accepter et rejoindre", action, "cta small wide", data)}`,
  );
}
function resultModal(r) {
  modal(`<div class="confirm"><span class="confirm-icon">${r.delta > 0 ? "🎉" : "🃏"}</span><h2>Résultat de « ${e(r.table)} »</h2><p class="muted">Vous aviez quitté la partie : un robot l’a terminée à votre place.</p>${moneyLines(r)}${btn("OK", "dismissResult", "cta small")}</div>`, "confirm-modal");
}
const pendingAcks = {};

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
      <fieldset class="stakes"><legend>Mise par joueur</legend><div class="seg radio">${[0, ...STAKES].map((n) => `<label><input type="radio" name="stake" value="${n}" ${n === (editing ? state.table.stake : 0) ? "checked" : ""}><span>${n ? `🪙 ${fmt(n)}` : "Gratuit"}</span></label>`).join("")}</div><small class="muted">Avec crédits : quatre joueurs, rubicon jusqu’à 3 × la mise.</small></fieldset>
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
      if (a === "chat" && !state.table?.game) break;
    case "auction":
    case "scores":
    case "lastTrick":
      sheet = sheet === a ? null : a;
      render();
      break;
    case "sound":
      sound = !sound;
      cmd("settings", { sounds: sound });
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
      if (needFunds(target.stake)) break;
      joinConfirm(target, "confirmJoin", `data-table="${target.id}"`);
      break;
    }
    case "wallet":
      walletModal();
      break;
    case "shop":
      shopModal();
      break;
    case "history":
      historyModal();
      break;
    case "daily":
      cmd("daily");
      tone([523, 659, 784, 1046], 0.09, 0.05);
      toast("🎁 Bonus du jour ajouté à votre portefeuille !");
      closeModal();
      break;
    case "buy": {
      try {
        const c = shopConfig ?? {};
        if (c.stripe && c.purchases) {
          const r = await api("/api/shop/checkout", { pack: el.dataset.pack });
          location.href = r.url;
        } else if (c.test) {
          await api("/api/shop/test", { pack: el.dataset.pack });
          toast("Crédits ajoutés (paiement de test)");
          closeModal();
        }
      } catch (err) {
        toast(err.message);
      }
      break;
    }
    case "cheaper":
      fundsModal(state.table?.stake ?? 100);
      break;
    case "friends":
      friendsModal(el.dataset.tab ?? "friends");
      break;
    case "challenges":
      challengesModal();
      break;
    case "progress":
      progressModal();
      break;
    case "collection":
      collectionModal(el.dataset.kind ?? "frame", el.dataset.preview ?? null);
      break;
    case "equip":
      cmd("equip", { id: el.dataset.id });
      setTimeout(() => collectionModal(el.dataset.kind, el.dataset.id), 250);
      break;
    case "friendRequest":
    case "friendAccept":
    case "friendDecline":
    case "friendRemove":
      cmd(a, { id: el.dataset.id });
      if (a === "friendRequest") toast("Demande d’ami envoyée");
      if ($("#modal").open && $(".friends-modal")) setTimeout(() => friendsModal(a === "friendRequest" ? "search" : "requests"), 250);
      break;
    case "favorite":
      cmd("favorite", { id: el.dataset.id, on: el.dataset.on === "true" });
      setTimeout(() => friendsModal("friends"), 250);
      break;
    case "inviteFriend":
      cmd("invite", { id: el.dataset.id });
      toast("Invitation envoyée");
      break;
    case "inviteOpen": {
      const inv = state.player.invites.find((i) => i.id === el.dataset.id);
      if (!inv || needFunds(inv.stake)) break;
      joinConfirm({ rules: inv.rules, stake: inv.stake }, "inviteAccept", `data-id="${inv.id}"`);
      break;
    }
    case "inviteAccept":
    case "inviteDecline":
      cmd(a, { id: el.dataset.id });
      closeModal();
      break;
    case "player":
      sheet = "player:" + el.dataset.id;
      if (state.table?.game) render();
      else modal(`<div class="sheet-lite">${playerSheet(el.dataset.id)}</div>`, "sheet-modal");
      break;
    case "hide":
    case "block":
      cmd(a, { id: el.dataset.id, on: el.dataset.on === "true" });
      toast(a === "block" ? (el.dataset.on === "true" ? "Joueur bloqué" : "Joueur débloqué") : el.dataset.on === "true" ? "Messages masqués" : "Messages affichés");
      sheet = null;
      closeModal();
      render();
      break;
    case "reportPlayer":
      sheet = null;
      render();
      reportModal(el.dataset.id, el.dataset.name);
      break;
    case "react":
      sheet = sheet === "react" ? null : "react";
      render();
      break;
    case "sendReaction":
      cmd("react", { id: el.dataset.id });
      sheet = null;
      render();
      break;
    case "toggleAnim":
      cmd("settings", { animations: !state.player.settings.animations });
      break;
    case "rematchYes":
      if (state.table.stake && needFunds(state.table.stake)) break;
      cmd("rematchVote", { accept: true });
      break;
    case "rematchNo":
      cmd("rematchVote", { accept: false });
      break;
    case "dismissResult":
      cmd("dismissResult");
      closeModal();
      break;
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
    case "reviewAlert":
      await adminRequest({ type: "reviewAlert", id: el.dataset.id });
      break;
    case "cancelGame":
      if (confirm("Annuler cette partie ? Les crédits engagés seront libérés sans gain ni perte.")) await adminRequest({ type: "cancelGame", id: el.dataset.id });
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
  const k = ev.target.dataset?.setting;
  if (k) cmd("settings", { [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value });
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
    const open = d.reports.filter((r) => !r.resolved);
    const alerts = d.alerts.filter((x) => !x.reviewed);
    $("#admin-result").innerHTML = `
      <div class="admin-stats"><div><b>${d.players.length}</b><small>joueurs</small></div><div><b>${d.tables.length}</b><small>tables</small></div><div><b>${open.length}</b><small>signalements</small></div><div><b>${alerts.length}</b><small>alertes</small></div></div>
      <p class="muted small">Crédits en circulation : ${fmt(d.economy.circulating)} · engagés : ${fmt(d.economy.reserved)} · achats ${d.economy.purchases ? "ouverts" : "fermés"} (web ${d.economy.stripe ? "✓" : "—"}, iOS ${d.economy.apple ? "✓" : "—"}, Android ${d.economy.google ? "✓" : "—"})</p>
      ${btn(d.settings.maintenance ? "Rouvrir les entrées" : "Suspendre les nouvelles entrées", "maintenance", "chip-btn", `data-enabled="${!d.settings.maintenance}"`)}
      <h3>Alertes à examiner</h3><p class="muted small">Indices combinés, jamais une preuve : aucune sanction automatique.</p>
      ${alerts.map((x) => `<div class="admin-card"><b>${e(x.kind)}</b><small>${when(x.at)} · ${x.names.map(e).join(", ")}</small><ul>${x.indicators.map((i) => `<li>${e(i)}</li>`).join("")}</ul>${btn("Marquer comme examinée", "reviewAlert", "chip-btn", `data-id="${x.id}"`)}</div>`).join("") || "<p>Aucune alerte.</p>"}
      <h3>Signalements</h3>
      ${open.map((r) => `<div class="admin-card"><b>${e(r.reason)}${r.targetName ? ` · ${e(r.targetName)}` : ""}</b><small>${when(r.at)} · par ${e(r.byName ?? r.by)}${r.gameId ? ` · partie ${e(r.gameId.slice(0, 8))}, donne ${r.deal ?? "—"}` : ""}</small>${r.comment ? `<p>${e(r.comment)}</p>` : ""}${r.context?.chat?.length ? `<p class="muted small">Messages : ${r.context.chat.map((m) => e(m.text)).join(" · ")}</p>` : ""}${r.context?.reactions?.length ? `<p class="muted small">${r.context.reactions.length} réaction(s) récente(s)</p>` : ""}${btn("Traiter", "resolveReport", "chip-btn", `data-id="${r.id}"`)}</div>`).join("") || "<p>Aucun signalement ouvert.</p>"}
      <h3>Tables</h3>${d.tables.map((t) => row(`${e(t.name)} · ${e(t.status)}${t.stake ? ` · 🪙 ${t.stake}` : ""}`, t.engaged ? btn("Annuler (incident)", "cancelGame", "chip-btn danger", `data-id="${t.id}"`) : btn("Supprimer", "deleteTable", "chip-btn", `data-id="${t.id}"`, t.status === "Partie en cours"))).join("")}
      <h3>Joueurs</h3>${d.players.map((p) => row(`${e(p.name)} · ${e(p.tag ?? "")} · ${p.stats.games} parties`, btn(p.banned ? "Réactiver" : "Suspendre", "suspendPlayer", "chip-btn", `data-id="${p.id}" data-enabled="${!p.banned}"`))).join("")}`;
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
        if (f.id === "create-form" && needFunds(Number(d.stake))) return;
        cmd(f.id === "create-form" ? "create" : "rules", { name: d.name, password: d.password || undefined, vip: d.vip === "true", rules: r, stake: Number(d.stake ?? 0) });
        break;
      }
      case "search-form": {
        const id = crypto.randomUUID();
        pendingAcks[id] = (m) => {
          const ul = $("#search-results");
          if (ul)
            ul.innerHTML =
              m.found.map((o) => `<li class="friend">${avatar(o.avatar)}<div><b>${e(o.name)}</b><small>${e(o.tag)}</small></div>${o.friend ? "<small>Ami</small>" : o.pending ? "<small>Demande envoyée</small>" : btn("Ajouter", "friendRequest", "pill small", `data-id="${o.id}"`)}</li>`).join("") || '<li class="empty">Aucun joueur trouvé.</li>';
        };
        ws.send(JSON.stringify({ id, type: "search", data: d }));
        return;
      }
      case "report-player-form":
        cmd("report", d);
        toast("Merci, le signalement a été transmis à la modération");
        break;
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
      if (msg.type === "ack" && pendingAcks[msg.id]) {
        pendingAcks[msg.id](msg);
        delete pendingAcks[msg.id];
      }
      if (msg.type === "state") {
        if (state.player.invites.length > seenInvites) {
          toast(`📨 ${state.player.invites.at(-1).from} vous invite à « ${state.player.invites.at(-1).table} »`);
          tone([660, 990], 0.08, 0.05);
        }
        seenInvites = state.player.invites.length;
        if (state.player.lastResult && !$("#modal").open && !state.table) resultModal({ ...state.player.lastResult, table: state.player.lastResult.table });
        const r = state.table?.reactions?.at(-1);
        if (r && r.id !== lastReactionSeen) {
          lastReactionSeen = r.id;
          setTimeout(render, 3600);
        }
      }
      if (msg.type === "ack" && msg.invitation)
        rulesModal(msg.invitation.rules, `<p class="muted small">Table « ${e(msg.invitation.name)} »</p>${btn("Accepter et demander une place", "confirmVip", "cta small wide")}`);
      if (msg.type === "error") {
        if (/Solde insuffisant/.test(msg.message)) fundsModal(state.table?.stake ?? 100);
        toast(msg.message);
      }
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
