import { cardImage } from "./cards.js";
import { nextTip } from "./tips.js";
// Les 32 cartes sont chargées et décodées d'avance : une carte jouée s'affiche aussitôt, jamais en rectangle blanc.
const CARD_CACHE = [];
setTimeout(() => {
  for (const s of "SHDC") for (const r of ["7", "8", "9", "10", "J", "Q", "K", "A"]) {
    const img = new Image();
    img.decoding = "async";
    img.src = cardImage(r + s);
    img.decode?.().catch(() => {});
    CARD_CACHE.push(img);
  }
}, 300);

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
const AVATARS = ["jacques", "sophie", "camille", "emma", "malik", "henri", "leo", "chat", "chien"];
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
const stakeRisk = (s) => `Mise : ${fmt(s)} crédits. En rubicon, vous risquez jusqu’à ${fmt(2 * s)} crédits (double de la mise), dans la limite de votre solde engagé. Les gains dépendent des crédits engagés par les adversaires.`;
const DEFAULT_RULES = {
  target: 1500,
  turnSeconds: 20,
  counterWindowSeconds: 8,
  reconnectSeconds: 90,
  capotValue: 250,
  scoring: "added",
  allPass: "rotate",
  flyingCounter: true,
  beloteRetained: false,
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
    : /^robot-[a-z]+$/.test(v ?? "")
      ? `/avatars/${v}.svg`
      : /^av-(?:\d\d|or-\d|roi-\d)$/.test(v ?? "")
        ? `/shop/avatars/${v}.webp`
        : `/avatars/${AVATARS.includes(v) ? v : "jacques"}.webp`;
// Les avatars de la boutique ont déjà leur propre cadre (doré, couronne) : on n'y ajoute pas d'anneau.
const avatar = (v, cls = "") => `<img class="avatar ${cls} ${/^av-/.test(v ?? "") ? "framed" : ""}" src="${avatarUrl(v)}" alt="" draggable="false">`;
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
  bidSuit = null,
  resetToken = null,
  shopConfig = null,
  seenInvites = 0,
  lastReactionSeen = null,
  pendingName = null; // pseudo choisi à l'inscription, envoyé dès la nouvelle session ouverte
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
  if (!res.ok) throw Object.assign(Error(d.error ?? "Une erreur est survenue"), { status: res.status });
  return d;
}
// Bruit de carte posée : court froissement filtré (sans fichier son).
let audioCtx = null;
function cardSound(vol = 0.5) {
  if (!sound) return;
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx,
      len = Math.floor(ctx.sampleRate * 0.09),
      buf = ctx.createBuffer(1, len, ctx.sampleRate),
      data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(),
      bp = ctx.createBiquadFilter(),
      g = ctx.createGain();
    src.buffer = buf;
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    g.gain.value = 0.35 * vol;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  } catch {}
}
// Arrivée d'une carte au centre : elle part de la main (ou de l'avatar du joueur) et se pose en glissant.
let lastPlayRect = null;
function animateTrick() {
  if (!state.player.settings.animations) return;
  for (const el of document.querySelectorAll(".trick:not(.collecting) .tcard:not(.seen)")) {
    const rel = Number(/p(\d)/.exec(el.className)?.[1] ?? 0);
    let from = null;
    if (rel === 0 && lastPlayRect && performance.now() - lastPlayRect.at < 1500) from = lastPlayRect;
    else from = document.querySelector(rel === 0 ? ".hand" : `.seat.p${rel} .seat-avatar`)?.getBoundingClientRect();
    const to = el.getBoundingClientRect();
    if (!from || !to.width) continue;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2),
      dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const start = rel === 0 ? Math.min(1.25, (from.width || to.width) / to.width) : 0.45;
    el.style.animation = "none";
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${rel === 0 ? -8 : rel === 1 ? -25 : 25}deg) scale(${start})`, opacity: rel === 0 ? 1 : 0.4 },
        { transform: "translate(0, -6px) rotate(0deg) scale(1.04)", opacity: 1, offset: 0.82 },
        { transform: "none", opacity: 1 },
      ],
      { duration: rel === 0 ? 360 : 420, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
    cardSound(rel === 0 ? 1 : 0.55);
  }
}
function tone(freqs, dur = 0.12, vol = 0.06) {
  return; // bips désactivés : seul le bruit de carte est conservé
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
      <li>Fournir, couper, surcouper, monter à l’atout ; sans surcoupe possible, carte libre (pas de sous-coupe) ; partenaire maître : défausse libre</li>
      <li>Tour de ${r.turnSeconds} s · absence : un robot joue après ${r.reconnectSeconds} s, jusqu’à votre retour</li>
    </ul>${action}`,
    "sheet-modal",
  );
}

// ———————————————————————————————————————————————————————————— lobby
function invitesBlock() {
  const inv = state.player.invites;
  if (!inv.length) return "";
  return `<section class="invites">${inv.map((i) => `<article class="invite-card ${i.vip ? "vip" : ""}">
    <span class="inv-icon">${i.vip ? "👑" : "🃏"}</span>
    <div><b>${e(i.from)} vous invite</b><small>${e(i.table)} · ${i.stake ? `mise ${fmt(i.stake)} crédits` : "partie gratuite"} · ${i.free} place${i.free > 1 ? "s" : ""} libre${i.free > 1 ? "s" : ""} · ${i.rules.target} pts</small></div>
    ${btn("Voir", "inviteOpen", "pill small", `data-id="${i.id}"`)}${btn("✕", "inviteDecline", "chip-btn ghost", `data-id="${i.id}" aria-label="Refuser"`)}
  </article>`).join("")}</section>`;
}
// ———————————————————————————————————————————————————————————— boutique Prestige
// En-tête commun (accueil et boutique) : logo à gauche, solde à droite avec « + » pour acheter des jetons.
function coinHead(extra = "") {
  return `<span class="shop-logo"><img src="/decor/logo.webp" alt="Belote Prestige"></span>
    <div class="shop-balance"><button type="button" class="sb-main" data-action="wallet" aria-label="Portefeuille"><i class="coin big"></i><b>${jetons(state.player.wallet.available / 2)}</b></button><button type="button" class="plus" data-action="shop" aria-label="Acheter des jetons">+</button></div>${extra}`;
}
const SHOP_FILTERS = [["avatars", "Avatars"], ["cartes", "Cartes"], ["decors", "Table"], ["emojis", "Emojis"], ["owned", "Possédés"]];
const FILTER_CATS = { avatars: ["classic", "gold", "crown"], cartes: ["back"], decors: ["felt"], emojis: ["emoji"] };
const CAT_ART = { classic: "av-04", gold: "av-or-4", crown: "av-roi-2", back: "dos-violet", felt: "tapis-violet", emoji: "emo-02" };
const shopItem = (id) => state.player.shop?.items.find((x) => x.id === id);
const ownedShop = (kind) => (state.player.shop?.items ?? []).filter((x) => x.owned && (!kind || x.kind === kind));
const favEmojis = () => (state.player.shop?.favorites ?? []).map(shopItem).filter(Boolean);
const jetons = (n) => `${fmt(n).replace(/\s/g, "\u00a0")} jetons`;
function itemStatus(it) {
  if (!it.owned) return "available";
  const p = state.player;
  const on = it.kind === "avatar" ? p.avatar === it.id : it.kind === "emoji" ? p.shop.favorites.includes(it.id) : p.progress.equipped[it.kind] === it.id;
  return on ? "equipped" : "owned";
}
const STATUS_LABEL = { available: "Disponible", owned: "Possédé", equipped: "Équipé" };
function catArt(cat) {
  const it = shopItem(CAT_ART[cat]);
  if (cat === "back") {
    const backs = ["dos-violet", "dos-rouge", "dos-violet", "dos-bleu"].map(shopItem).filter(Boolean);
    return `<span class="sart sa-fan">${backs.map((b, i) => `<img class="f${i}" src="${b.img}" alt="">`).join("")}</span>`;
  }
  return it ? `<span class="sart sa-${cat}"><img src="${it.img}" alt=""></span>` : "";
}
function boutiquePage() {
  const p = state.player,
    f = page.params.f ?? "all",
    cat = page.params.cat;
  const cats = state.player.shop?.categories ?? [];
  const chips = `<div class="shop-chips" role="tablist">${SHOP_FILTERS.map(([k, l]) => btn(l, "shopFilter", `shop-chip ${f === k && !cat ? "on" : ""}`, `data-f="${k}" role="tab"`)).join("")}</div>`;
  let body;
  if (f === "all" && !cat)
    body = `<div class="shop-grid">${cats
      .map((c) => {
        const prices = (p.shop?.items ?? []).filter((x) => x.cat === c.id).map((x) => x.price);
        const price = prices.length ? Math.min(...prices) : c.price;
        return `<article class="shop-card cat-${c.id}"><h3>${e(c.name)}</h3>${catArt(c.id)}<p class="price"><i class="coin"></i>${jetons(price)}</p>${btn("Voir", "shopCat", "shop-voir", `data-cat="${c.id}"`)}</article>`;
      })
      .join("")}</div>`;
  else {
    const list = (p.shop?.items ?? []).filter((x) => (cat ? x.cat === cat : f === "owned" ? x.owned : FILTER_CATS[f]?.includes(x.cat)));
    const title = cat ? cats.find((c) => c.id === cat)?.name : SHOP_FILTERS.find(([k]) => k === f)?.[1];
    body = `${cat ? `<button type="button" class="shop-back" data-action="shopFilter" data-f="all">${icon("back", "tiny")} Toutes les catégories</button>` : ""}<h2 class="shop-sub">${e(title ?? "")}</h2>
      <div class="shop-grid sg-items">${
        list
          .map((it) => {
            const st = itemStatus(it);
            return `<article class="shop-card item k-${it.kind} st-${st}"><h3>${e(it.name)}</h3><span class="sart sa-${it.cat}"><img src="${it.img}" alt=""></span>${st === "available" ? `<p class="price"><i class="coin"></i>${jetons(it.price)}</p>` : `<p class="status ${st}">${st === "equipped" ? icon("check", "tiny") : ""}${STATUS_LABEL[st]}</p>`}${btn("Voir", "shopItem", "shop-voir", `data-id="${it.id}"`)}</article>`;
          })
          .join("") || `<p class="empty">${f === "owned" ? "Vous ne possédez encore aucun article de la boutique." : "Aucun article."}</p>`
      }</div>`;
  }
  return shell(
    `<div class="shop-head">
      ${coinHead()}
      <h1>La boutique Prestige</h1>
      ${btn("Acheter des jetons", "shop", "shop-buy-coins")}
      <p class="shop-tagline">Personnalisez votre jeu · Achats à l’unité</p>
    </div>
    ${chips}${body}
    <p class="shop-foot">${icon("check", "tiny")} Goodies conservés · Aucun avantage de jeu</p>`,
    { backBtn: false, tabs: true, cls: "page-boutique page-coinhead" },
  );
}
// Aperçu « en situation » : l'article tel qu'il apparaîtra pendant une partie.
function shopPreview(it) {
  const p = state.player;
  if (it.kind === "avatar") return `<div class="pv-scene felt-scene"><div class="pv-seat">${avatar(it.id, "pv-av")}<b>${e(p.name)}</b></div></div>`;
  if (it.kind === "back") return `<div class="pv-scene felt-scene"><div class="pv-backs-fan">${[0, 1, 2, 3, 4].map((i) => `<img class="b${i}" src="${it.img}" alt="">`).join("")}</div></div>`;
  if (it.kind === "felt") return `<div class="pv-scene"><div class="pv-table"><img class="pv-felt-img" src="${it.img}" alt=""><span class="pv-cards">${["AS", "10H", "KD", "9C"].map((c) => `<img src="${cardImage(c)}" alt="">`).join("")}</span></div></div>`;
  return `<div class="pv-scene felt-scene"><div class="pv-seat">${avatar(p.avatar, "pv-av")}<b>${e(p.name)}</b><span class="pv-emo"><img src="${it.img}" alt=""></span></div></div>`;
}
function shopItemModal(id) {
  const it = shopItem(id);
  if (!it) return;
  const st = itemStatus(it);
  const fav = state.player.shop.favorites;
  const action =
    st === "available"
      ? btn(`Acheter · ${jetons(it.price)}`, "shopBuyAsk", "gold-btn wide", `data-id="${it.id}"`)
      : it.kind === "emoji"
        ? st === "equipped"
          ? btn("Retirer de mes favoris", "shopUse", "line-btn wide", `data-id="${it.id}"`)
          : btn(fav.length >= 8 ? "Favoris complets (8 au maximum)" : "Utiliser · ajouter aux favoris", "shopUse", "gold-btn wide", `data-id="${it.id}"`, fav.length >= 8)
        : st === "equipped"
          ? `<p class="status equipped big">${icon("check", "tiny")} Équipé</p>`
          : btn("Utiliser", "shopUse", "gold-btn wide", `data-id="${it.id}"`);
  modal(
    `<div class="shop-modal"><h2>${e(it.name)}</h2><p class="muted">${e(state.player.shop.categories.find((c) => c.id === it.cat)?.name ?? "")}</p>
      ${it.kind === "felt" ? "" : `<div class="shop-modal-art sa-${it.cat}"><img src="${it.img}" alt=""></div>`}
      ${shopPreview(it)}
      <div class="shop-modal-meta"><span><i class="coin"></i>${jetons(it.price)}</span><span class="status ${st}">${STATUS_LABEL[st]}</span></div>
      ${action}
      ${it.kind === "felt" && state.player.progress.equipped.felt?.startsWith("tapis-") ? btn("Revenir au tapis vert d’origine", "feltDefault", "line-btn wide") : ""}
      <p class="muted small">${it.kind === "back" || it.kind === "felt" ? "Visible uniquement sur votre écran : les autres joueurs gardent leurs propres choix." : it.kind === "emoji" ? "Apparaît quelques secondes près de votre avatar, sans masquer les cartes." : "Visible par tous les joueurs à votre table."} Purement cosmétique, aucun avantage de jeu.</p></div>`,
    "sheet-modal shop-item-modal",
  );
}
function shopFundsModal(it, missing) {
  modal(
    `<div class="confirm"><span class="confirm-icon">🪙</span><h2>Solde insuffisant</h2>
    <p>${e(it.name)} coûte <b>${jetons(it.price)}</b>. Il vous manque <b>${jetons(missing)}</b>.</p>
    <p class="muted small">Les jetons engagés dans une partie en cours ne peuvent pas être dépensés.</p>
    <div class="stack">${btn("Acheter des jetons", "shop", "gold-btn wide")}${btn("Plus tard", "close", "line-btn wide")}</div></div>`,
    "confirm-modal",
  );
}
function shopBuyAsk(id) {
  const it = shopItem(id),
    p = state.player;
  if (!p.account) {
    go("register");
    return toast("Créez un compte pour acheter dans la boutique");
  }
  const avail = p.wallet.available / 2;
  if (avail < it.price) return shopFundsModal(it, it.price - avail);
  modal(
    `<div class="confirm"><div class="shop-modal-art sa-${it.cat} small"><img src="${it.img}" alt=""></div><h2>Acheter ${e(it.name)} ?</h2>
    <div class="buy-lines"><div><span>Prix</span><b>${jetons(it.price)}</b></div><div><span>Solde disponible</span><b>${jetons(avail)}</b></div><div class="after"><span>Solde après achat</span><b>${jetons(avail - it.price)}</b></div></div>
    <div class="stack">${btn("Confirmer l’achat", "shopBuy", "gold-btn wide", `data-id="${it.id}"`)}${btn("Annuler", "close", "line-btn wide")}</div></div>`,
    "confirm-modal",
  );
}
let shopBuying = false;
function shopBuy(id) {
  if (shopBuying) return; // double appui : une seule requête
  shopBuying = true;
  setTimeout(() => (shopBuying = false), 3000);
  ask("shopBuy", { id }, () => {
    shopBuying = false;
    tone([523, 659, 784], 0.08, 0.05);
    toast("Achat réussi !");
    reopenWhen(id, (it) => it.owned);
  });
}
// La fiche se rouvre dès que l'état synchronisé du serveur reflète l'achat ou l'équipement.
function reopenWhen(id, ready, tries = 40) {
  const it = shopItem(id);
  if ((it && ready(it)) || tries <= 0) return shopItemModal(id);
  setTimeout(() => reopenWhen(id, ready, tries - 1), 75);
}
function shopUse(id) {
  const it = shopItem(id);
  if (it.kind === "avatar") cmd("profile", { avatar: id });
  else if (it.kind === "emoji") {
    const fav = state.player.shop.favorites;
    cmd("shopFavorites", { ids: fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id] });
  } else cmd("equip", { id });
  toast(it.kind === "emoji" ? "Favoris mis à jour" : "C’est équipé !");
  const before = itemStatus(it);
  reopenWhen(id, (x) => itemStatus(x) !== before);
}

// Astuce de joueur : une par moment (table, donne), stable d'un rafraîchissement à l'autre.
const tipCache = new Map();
function tipLine(key) {
  if (!tipCache.has(key)) tipCache.set(key, nextTip());
  const tip = tipCache.get(key);
  return `<p class="tip-line"><span>💡 Astuce · ${e(tip.category)}</span>${e(tip.text)}</p>`;
}

// ———————————————————————————————————————————————————————————— salon d'attente
// Joueurs connectés à proposer : une touche les invite ; sans réponse, un robot prend la place.
function onlineBlock(t, me, free) {
  const list = state.online ?? [];
  if (t.quick || me < 0 || !free) return "";
  return `<h2 class="section">Joueurs en ligne <small class="muted">(${list.length})</small></h2>
    <div class="list online-list">${
      list
        .map((o) => `<div class="online-row">${avatar(o.avatar)}<span><b>${e(o.name)}</b><small>${o.friend ? "Ami · " : ""}${o.busy ? "En partie" : "Disponible"}</small></span>${o.invited ? '<span class="tag-ok">Invité ✓</span>' : btn("Inviter", "inviteOnline", "gold-btn small", `data-id="${o.id}"`, o.busy)}</div>`)
        .join("") || '<p class="empty">Personne d’autre n’est connecté pour l’instant.</p>'
    }</div>
    ${t.fillBots && !t.stake ? `<p class="hint mid">Sans réponse sous ${45} s, des robots complètent la table et la partie démarre.</p>` : ""}`;
}
// ———————————————————————————————————————————————————————————— table de jeu
function sheetView(g, t, me) {
  if (!sheet) return "";
  const close = btn("✕", "closeSheet", "sheet-close", 'aria-label="Fermer"');
  let body = "";
  if (sheet === "react")
    body = `${favEmojis().length ? `<h3>Mes emojis</h3><div class="react-grid emo-grid">${favEmojis().map((it) => btn(`<img src="${it.img}" alt="${e(it.name)}">`, "sendReaction", "react-btn emo", `data-id="${it.id}"`)).join("")}</div>` : ""}<h3>Réactions</h3><div class="react-grid">${REACTIONS.map((r) => btn(`<b>${r.emoji}</b>${r.text ? `<small>${e(r.text)}</small>` : ""}`, "sendReaction", "react-btn", `data-id="${r.id}"`)).join("")}</div><p class="muted small">Messages prédéfinis : impossible d’y décrire sa main. Une réaction toutes les quelques secondes.</p>`;
  if (sheet?.startsWith("player:")) body = playerSheet(sheet.slice(7));
  if (sheet === "menu")
    body = `<h3>Menu de la partie</h3><div class="menu-list">
      ${btn("📣 Annonces de la donne", "auction", "menu-item")}
      ${btn("📊 Scores des donnes", "scores", "menu-item")}
      ${btn("💬 Discussion", "chat", "menu-item")}
      ${btn("📜 Règles de la table", "rulesInfo", "menu-item")}
      ${btn(sound ? "🔊 Sons activés" : "🔇 Sons coupés", "sound", "menu-item")}
      ${btn(state.player.settings.animations ? "✨ Animations activées" : "✨ Animations réduites", "toggleAnim", "menu-item")}
      ${t.money ? `<div class="menu-info">${coins(t.money.stake)} mise · ${fmt(t.money.seats.find((x) => x.seat === me)?.engaged ?? 0)} engagés · rubicon jusqu’à ${fmt(2 * t.money.stake)}</div>` : ""}
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
// ———————————————————————————————————————————————————————————— pages (maquettes « Contrée »)
const ICONS = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cards: '<rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8 12)"/><rect x="10" y="4" width="11" height="15" rx="2" transform="rotate(8 15 11)"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.8 3.5-5.5 6.5-5.5s5.7 1.7 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.5c2.6.2 4.4 1.8 5 4.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4M8.6 13.4l6.8 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="m15 8 4 4-4 4M19 12H9"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>',
  chart: '<path d="M5 20V12M10 20V8M15 20V4M20 20v-6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M3 9h18v-3H3zM12 6v14M12 6c-2-3-6-3-6 0M12 6c2-3 6-3 6 0"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  shop: '<path d="M4 9h16l-1.5-4h-13zM5 9v10h14V9M9 19v-5h6v5M4 9c0 1.7 1.3 3 3 3s2.7-1.3 2.7-3c0 1.7 1.2 3 2.3 3s2.3-1.3 2.3-3c0 1.7 1 3 2.7 3s3-1.3 3-3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01"/>',
};
const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
const logo = (sub = "") => `<div class="logo"><img class="logo-img" src="/decor/logo.webp" alt="Belote Prestige" draggable="false">${sub ? `<em>${sub}</em>` : ""}</div>`;
let page = { name: null, params: {} },
  pageStack = [];
function go(name, params = {}) {
  if (page.name && page.name !== name) pageStack.push(page);
  page = { name, params };
  closeModal();
  render();
  scrollTo(0, 0);
}
function back() {
  page = pageStack.pop() ?? { name: "home", params: {} };
  render();
}
function shell(body, { backBtn = true, tabs = false, vip = false, cls = "", right = "", sub = "" } = {}) {
  return `<div class="page ${vip ? "theme-vip" : "theme-club"} ${cls}">
    <div class="ambient" aria-hidden="true"><i class="lamp l1"></i><i class="lamp l2"></i><i class="leaf f1"></i><i class="leaf f2"></i></div>
    <header class="page-top">${backBtn ? btn(icon("back"), "back", "round-btn", 'aria-label="Retour"') : '<span class="round-spacer"></span>'}${logo(sub || (vip ? "Club VIP" : ""))}${right || '<span class="round-spacer"></span>'}</header>
    <main class="page-body">${body}</main>
    ${tabs ? tabBar() : ""}
  </div>`;
}
function tabBar() {
  const t = (name, label, ic) => `<button type="button" class="tab ${page.name === name || (name === "home" && ["home", "vip"].includes(page.name)) ? "on" : ""}" data-action="go" data-page="${name}">${icon(ic)}<span>${label}</span></button>`;
  return `<nav class="tabbar" aria-label="Navigation">${t("home", "Accueil", "home")}${t("tables", "Jouer", "cards")}${t("boutique", "Boutique", "shop")}${t("settings", "Compte", "user")}</nav>`;
}
const field = (ic, name, type, label, extra = "") =>
  `<label class="field">${icon(ic)}<input name="${name}" type="${type}" placeholder="${label}" aria-label="${label}" ${extra}>${type === "password" ? `<button type="button" class="eye" data-action="peek" aria-label="Afficher le mot de passe">${icon("eye")}</button>` : ""}</label>`;
function socialButtons() {
  const b = (p, label, logoHtml) =>
    `<button type="button" class="social ${p}" data-action="oidc" data-provider="${p}" ${authConfig[p] ? "" : "disabled"}>${logoHtml}<span>${label}</span>${authConfig[p] ? "" : "<small>bientôt</small>"}</button>`;
  return `<div class="or"><span>Ou continuer avec</span></div><div class="socials">${b("apple", "Continuer avec Apple", '<span class="s-apple"></span>')}${b("google", "Continuer avec Google", '<span class="s-google">G</span>')}</div>`;
}
const levelTitle = () => {
  const l = state.player.progress.level;
  return ["Joueur débutant", "Joueur habitué", "Joueur confirmé", "Joueur expert", "Pilier du salon"][l.index] ?? "Joueur passionné";
};

function welcomePage() {
  return shell(
    `<div class="welcome">
      <img class="art welcome-art" src="/decor/accueil.webp" alt="" draggable="false">
      <h1 class="script">À vous de jouer !</h1><div class="orn-line">✦</div>
      <div class="mini-fan">${["7S", "8H", "9D", "JC", "QS", "10H", "AC", "KD"].map((c, i) => `<img class="mf${i}" src="${cardImage(c)}" alt="">`).join("")}</div>
      <div class="stack">${btn("Créer un compte", "go", "gold-btn wide", 'data-page="register"')}${btn("Se connecter", "go", "line-btn wide", 'data-page="login"')}${btn(`${icon("cards")} Découvrir le jeu`, "discover", "text-link")}</div>
    </div>`,
    { backBtn: false, cls: "page-welcome" },
  );
}
function registerPage() {
  return shell(
    `<h1 class="page-title">Créer mon compte</h1>
    <form id="register-form" class="stack">
      ${field("user", "name", "text", "Pseudo", 'minlength="2" maxlength="24" autocomplete="nickname" required')}
      ${field("mail", "email", "email", "E-mail", 'autocomplete="email" required')}
      ${field("lock", "password", "password", "Mot de passe", 'minlength="8" autocomplete="new-password" required')}
      <label class="check"><input type="checkbox" name="terms" required><span></span>J’accepte les ${btn("conditions d’utilisation", "go", "inline-link", 'data-page="legal"')} et la ${btn("politique de confidentialité", "go", "inline-link", 'data-page="legal"')}.</label>
      <button class="gold-btn wide">Créer mon compte</button>
    </form>
    ${socialButtons()}
    <p class="foot-link">Déjà inscrit ? ${btn("Se connecter", "go", "inline-link", 'data-page="login"')}</p>`,
  );
}
function loginPage() {
  const last = localStorage.getItem("lastAvatar") || "jacques";
  return shell(
    `<h1 class="page-title">Heureux de vous revoir !</h1>
    <div class="hero-avatar">${avatar(last, "xxl")}</div>
    <form id="login-form" class="stack">
      ${field("mail", "email", "email", "E-mail", `autocomplete="email" required value="${e(localStorage.getItem("lastEmail") ?? "")}"`)}
      ${field("lock", "password", "password", "Mot de passe", 'minlength="8" autocomplete="current-password" required')}
      <div class="right">${btn("Mot de passe oublié ?", "go", "inline-link", 'data-page="forgot"')}</div>
      <button class="gold-btn wide">Se connecter</button>
    </form>
    ${socialButtons()}`,
  );
}
function forgotPage() {
  return shell(
    `<img class="art illus" src="/decor/cle.webp" alt="" draggable="false">
    <h1 class="page-title">Retrouver mon compte</h1>
    <p class="lead">Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.</p>
    <form id="forgot-form" class="stack">${field("mail", "email", "email", "E-mail", 'autocomplete="email" required')}<button class="gold-btn wide">Envoyer le lien</button></form>
    ${page.params.sent ? `<div class="ok-box">${icon("check", "ok-ico")}<div><b>Lien envoyé !</b><small>Si un compte existe, un e-mail vient de vous être envoyé.</small></div></div>` : ""}
    <hr class="sep">${btn(`${icon("back")} Retour à la connexion`, "go", "text-link", 'data-page="login"')}`,
  );
}
function resetPage() {
  return shell(
    `<img class="art illus" src="/decor/cle.webp" alt="" draggable="false"><h1 class="page-title">Nouveau mot de passe</h1>
    <form id="reset-form" class="stack">${field("lock", "password", "password", "Nouveau mot de passe", 'minlength="8" autocomplete="new-password" required')}<button class="gold-btn wide">Enregistrer</button></form>`,
  );
}
function verifyPage() {
  const a = state.player.account;
  return shell(
    `<img class="art illus" src="/decor/enveloppe.webp" alt="" draggable="false">
    <h1 class="page-title">Vérifiez votre e-mail</h1>
    <p class="lead">Un lien vous attend dans votre boîte mail${a?.email ? ` <b>${e(a.email)}</b>` : ""}.</p>
    <div class="stack">${btn("J’ai vérifié mon e-mail", "checkVerified", "gold-btn wide")}${btn(`${icon("refresh")} Renvoyer le lien`, "resend", "line-btn wide")}${btn(`${icon("pen")} Changer d’adresse e-mail`, "changeEmail", "text-link")}</div>`,
  );
}
function featureCard(action, data, cls, title, sub, art) {
  return `<button type="button" class="feature ${cls}" data-action="${action}" ${data}><span class="f-art">${art}</span><span class="f-text"><b>${title}</b><small>${sub}</small></span><span class="f-go">${icon("chevron")}</span></button>`;
}
function nextTourLine() {
  const t = (state.tournaments ?? []).find((x) => ["soon", "open", "closed", "ready", "running"].includes(x.stage));
  return t ? `${e(t.name)} · ${dt(t.start)}` : "Élimination directe sur inscription";
}
// Vérification de l'adresse : proposée seulement quand l'envoi d'e-mails est configuré sur le
// serveur (RESEND_API_KEY + BELOTE_MAIL_FROM). Sans cela, le compte est pleinement utilisable.
const needVerify = () => !!(state.player.account && !state.player.account.verified && authConfig.mail);
function homePage() {
  const p = state.player;
  const pending = p.friendIn.length;
  // Parties réellement en cours sur les tables publiques (chacune a au moins un joueur).
  const live = state.tables.filter((t) => t.status === "Partie en cours").length;
  return shell(
    `<div class="shop-head home-head">${coinHead()}</div>
    <div class="me-row">
      <button type="button" class="me" data-action="go" data-page="profile">${avatar(p.avatar, "lg ring")}<span><b>${e(p.name)} ${icon("chevron", "tiny")}</b><small>${levelTitle()}</small></span></button>
    </div>
    ${p.account && p.wallet.loginBonus ? `<p class="bonus-line">🎁 Prochain bonus de connexion (+${fmt(p.wallet.loginBonus.amount)}) dans <b data-countdown="${p.wallet.loginBonus.next}"></b></p>` : ""}
    ${needVerify() ? `<button type="button" class="notice-row" data-action="go" data-page="verify">${icon("mail")} Confirmez votre adresse e-mail ${icon("chevron", "tiny")}</button>` : ""}
    ${p.account ? "" : `<button type="button" class="notice-row" data-action="go" data-page="register">${icon("user")} Créez votre compte : 2 000 crédits offerts ${icon("chevron", "tiny")}</button>`}
    ${btn(`${icon("cards")} Jouer maintenant${p.account && p.wallet.available / 2 >= 200 ? '<small class="quick-stake">Partie à 200 jetons · gains contre les robots aussi</small>' : ""}`, "quick", "gold-btn wide big quick-btn")}
    ${live ? `<p class="live-now"><i class="live-dot"></i>${live} partie${live > 1 ? "s" : ""} en cours en ce moment</p>` : ""}
    ${invitesBlock()}
    <div class="features">
      ${featureCard("go", 'data-page="tables"', "f-public", "Tables publiques", "Jouez avec d’autres joueurs", '<img src="/decor/f-publiques.webp" alt="">')}
      ${featureCard("go", 'data-page="vip"', "f-vip", "Tables VIP", "Une expérience exclusive", '<img src="/decor/f-vip.webp" alt="">')}
      ${featureCard("go", 'data-page="tournaments"', "f-tour", "Tournois", nextTourLine(), '<img src="/decor/club-vip.webp" alt="">')}
      ${featureCard("practice", "", "f-bots", "Entraînement", "Progressez à votre rythme", '<img src="/decor/f-robot.webp" alt="">')}
    </div>
    <div class="quick-row">
      ${btn(`${icon("target")} Défis${p.progress.challenges.some((c) => !c.done) ? '<i class="dot"></i>' : ""}`, "challenges", "chip")}
      ${btn(`${icon("users")} Amis${pending ? `<i class="badge-n">${pending}</i>` : ""}`, "friends", "chip")}
      ${btn(`${icon("coin")} Boutique`, "go", "chip", 'data-page="boutique"')}
    </div>
    <div class="stat-strip"><div>${icon("trophy")}<b>${p.stats.wins}</b><small>Victoires</small></div><div>${icon("chart")}<b>${p.stats.games}</b><small>Parties</small></div></div>`,
    { backBtn: false, tabs: true, cls: "page-home page-coinhead" },
  );
}
function tablesPage() {
  const myPublic = state.player.myTables.filter((t) => !t.vip);
  // Seules les tables qu'on peut rejoindre : une place libre, pas de partie en cours.
  // Les parties rapides se remplissent toutes seules (« Jouer maintenant ») : jamais listées.
  const joinable = state.tables.filter((t) => !t.lobby && !t.quick && t.available > 0 && t.status !== "Partie en cours");
  return shell(
    `<h1 class="page-title">Tables publiques</h1>
    ${myPublic.length ? `<h2 class="section">Mes tables</h2><div class="list">${myPublic.map((t) => `<div class="row-del"><button type="button" class="vip-row pub" data-action="enterTable" data-id="${t.id}"><span class="vr-main"><b>${e(t.name)}</b><small>${t.stake ? `Mise ${fmt(t.stake)} jetons` : "Partie gratuite"}</small></span><span class="vr-count">${icon("users")} ${t.players}/4</span>${icon("chevron", "tiny")}</button>${btn(icon("trash"), "closeTableAsk", "round-btn small del-btn", `data-id="${t.id}" aria-label="Supprimer la table"`, t.playing)}</div>`).join("")}</div><h2 class="section">Toutes les tables</h2>` : ""}
    ${stakeTables()}
    ${joinable.length ? `<h2 class="section orn-title">Tables des joueurs</h2><div class="list">${joinable.map(tableCard).join("")}</div>` : ""}
    <div class="stack">${btn("Créer une table publique", "createPublic", "gold-btn wide")}${btn(`${icon("link")} Rejoindre avec un code`, "joinCode", "line-btn wide")}</div>`,
    { tabs: true, backBtn: false },
  );
}
// Tables permanentes avec mise : une carte par montant, « Jouer » regroupe les joueurs sans invitation.
const STAKE_LOOK = { 200: ["emeraude", "Table Émeraude"], 500: ["saphir", "Table Saphir"], 1000: ["royale", "Table Royale"] };
function stakeTables() {
  const levels = [...new Set(state.tables.filter((t) => t.lobby && t.stake).map((t) => t.stake))].sort((a, b) => a - b);
  if (!levels.length) return "";
  return `<h2 class="section orn-title">Tables avec mise</h2><div class="stake-grid">${levels
    .map((stake) => {
      const open = state.tables.filter((t) => t.lobby && t.stake === stake && t.status !== "Partie en cours");
      const waiting = Math.max(0, ...open.map((t) => 4 - t.available));
      const playing = state.tables.filter((t) => t.lobby && t.stake === stake && t.status === "Partie en cours").length;
      const [cls, title] = STAKE_LOOK[stake] ?? ["royale", `Table à ${fmt(stake)}`];
      return `<button type="button" class="stake-card ${cls}" data-action="playLobby" data-stake="${stake}">
        <span class="sc-chip"><b>${fmt(stake)}</b><small>jetons</small></span>
        <span class="sc-main"><b>${title}</b><small>Mise ${fmt(stake)} · gain jusqu’à +${fmt(2 * stake)}</small>
        <span class="sc-meta"><span class="sc-seats">${[0, 1, 2, 3].map((i) => `<i class="${i < waiting ? "on" : ""}"></i>`).join("")}</span>${waiting ? `${waiting}/4 en attente` : "Soyez le premier"}${playing ? ` · ${playing} en jeu` : ""}</span></span>
        <span class="sc-go">Jouer</span>
      </button>`;
    })
    .join("")}</div><p class="hint mid">Placés automatiquement avec les autres joueurs ; les places encore libres après quelques secondes sont prises par des robots.</p>`;
}
function tableCard(t) {
  const busy = t.status === "Partie en cours";
  const taken = 4 - t.available;
  return `<article class="table-card ${busy ? "busy" : ""}">
    <div class="tc-main"><b>${e(t.name)}</b><small>${t.quick ? "Partie rapide · " : ""}${t.rules.target} points · ${t.stake ? `mise ${fmt(t.stake)} jetons` : "gratuite"}</small></div>
    <span class="tc-count">${icon("users")} ${taken}/4</span>
    ${btn(busy ? "En jeu" : "Rejoindre", "join", "gold-btn small", `data-table="${t.id}"`, busy || !t.available)}
  </article>`;
}
function profilePage() {
  const p = state.player;
  const rate = p.stats.games ? Math.round((100 * p.stats.wins) / p.stats.games) : 0;
  return shell(
    `<div class="profile-hero"><div class="ph-avatar">${avatar(p.avatar, "xxl ring")}<label class="cam" aria-label="Ajouter une photo">${icon("camera")}<input type="file" accept="image/*" id="photo-input" hidden></label></div>
      <h1>${e(p.name)}</h1><small>${levelTitle()} · ${e(p.tag)}</small></div>
    <div class="stack tight">${btn(`${icon("pen")} Modifier mon pseudo`, "editName", "line-btn wide")}${btn(`${icon("users")} Choisir un avatar`, "go", "line-btn wide", 'data-page="avatar"')}<label class="line-btn wide">${icon("camera")} Ajouter une photo<input type="file" accept="image/*" id="photo-input-2" hidden></label></div>
    <div class="stat-card"><div>${icon("trophy")}<b>${p.stats.games}</b><small>Parties</small></div><div>${icon("crown")}<b>${p.stats.wins}</b><small>Victoires</small></div><div>${icon("chart")}<b>${rate} %</b><small>Réussite</small></div></div>
    ${levelBar(p.progress.level)}
    <h2 class="section">Mes dernières parties</h2>
    <div class="list">${p.history.slice(0, 3).map(gameRow).join("") || '<p class="empty">Votre première partie vous attend.</p>'}</div>
    ${p.history.length > 3 ? btn("Voir tout l’historique", "go", "text-link", 'data-page="history"') : ""}
    <div class="menu-card">
      ${menuLink("coin", "Portefeuille", "wallet")}${menuLink("users", "Amis", "friends")}${menuLink("target", "Défis du jour", "challenges")}${menuLink("trophy", "Niveau et badges", "progress")}${menuLink("star", "Personnalisation", "go", 'data-page="boutique" data-f="owned"')}${menuLink("chart", "Mes parties", "go", 'data-page="history"')}
    </div>`,
    { tabs: true, backBtn: false, right: btn(icon("menu"), "go", "round-btn", 'data-page="settings" aria-label="Réglages"') },
  );
}
const menuLink = (ic, label, action, data = "", right = "") => `<button type="button" class="menu-link" data-action="${action}" ${data}>${icon(ic)}<span>${label}</span>${right}${icon("chevron", "tiny")}</button>`;
function gameRow(h) {
  return `<div class="game-row ${h.won ? "won" : "lost"}">${avatar(state.player.avatar)}<div><b>${h.won ? "Victoire" : "Défaite"}${h.rubicon ? " · rubicon" : ""}</b><small>${when(h.date)} · ${e(h.table)}</small></div>
    <span class="gr-score">${h.scores.join(" / ")}${h.stake ? `<small class="${h.delta >= 0 ? "plus" : "minus"}">${coins(Math.abs(h.delta))} ${h.delta >= 0 ? "+" : "−"}</small>` : ""}</span></div>`;
}
function avatarPage() {
  const p = state.player;
  const pick = page.params.pick ?? p.avatar;
  const tab = page.params.tab ?? "illus";
  return shell(
    `<h1 class="page-title">Choisir mon avatar</h1>
    <div class="seg">${btn("Avatars illustrés", "avatarTab", tab === "illus" ? "on" : "", 'data-tab="illus"')}${btn("Ma photo", "avatarTab", tab === "photo" ? "on" : "", 'data-tab="photo"')}</div>
    ${
      tab === "illus"
        ? `<div class="avatar-grid big">${[...AVATARS, ...ownedShop("avatar").map((x) => x.id)].map((a) => `<button type="button" class="av-pick ${a === pick ? "on" : ""}" data-action="pickAvatar" data-avatar="${a}" aria-label="Avatar ${a}">${avatar(a)}${a === pick ? `<i class="tick">${icon("check")}</i>` : ""}</button>`).join("")}</div>
          ${btn("Utiliser cet avatar", "useAvatar", "gold-btn wide", `data-avatar="${pick}"`)}`
        : `<div class="photo-zone">${p.photo ? avatar(p.photo, "xxl ring") : '<span class="ph-empty">📷</span>'}</div>${p.photo ? btn("Utiliser ma photo", "useAvatar", "gold-btn wide", `data-avatar="${p.photo}"`) : ""}`
    }
    <div class="or"><span>Ou</span></div>
    <label class="line-btn wide">${icon("camera")} Ajouter ma photo<input type="file" accept="image/*" id="photo-input-3" hidden></label>
    ${page.params.onboarding ? btn("Plus tard", "afterAvatar", "text-link") : ""}`,
  );
}
function historyPage() {
  const tab = page.params.tab ?? "all";
  const list = state.player.history.filter((h) => tab === "all" || h.won);
  return shell(
    `<h1 class="page-title">Mes parties</h1>
    <div class="seg">${btn("Toutes", "historyTab", tab === "all" ? "on" : "", 'data-tab="all"')}${btn("Victoires", "historyTab", tab === "wins" ? "on" : "", 'data-tab="wins"')}</div>
    <div class="list">${list.map(gameRow).join("") || '<p class="empty">Aucune partie pour l’instant.</p>'}</div>`,
    { tabs: true },
  );
}
function rulesPage(r = state.table?.rules ?? DEFAULT_RULES) {
  const item = (ic, title, text) => `<div class="rule-item">${icon(ic, "big")}<div><b>${title}</b><small>${text}</small></div></div>`;
  return shell(
    `<h1 class="page-title">Règles de la table</h1><p class="lead">Un rappel des règles pour bien jouer ensemble.</p>
    ${item("target", `Objectif : <em>${fmt(r.target)} points</em>`, `La première équipe à ${fmt(r.target)} points remporte la partie.`)}
    ${item("bolt", `Contrée à la volée : <em>${r.flyingCounter ? "activée" : "désactivée"}</em>`, r.flyingCounter ? "Les adversaires du dernier enchérisseur peuvent contrer à tout moment des enchères." : "On ne contre qu’à son tour de parole.")}
    ${item("cards", "Enchères : <em>80 à 160 + capot</em>", `Les annonces se font par paliers de 10, avec la possibilité de capot (${r.capotValue}).`)}
    ${item("star", "Belote / rebelote : <em>20 points</em>", "Roi et dame d’atout : 20 points, annoncés automatiquement.")}
    <details class="rule-more">${'<summary>' + icon("cards") + " Jouer les cartes" + icon("chevron", "tiny") + "</summary>"}<p>Fournissez la couleur demandée. À l’atout, montez si possible. Sans la couleur, coupez et surcoupez, sauf si votre partenaire est maître. Ordre à l’atout : V, 9, A, 10, R, D, 8, 7 ; hors atout : A, 10, R, D, V, 9, 8, 7.</p></details>
    <details class="rule-more"><summary>${icon("chart")} Compter les points ${icon("chevron", "tiny")}</summary><p>Atout : V 20, 9 14, A 11, 10 10, R 4, D 3. Hors atout : A 11, 10 10, R 4, D 3, V 2. Dix de der : 10. Réussite : ${r.scoring === "added" ? "points réalisés + contrat" : "contrat seul"}, multiplié par la contre. Chute : 162 + contrat pour la défense.</p></details>
    <details class="rule-more"><summary>${icon("shield")} Contrer et surcontrer ${icon("chevron", "tiny")}</summary><p>Contre ×2, surcontre ×4. Après une contre, l’équipe preneuse a ${r.counterWindowSeconds} s pour surcontrer. La belote n’est jamais multipliée.</p></details>
    ${btn("Fermer", "back", "gold-btn wide")}`,
  );
}
function settingsPage() {
  const p = state.player,
    s = p.settings;
  const toggle = (k, ic, label, on) => `<label class="toggle-row">${icon(ic)}<span>${label}</span><input type="checkbox" data-setting="${k}" ${on ? "checked" : ""}><i class="sw"></i></label>`;
  return shell(
    `<h1 class="page-title">Réglages du compte</h1>
    <button type="button" class="profile-row" data-action="go" data-page="profile">${avatar(p.avatar, "lg ring")}<span><b>${e(p.name)}</b><small>${levelTitle()}</small></span>${icon("chevron", "tiny")}</button>
    <div class="menu-card">
      ${toggle("sounds", "sound", "Sons", s.sounds)}
      ${toggle("animations", "star", "Animations", s.animations)}
      ${toggle("emojis", "smile", "Emojis des joueurs pendant les parties", s.emojis !== false)}
      <label class="toggle-row">${icon("bell")}<span>Notifications</span><input type="checkbox" data-local="notifications" ${localStorage.getItem("notifications") !== "off" ? "checked" : ""}><i class="sw"></i></label>
      <div class="menu-link static">${icon("globe")}<span>Langue</span><em>Français</em></div>
    </div>
    <div class="menu-card">
      ${p.account?.hasPassword ? menuLink("lock", "Modifier mon mot de passe", "changePassword") : ""}
      ${menuLink("users", "Amis et confidentialité", "friends", 'data-tab="settings"')}
      ${menuLink("help", "Aide & contact", "help")}
      ${menuLink("doc", "Confidentialité", "go", 'data-page="legal"')}
    </div>
    ${p.account ? `${btn(`${icon("logout")} Se déconnecter`, "logout", "line-btn wide")}${btn(`${icon("trash")} Supprimer mon compte`, "deleteAccount", "danger-line wide")}` : btn("Créer un compte", "go", "gold-btn wide", 'data-page="register"')}
    <p class="foot-link"><a class="inline-link" href="/cards-LICENSE.txt">Crédits des cartes</a></p>`,
    { backBtn: false, tabs: true },
  );
}
function legalPage() {
  return shell(
    `<h1 class="page-title">Conditions et confidentialité</h1>
    <div class="text-card"><h3>Ce que nous conservons</h3><p>Votre pseudo, votre avatar ou photo, votre adresse e-mail si vous créez un compte, vos statistiques, votre historique de parties et de crédits. Aucune donnée n’est revendue.</p>
    <h3>Crédits de jeu</h3><p>Les crédits servent uniquement à jouer. Ils ne peuvent être ni retirés, ni transférés, ni convertis en argent. Les parties avec crédits sont réservées aux personnes majeures.</p>
    <h3>Vos droits</h3><p>Vous pouvez modifier votre profil et supprimer votre compte à tout moment depuis les réglages : toutes vos données sont alors effacées.</p>
    <h3>Bonne conduite</h3><p>Respect, pas de triche ni d’arrangement entre comptes. Les signalements sont examinés par la modération.</p></div>
    ${btn("Fermer", "back", "gold-btn wide")}`,
  );
}
function vipPage() {
  const p = state.player;
  return shell(
    `<div class="vip-hero"><img class="art vh-art" src="/decor/club-vip.webp" alt="" draggable="false">
      <p class="vh-title"><b>${e(p.name)}</b> vous accueille au Club VIP !</p></div>
    <div class="stack">${btn(`${icon("crown")} Créer une table privée`, "go", "gold-btn wide", 'data-page="vipCreate"')}${btn(`${icon("link")} Rejoindre avec un code`, "joinCode", "line-btn wide")}${btn(`${icon("trophy")} Tournois`, "go", "line-btn wide", 'data-page="tournaments"')}</div>
    <h2 class="section orn-title">Mes tables privées</h2>
    <div class="list">${p.myTables.filter((t) => t.vip).map((t) => `<div class="row-del"><button type="button" class="vip-row" data-action="enterTable" data-id="${t.id}">${avatar(p.avatar, "lg ring")}<span class="vr-main"><b>${e(t.name)}</b><span class="mini-avs">${t.avatars.map((a) => avatar(a)).join("")}${t.players < 4 ? '<i class="plus">+</i>' : ""}</span></span><span class="vr-count">${icon("users")} ${t.players}/4</span>${icon("chevron", "tiny")}</button>${btn(icon("trash"), "closeTableAsk", "round-btn small del-btn", `data-id="${t.id}" aria-label="Supprimer la table"`, t.playing)}</div>`).join("") || '<p class="empty">Créez votre première table privée et invitez vos amis.</p>'}</div>`,
    { vip: true, tabs: true, right: btn(icon("menu"), "go", "round-btn", 'data-page="settings" aria-label="Menu"') },
  );
}
function vipCreatePage() {
  const r = DEFAULT_RULES;
  return shell(
    `<h1 class="page-title">Créer une table VIP</h1><p class="lead">Personnalisez votre table selon vos envies.</p>
    <form id="create-form" class="form-card">
      <input type="hidden" name="vip" value="true">
      <label class="lbl">Nom de la table<input name="name" value="La table de ${e(state.player.name)}" maxlength="40" required></label>
      <label class="lbl">Mot de passe · <em>facultatif</em><input name="password" type="password" placeholder="Aucun mot de passe" maxlength="128" autocomplete="new-password"></label>
      <div class="lbl">Score de la partie<div class="seg radio">${[500, 1000, 1500].map((n) => `<label><input type="radio" name="target" value="${n}" ${n === 1500 ? "checked" : ""}><span>${fmt(n)}</span></label>`).join("")}</div></div>
      <label class="toggle-row">${icon("bolt")}<span>Contrée à la volée</span><input type="checkbox" name="flyingCounter" checked><i class="sw"></i></label>
      <label class="toggle-row">${icon("robot")}<span>Compléter avec des robots</span><input type="checkbox" name="fillBots" checked><i class="sw"></i></label>
      <label class="toggle-row">${icon("clock")}<span>Temps de réflexion par tour</span><select name="turnSeconds">${[15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === r.turnSeconds ? "selected" : ""}>${n} s</option>`).join("")}</select></label>
      <div class="lbl">Mise par joueur<div class="seg radio">${[0, ...STAKES].map((n) => `<label><input type="radio" name="stake" value="${n}" ${n ? "" : "checked"}><span>${n ? fmt(n) : "Gratuit"}</span></label>`).join("")}</div><small class="hint">Avec crédits : quatre joueurs humains, rubicon jusqu’à 2 × la mise.</small></div>
      <input type="hidden" name="counterWindowSeconds" value="${r.counterWindowSeconds}"><input type="hidden" name="reconnectSeconds" value="${r.reconnectSeconds}"><input type="hidden" name="capotValue" value="${r.capotValue}"><input type="hidden" name="scoring" value="${r.scoring}"><input type="hidden" name="allPass" value="${r.allPass}">${r.beloteRetained ? '<input type="hidden" name="beloteRetained" value="on">' : ""}<input type="hidden" name="beloteCountsContract" value="on">
      <button class="gold-btn wide">${icon("crown")} Créer ma table</button>
    </form>
    ${btn(`${icon("back")} Retour`, "back", "line-btn wide")}`,
    { vip: true },
  );
}
// ———————————————————————————————————————————————————————————— tournois (style Night VIP)
const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const dt = (ts, opts = {}) => new Date(ts).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...opts });
const hm = (ts) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const STAGES = { soon: "Bientôt", open: "Inscriptions ouvertes", closed: "Inscriptions closes", ready: "Équipes formées", running: "En cours", finished: "Terminé", cancelled: "Annulé" };
function tourChip(t) {
  return `<span class="tour-chip ${t.stage}">${STAGES[t.stage] ?? t.stage}</span>`;
}
function rewardsText(t) {
  const lines = [];
  const names = (ids) => ids.map((x) => REWARD_NAMES[x] ?? x).join(", ");
  if (t.prizes?.winner) lines.push(`💰 Enjeu vainqueurs : ${t.prizes.winner} crédits par joueur`);
  if (t.prizes?.finalist) lines.push(`💰 Enjeu finalistes : ${t.prizes.finalist} crédits par joueur`);
  if (t.rewards.winner.length) lines.push(`🏆 Vainqueurs : ${names(t.rewards.winner)}`);
  if (t.rewards.finalist.length) lines.push(`🥈 Finalistes : ${names(t.rewards.finalist)}`);
  if (t.rewards.participant.length) lines.push(`🎟️ Participants : ${names(t.rewards.participant)}`);
  return lines;
}
const REWARD_NAMES = {
  "tournoi-vainqueur": "badge Champion de tournoi",
  "tournoi-finaliste": "badge Finaliste",
  "tournoi-participant": "badge Tournoyeur",
  "frame-champion": "cadre d’avatar Couronne de champion",
  "back-velours": "dos de cartes Velours VIP",
  "felt-velours": "tapis Velours violet",
};
const minLine = (t) => (t.minBalance ? `Solde minimum requis : ${fmt(t.minBalance)} jetons. ` : "") + "Inscription gratuite, aucun jeton prélevé.";
function tournamentsPage() {
  const list = state.tournaments ?? [];
  const unread = (state.player.inbox ?? []).filter((n) => !n.read).length;
  const card = (t) => `<button type="button" class="tour-card" data-action="go" data-page="tournament" data-id="${t.id}">
      <span class="tc-trophy">🏆</span>
      <span class="tc-main"><b>${e(t.name)}</b><small>${dt(t.start)} · ${t.teams} équipes</small>
      <span class="tc-meta">${tourChip(t)}${t.me ? `<span class="tour-chip mine">${t.me.waitlist ? "Liste d’attente" : "Inscrit"}</span>` : ""}<span>${icon("users")} ${Math.max(0, t.places.capacity - t.places.used)} place${t.places.capacity - t.places.used > 1 ? "s" : ""}</span></span></span>
      ${icon("chevron", "tiny")}</button>`;
  const live = list.filter((t) => ["running"].includes(t.stage));
  const next = list.filter((t) => ["soon", "open", "closed", "ready"].includes(t.stage));
  const past = list.filter((t) => ["finished", "cancelled"].includes(t.stage));
  return shell(
    `<h1 class="page-title">Tournois</h1><p class="lead">Élimination directe, sur inscription. Horaires affichés dans votre fuseau (${e(myTz())}).</p>
    ${live.length ? `<h2 class="section orn-title">En cours</h2><div class="list">${live.map(card).join("")}</div>` : ""}
    <h2 class="section orn-title">À venir</h2><div class="list">${next.map(card).join("") || '<p class="empty">Aucun tournoi programmé pour le moment.</p>'}</div>
    ${past.length ? `<h2 class="section orn-title">Récents</h2><div class="list">${past.map(card).join("")}</div>` : ""}`,
    { vip: true, tabs: true, sub: "Tournois", right: btn(`${icon("bell")}${unread ? `<i class="badge-n">${unread}</i>` : ""}`, "inbox", "round-btn", 'aria-label="Notifications"') },
  );
}
function tournamentPage() {
  const t = (state.tournaments ?? []).find((x) => x.id === page.params.id);
  if (!t) return shell('<p class="empty">Ce tournoi n’est plus disponible.</p>', { vip: true });
  const acc = state.player.account;
  const free = Math.max(0, t.places.capacity - t.places.used);
  const info = (ic, label, value) => `<div class="ti-row">${icon(ic)}<span>${label}</span><b>${value}</b></div>`;
  let actions = "";
  if (t.stage === "open" && !t.me)
    actions = acc
      ? `${btn(`${icon("user")} M’inscrire seul`, "tourRegister", "gold-btn wide")}${btn(`${icon("users")} M’inscrire avec un ami`, "tourPartnerPick", "line-btn wide")}<p class="hint mid">Seul ? Une équipe vous sera proposée avec un autre joueur inscrit seul.</p>`
      : btn("Créer un compte pour s’inscrire", "go", "gold-btn wide", 'data-page="register"');
  if (t.stage === "soon" && !t.me) actions = `<div class="notice-box">${icon("clock")} <span>Les inscriptions ouvrent le <b>${e(dt(t.regOpen))}</b>.</span></div>`;
  if (["closed", "ready"].includes(t.stage) && !t.me) actions = `<div class="notice-box">${icon("clock")} <span>Les inscriptions sont closes.</span></div>`;
  if (t.me?.invitedBy)
    actions = `<div class="notice-box">${icon("users")} <span><b>${e(t.me.invitedBy)}</b> vous propose de faire équipe.</span></div><div class="row2">${btn("Accepter", "tourPartnerYes", "gold-btn")}${btn("Refuser", "tourPartnerNo", "line-btn")}</div>`;
  else if (t.me && ["soon", "open", "closed"].includes(t.stage)) {
    const canConfirm = Date.now() >= t.confirmOpen && Date.now() < t.confirmBy;
    actions = `<div class="status-box ${t.me.waitlist ? "wait" : "ok"}">${icon(t.me.waitlist ? "clock" : "check")}<div><b>${t.me.waitlist ? "Liste d’attente" : "Vous êtes inscrit"}</b><small>${t.me.partner ? `En équipe avec ${e(t.me.partner)}` : "Inscription seul : équipe formée avant le départ"}</small></div></div>
      ${t.me.confirmed ? `<div class="status-box ok">${icon("check")}<div><b>Présence confirmée</b><small>Restez disponible pour le départ à ${hm(t.start)}.</small></div></div>` : canConfirm ? `${btn(`${icon("check")} Confirmer ma présence`, "tourConfirm", "gold-btn wide")}<p class="hint mid">Avant ${hm(t.confirmBy)} · reste <b data-countdown="${t.confirmBy}"></b></p>` : `<p class="hint mid">Confirmation de présence de ${hm(t.confirmOpen)} à ${hm(t.confirmBy)}.</p>`}
      ${btn("Me désinscrire", "tourUnregister", "line-btn wide small")}`;
  }
  const lobby =
    ["closed", "ready"].includes(t.stage) || (t.me && Date.now() >= t.confirmOpen && t.stage === "open")
      ? `<h2 class="section orn-title">Salon d’attente</h2>
        <div class="lobby-card"><div><b>${t.ready}</b><small>équipes prêtes</small></div><div><b>${t.confirmedCount}</b><small>présences confirmées</small></div><div><b>${free}</b><small>places restantes</small></div><div><b data-countdown="${t.start}"></b><small>avant le départ</small></div></div>`
      : "";
  const mine = t.next
    ? `<div class="next-match ${t.next.status}">${icon("cards")}<div><small>${e(t.next.round)}</small><b>${t.next.against ? `Contre ${e(t.next.against.name)}` : "Adversaire à venir"}</b><span>${t.next.status === "playing" ? "Votre table est prête !" : "En attente des résultats du tour"}</span></div>${t.next.status === "playing" && state.table?.id === t.next.tableId ? btn("Rejoindre", "go", "gold-btn small", 'data-page="home"') : ""}</div>`
    : "";
  return shell(
    `<div class="tour-hero"><span class="th-cup">🏆</span><h1 class="page-title">${e(t.name)}</h1>${tourChip(t)}</div>
    ${t.description ? `<p class="lead">${e(t.description)}</p>` : ""}
    ${t.stage === "cancelled" ? `<div class="status-box ko">${icon("shield")}<div><b>Tournoi annulé</b><small>${e(t.cancelReason ?? "")}</small></div></div>` : ""}
    ${t.champion ? `<div class="champion">${t.champion.avatars.map((a) => avatar(a, "lg ring")).join("")}<div><small>Vainqueurs</small><b>${e(t.champion.name)}</b></div></div>` : ""}
    <div class="tour-info">
      ${info("clock", "Départ", `${dt(t.start, { weekday: "long" })}`)}
      ${info("users", "Format", `${t.teams} équipes · élimination directe`)}
      ${["running", "finished"].includes(t.stage) ? info("star", "Équipes", `${t.rounds?.[0]?.matches.reduce((n, m) => n + (m.a ? 1 : 0) + (m.b ? 1 : 0), 0) ?? 0} engagées`) : info("star", "Places", `${free} disponible${free > 1 ? "s" : ""} sur ${t.places.capacity}${t.places.waitlist ? ` · ${t.places.waitlist} en attente` : ""}`)}
      ${info("link", "Inscriptions", `${dt(t.regOpen)} → ${dt(t.regClose)}`)}
      ${info("check", "Présence", `de ${hm(t.confirmOpen)} à ${hm(t.confirmBy)}`)}
    </div>
    <div class="access-box">${icon("coin")}<span>${minLine(t)}</span></div>
    ${mine}
    <div class="stack">${actions}</div>
    ${lobby}
    ${t.rounds ? bracketView(t) : ""}
    <h2 class="section orn-title">Règles des tables</h2>
    <ul class="rule-list">
      <li>Objectif : ${fmt(t.rules.target)} points · temps par tour ${t.rules.turnSeconds} s · contrée ${t.rules.flyingCounter ? "à la volée" : "à son tour"}</li>
      <li>Mêmes règles sur toutes les tables du tournoi ; équipes fixes après le départ, les gagnants passent au tour suivant.</li>
      <li>Coupure de connexion : reprise possible pendant ${Math.round(t.rules.reconnectSeconds / 60) || 1} min ; au-delà de ${Math.round(t.rules.forfeitSeconds / 60)} min d’absence ou en cas d’abandon, l’équipe perd par forfait.</li>
      <li>Temps de jeu dépassé : passe aux enchères, carte autorisée la plus forte au jeu. Aucun robot ne participe.</li>
      <li>Équipes insuffisantes (moins de ${t.minTeams}) : ${t.insufficient === "cancel" ? "tournoi annulé" : `report de ${t.postponeMinutes} min`}, inscrits prévenus.</li>
      <li>Aucune mise : les rencontres ne débitent aucun jeton.</li>
    </ul>
    <h2 class="section orn-title">Récompenses</h2>
    <ul class="rule-list">${rewardsText(t).map((l) => `<li>${e(l)}</li>`).join("") || "<li>Le plaisir du jeu !</li>"}</ul>
    <p class="hint mid">Heure de référence : ${new Date(t.start).toLocaleString("fr-FR", { timeZone: t.timeZone, hour: "2-digit", minute: "2-digit", timeZoneName: "short" })} (${e(t.timeZone)})</p>`,
    { vip: true, sub: "Tournoi", cls: "page-tour" },
  );
}
// Tableau des rencontres, un tour à la fois (onglets) : lisible sur téléphone.
function bracketView(t) {
  const current = Math.max(0, t.rounds.findIndex((r) => r.matches.some((m) => ["waiting", "playing"].includes(m.status))));
  const sel = Math.min(page.params.round ?? (t.stage === "finished" ? t.rounds.length - 1 : current), t.rounds.length - 1);
  const side = (x, m) => (x ? `<div class="side ${m.winner === x.id ? "win" : m.winner ? "lose" : ""} ${x.mine ? "mine" : ""}"><span class="mini-avs">${x.avatars.map((a) => avatar(a)).join("")}</span><b>${e(x.name)}</b></div>` : `<div class="side empty"><b>${m.status === "bye" ? "Exempté" : "—"}</b></div>`);
  const status = (m) => ({ waiting: "À venir", playing: "En jeu", done: m.score ? `${m.score[0]} – ${m.score[1]}` : "Terminé", forfeit: "Forfait", bye: "Qualifié d’office", empty: "" })[m.status];
  return `<h2 class="section orn-title">Tableau des rencontres</h2>
    <div class="seg tabs round-tabs">${t.rounds.map((r, i) => btn(e(r.name), "bracketRound", i === sel ? "on" : "", `data-round="${i}"`)).join("")}</div>
    <div class="bracket">${t.rounds[sel].matches
      .filter((m) => m.status !== "empty")
      .map((m) => `<div class="match-card ${m.status}">${side(m.a, m)}<span class="vs">${e(status(m) ?? "")}</span>${side(m.b, m)}${m.forfeit ? `<small class="ff">${e(m.forfeit)}</small>` : ""}</div>`)
      .join("")}</div>`;
}
function inboxModal() {
  const list = state.player.inbox ?? [];
  modal(
    `<div class="modal-head"><span class="modal-icon">🔔</span><h2>Notifications</h2></div>
    <ul class="inbox">${list.map((n) => `<li class="${n.read ? "" : "unread"}"><b>${e(n.title)}</b><small>${e(n.body ?? "")}</small><span>${when(n.at)}</span>${n.tournament ? btn("Voir", "go", "chip-btn", `data-page="tournament" data-id="${n.tournament}"`) : ""}</li>`).join("") || '<li class="empty">Aucune notification.</li>'}</ul>
    ${pushState() === "ask" ? btn(`${icon("bell")} Activer les notifications sur cet appareil`, "enablePush", "gold-btn wide") : `<p class="hint mid">${pushState() === "on" ? "Notifications activées sur cet appareil." : pushState() === "denied" ? "Notifications refusées dans le navigateur : les rappels restent visibles ici." : "Les rappels s’affichent ici et dans l’application."}</p>`}`,
    "sheet-modal",
  );
  cmd("readInbox");
}
function fundsTourModal(m) {
  modal(
    `<div class="confirm"><span class="confirm-icon">🪙</span><h2>Solde insuffisant</h2>
    <p>Solde minimum requis : <b>${fmt(m.required)}</b> jetons. Inscription gratuite, aucun jeton prélevé.</p>
    <div class="duo small"><div><small>Votre solde</small><b>${fmt(m.balance)}</b></div><div><small>Il manque</small><b>${fmt(m.missing)}</b></div></div>
    <div class="row">${btn("Boutique", "shop", "gold-btn")}${btn("Fermer", "close", "line-btn")}</div></div>`,
    "confirm-modal",
  );
}
function partnerModal() {
  const friends = state.player.friends ?? [];
  modal(
    `<h2>Avec quel ami ?</h2><p class="lead">Votre ami recevra une proposition à accepter.</p>
    <ul class="friends">${friends.map((f) => `<li class="friend">${avatar(f.avatar)}<div><b>${e(f.name)}</b><small>${e(f.tag ?? "")}</small></div>${btn("Choisir", "tourRegisterWith", "gold-btn small", `data-id="${f.id}"`)}</li>`).join("") || '<li class="empty">Ajoutez d’abord des amis (Profil › Amis).</li>'}</ul>`,
    "sheet-modal",
  );
}

// ———————————————— notifications push (navigateur, iPhone/iPad en application installée, Android)
let pushInfo = null;
function pushState() {
  const native = window.Capacitor?.Plugins?.PushNotifications;
  if (native) return localStorage.getItem("pushNative") === "on" ? "on" : "ask";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && state?.player.push?.web) return "on";
  return "ask";
}
// Demandée au moment de l'inscription : si elle est refusée, les rappels restent dans l'application.
async function ensurePush() {
  try {
    const native = window.Capacitor?.Plugins?.PushNotifications;
    if (native) {
      const perm = await native.requestPermissions();
      if (perm.receive !== "granted") return;
      native.addListener("registration", async (t) => {
        await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "fcm", token: t.value, platform: window.Capacitor.getPlatform?.() }) });
        localStorage.setItem("pushNative", "on");
      });
      native.addListener("pushNotificationActionPerformed", (a) => a.notification?.data?.url && (location.href = a.notification.data.url));
      await native.register();
      return;
    }
    if (pushState() !== "ask") return;
    pushInfo ??= await (await fetch("/api/push/config")).json();
    if (!pushInfo.vapidPublicKey) return; // push non configuré sur le serveur : boîte de notifications seulement
    if ((await Notification.requestPermission()) !== "granted") return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(pushInfo.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "web", subscription: sub.toJSON() }) });
    toast("Notifications activées");
  } catch (err) {
    console.warn("Notifications indisponibles :", err);
  }
}

function pageView() {
  const guest = !state.player.account;
  // Visiteur non connecté : à chaque arrivée, choix « Se connecter » / « Créer un compte » / « Découvrir ».
  // Un joueur déjà connecté est reconnu (session d'un an) et arrive directement à l'accueil.
  if (!page.name) page = { name: guest && !sessionStorage.getItem("discover") ? "welcome" : "home", params: {} };
  const views = { welcome: welcomePage, register: registerPage, login: loginPage, forgot: forgotPage, reset: resetPage, verify: verifyPage, home: homePage, tables: tablesPage, profile: profilePage, avatar: avatarPage, history: historyPage, rules: () => rulesPage(), settings: settingsPage, legal: legalPage, vip: vipPage, vipCreate: vipCreatePage, tournaments: tournamentsPage, tournament: tournamentPage, boutique: boutiquePage };
  return (views[page.name] ?? homePage)();
}

// ———————————————————————————————————————————————————————————— salon d'attente (maquette « Salon privé »)
const seenSlots = new Set();
function roomView() {
  const t = state.table,
    me = t.seats.findIndex((s) => s?.id === state.player.id),
    owner = t.owner === state.player.id;
  const vip = t.vip && !t.practice;
  const free = t.seats.filter((s) => !s).length;
  const players = t.seats.filter(Boolean).length;
  const slot = (s, i) => {
    if (!s && t.fillBots && !t.stake && !t.quick)
      // Option « Compléter avec des robots » : le robot est déjà montré à sa place ; un ami qui arrive la prend.
      return `<div class="slot bot-wait"><div class="slot-ring">${avatar(["robot-bleu", "robot-corail", "robot-menthe", "robot-soleil"][i])}</div><b>Robot</b><span class="robot-tag">ROBOT</span><small class="hint">si personne ne vient</small></div>`;
    if (!s)
      return `<div class="slot empty"><button type="button" class="slot-ring" data-action="${owner && !t.stake && !t.quick ? "bot" : "friends"}" data-seat="${i}" aria-label="Place libre">+</button><b>Place libre</b>${me >= 0 && !t.quick && !t.lobby ? btn("S’asseoir", "seat", "mini-btn", `data-seat="${i}"`) : ""}</div>`;
    const pv = t.engagedPreview?.[i];
    // Nouveau venu (joueur ou robot) : il apparaît à sa place avec une petite animation.
    const arrive = !seenSlots.has(s.id);
    seenSlots.add(s.id);
    return `<div class="slot ${i % 2 === (me < 0 ? 0 : me) % 2 ? "us" : "them"} ${arrive ? "arrive" : ""}">
      <div class="slot-ring">${t.owner === s.id ? '<span class="crown-top">♛</span>' : ""}${avatar(s.avatar)}</div>
      <b>${e(s.name)}</b>${s.bot ? '<span class="robot-tag">ROBOT</span>' : ""}
      ${t.stake && pv ? `<span class="engaged ${pv.enough && pv.account ? "" : "short"}">${pv.account ? (pv.enough ? `${coins(pv.engaged)}` : "Solde insuffisant") : "Compte requis"}</span>` : ""}
      ${owner && i !== me && !t.quick && !t.lobby ? btn("Retirer", "kick", "mini-btn ghost", `data-seat="${i}"`) : ""}
    </div>`;
  };
  const top = t.quick
    ? `<h1 class="page-title">${free ? "On cherche des joueurs" : "C’est parti !"}</h1><p class="lead">${t.humans} joueur${t.humans > 1 ? "s" : ""} présent${t.humans > 1 ? "s" : ""}${free ? ` · ${free} place${free > 1 ? "s" : ""} en recherche` : ""}</p>${free ? `<div class="fill-timer">${icon("robot")} ${t.seats.some((x) => x?.bot) ? "Les robots s’installent…" : `Robots dans <b data-deadline="${t.fillAt ?? 0}"></b>`}</div>` : ""}`
    : t.lobby
      ? `<h1 class="page-title">${e(t.name)}</h1><p class="lead">${free ? `On attend ${free} joueur${free > 1 ? "s" : ""} · la partie démarre toute seule à quatre` : "C’est parti !"}</p>${free && t.fillAt ? `<div class="fill-timer">${icon("robot")} ${t.seats.some((x) => x?.bot) ? "Les robots s’installent…" : `Robots dans <b data-deadline="${t.fillAt}"></b>`}</div>` : ""}`
      : `<h1 class="page-title">${e(t.name)}</h1><p class="lead">${vip ? "Invitez vos amis pour commencer la partie." : `${fmt(t.rules.target)} points · contre ${t.rules.flyingCounter ? "à la volée" : "à son tour"}`}</p>`;
  const code =
    vip && t.code && owner
      ? `<div class="code-card"><small>Code d’invitation</small><div class="code"><b>${e(t.code)}</b>${btn(icon("copy"), "copyCode", "round-btn small", 'aria-label="Copier le code"')}</div>
        <div class="row2">${btn(`${icon("link")} Copier le lien`, "copyInvite", "line-btn")}${btn(`${icon("share")} Partager`, "shareInvite", "line-btn")}</div></div>`
      : "";
  const stake = t.stake
    ? `<div class="stake-card">${coins(t.stake, "big")}<div><b>Mise par joueur</b><small>Engagé au lancement : votre solde, au plus ${fmt(2 * t.stake)} (rubicon).</small></div></div>`
    : `<p class="free-line">${icon("check")} Partie gratuite</p>`;
  const pending = owner
    ? t.pending.map((p) => `<div class="request">${icon("user")}<span><b>${e(p.name)}</b> demande une place</span>${btn("Accepter", "admit", "gold-btn small", `data-player="${p.id}"`)}${btn("Refuser", "reject", "mini-btn ghost", `data-player="${p.id}"`)}</div>`).join("")
    : "";
  const actions = t.quick || t.lobby
    ? btn(`${icon("logout")} Quitter la table`, "leave", "line-btn wide")
    : `${owner && free && !t.stake && !t.fillBots ? btn(`${icon("robot")} Ajouter un robot`, "bot", "gold-btn wide", `data-seat="${t.seats.indexOf(null)}"`) : ""}
      ${owner ? btn(`${icon("users")} Vous choisissez les équipes.`, "teams", "text-link") : ""}
      ${me >= 0 ? btn(`${icon("users")} Inviter un ami`, "friends", "line-btn wide") : ""}
      ${owner ? btn(`<span class="play">▶</span> ${free && t.fillBots && !t.stake ? "Lancer avec les robots" : "Lancer la partie"}`, "start", "gold-btn wide", "", !!free && !(t.fillBots && !t.stake)) : '<p class="lead">L’hôte lancera la partie.</p>'}`;
  return shell(
    `${top}${code}${pending}
    <h2 class="section">Joueurs (${players}/4)</h2>
    <div class="slots">${t.seats.map(slot).join("")}</div>
    ${!t.quick && t.fillBots && !t.stake && t.fillAt && free ? `<div class="fill-timer">${icon("robot")} Robots dans <b data-deadline="${t.fillAt}"></b> si personne ne rejoint</div>` : ""}
    ${onlineBlock(t, me, free)}
    ${stake}
    <div class="stack">${actions}</div>
    ${tipLine("room:" + t.id)}
    <p class="foot-link">${btn(`${icon("doc")} Règles de la table`, "rulesInfo", "inline-link")}${owner && !t.quick && !t.lobby ? ` · ${btn("Modifier", "editRules", "inline-link")}` : ""}</p>`,
    { vip, cls: "page-room", right: btn(icon("menu"), "roomMenu", "round-btn", 'aria-label="Menu"'), sub: vip ? "VIP" : "" },
  );
}

// ———————————————————————————————————————————————————————————— table de jeu (maquettes « Club Pop » / « Night VIP »)
function contractInfo(g, t, me) {
  if (!g.contract) return null;
  const s = t.seats[g.contract.seat];
  const ours = g.contract.seat % 2 === me % 2;
  return { name: s?.name ?? "?", avatar: s?.avatar, ours, team: ours ? "Votre équipe" : "Équipe adverse", short: ours ? "Nous" : "Eux", amount: amountLabel(g.contract.amount), suit: g.contract.suit, mult: g.multiplier };
}
const multLabel = (m) => (m === 4 ? "Surcontré" : m === 2 ? "Contré" : "");
function tableLabel(t) {
  const kind = t.tournament ? e(t.tournament.name) : t.practice ? "Entraînement" : t.vip ? "Table VIP" : "Table classique";
  return t.stake ? `${kind} • ${fmt(t.stake)} jetons` : kind;
}
// Bandeau du haut (maquette « Votre annonce ») : logo, solde, table, menu, puis le score Nous / Eux.
function topBar(g, t, me) {
  const c = contractInfo(g, t, me);
  return `<header class="game-top">
    <div class="gt-logo">${logo()}</div>
    <div class="gt-chips"><span class="gt-chip wallet">${coins(state.player.wallet.available / 2)}</span><span class="gt-chip table" title="${tableLabel(t)}"><i class="poker-chip" aria-hidden="true"></i><span>${t.stake ? `${fmt(t.stake)} jetons` : tableLabel(t)}</span></span></div>
    ${btn(icon("menu"), "menu", "square-btn", 'aria-label="Menu de la partie"')}
  </header>
  <div class="scoreboard split" aria-label="Scores">${half("us", "Nous", g, me % 2)}<i></i>${half("them", "Eux", g, 1 - (me % 2))}</div>
`;
}
// Score coupé en deux : total de la partie en haut, points de la donne en cours en bas (pli après pli).
function half(cls, label, g, team) {
  const live = ["playing", "summary"].includes(g.phase) && g.points;
  const deal = live ? fmt((g.points[team] ?? 0) + (g.belote?.[team] ?? 0)) : "—";
  return `<div class="${cls}"><div class="sb-top"><small>${label}</small><b>${fmt(g.scores[team])}</b></div><div class="sb-deal"><small>Cette donne</small><em>${deal}</em></div></div>`;
}
// Enchères de la donne : dernière parole de chaque autre joueur, puis meilleure enchère.
function auctionStrip(g, t, me) {
  const chips = [1, 2, 3]
    .map((r) => (me + r) % 4)
    .map((i) => {
      const a = (g.auction ?? []).filter((x) => x.seat === i).at(-1);
      const text = !a ? "…" : a.type === "bid" ? `${amountLabel(a.amount)} ${suitHtml(a.suit)}` : a.type === "pass" ? "Passe" : a.type === "counter" ? "Contre !" : "Surcontre !";
      return `<span class="a-chip ${a?.type ?? "wait"}"><small>${e(t.seats[i]?.name ?? "")} :</small><b>${text}</b></span>`;
    })
    .join("");
  const last = (g.auction ?? []).filter((a) => a.type === "bid").at(-1);
  void chips;
  return `<div class="last-bid-pill">${last ? `Dernière enchère : <b>${e(t.seats[last.seat]?.name)} • ${amountLabel(last.amount)} ${suitHtml(last.suit)}</b>` : "Aucune enchère pour l’instant"}</div>`;
}
function reactionBubble(t, s) {
  if (!s || state.player.hidden.includes(s.id)) return "";
  const r = (t.reactions ?? []).filter((x) => x.pid === s.id && Date.now() - x.at < 3500).at(-1);
  if (r?.reaction.startsWith("emo-")) {
    const it = shopItem(r.reaction);
    return it && state.player.settings.emojis !== false ? `<span class="reaction-pop emo"><img src="${it.img}" alt="${e(it.name)}"></span>` : "";
  }
  const def = r && REACTIONS.find((x) => x.id === r.reaction);
  return def ? `<span class="reaction-pop"><b>${def.emoji}</b>${def.text ? `<small>${e(def.text)}</small>` : ""}</span>` : "";
}
function seatBubble(g, i) {
  // Annonce de chaque joueur affichée à côté de son avatar (enchères et délai de surcontre).
  if (!["bidding", "counter"].includes(g.phase)) return "";
  const a = (g.auction ?? []).filter((x) => x.seat === i).at(-1);
  if (!a) return "";
  const text = a.type === "bid" ? `${amountLabel(a.amount)} ${suitHtml(a.suit)}` : a.type === "pass" ? "Passe" : a.type === "counter" ? "Contre !" : "Surcontre !";
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
  const human = s && !s.bot && s.id !== state.player.id;
  const status = active
    ? `<span class="seat-timer" data-deadline="${t.deadline ?? 0}"></span>`
    : offline
      ? `<span class="seat-off">${Date.now() - (s.disconnectedAt ?? 0) < t.rules.reconnectSeconds * 1000 ? "Reconnexion…" : "Robot en relais"}</span>`
      : s?.replaced
        ? `<span class="seat-off">remplace ${e(s.replaced)}</span>`
        : "";
  return `<div class="seat p${rel} ${team} ${active ? "active" : ""} ${offline ? "offline" : ""} ${s?.frame ?? ""}">
    ${g.contract?.seat === i ? '<span class="crown-top" title="Preneur">♛</span>' : ""}
    <div class="seat-avatar ${human ? "tappable" : ""}" ${human ? `data-action="player" data-id="${s.id}" role="button" aria-label="Profil de ${e(s.name)}"` : ""}>${avatar(s?.avatar)}${g.dealer === i ? '<span class="dealer" title="Donneur">D</span>' : ""}</div>
    <div class="name-pill"><b>${e(s?.name ?? "—")}</b></div>${takerBadge(g, i)}${s?.bot ? '<span class="robot-tag">ROBOT</span>' : ""}${status}
    ${rel !== 0 ? `<div class="backs bk${Math.min(8, g.handCounts[i])}">${Array.from({ length: Math.min(8, g.handCounts[i]) }, () => "<i></i>").join("")}</div>` : ""}
    ${seatBubble(g, i)}${chatBubble(t, s)}${reactionBubble(t, s)}
  </div>`;
}
// Rappel compact du contrat, sous le nom du preneur.
function takerBadge(g, i) {
  if (!g.contract || g.contract.seat !== i || !["counter", "playing", "summary"].includes(g.phase)) return "";
  return `<span class="taker-badge">${amountLabel(g.contract.amount)} ${suitHtml(g.contract.suit)}${g.multiplier > 1 ? ` <em>${multLabel(g.multiplier)}</em>` : ""}</span>`;
}
// Chaque carte n'est animée qu'à son arrivée : les rafraîchissements suivants ne la refont pas apparaître.
let shownCards = new Set(),
  shownDeal = null;
function trickCards(cards, me, cls = "") {
  const deal = state.table?.gameId + ":" + state.table?.game?.deal;
  if (deal !== shownDeal) (shownDeal = deal), (shownCards = new Set());
  return `<div class="trick ${cls}">${cards.map((p) => {
    const seen = shownCards.has(p.card);
    shownCards.add(p.card);
    return `<div class="tcard p${(p.seat - me + 4) % 4} ${seen && !cls ? "seen" : ""}"><img src="${cardImage(p.card)}" alt="${cardName(p.card)}"></div>`;
  }).join("")}</div>`;
}
function contractBanner(c, g) {
  return `<div class="contract-banner ${c.ours ? "us" : "them"}" role="status">
    ${avatar(c.avatar, "lg")}
    <div class="cb-text"><span class="cb-who"><b>${e(c.name)}</b> a pris</span><span class="cb-bid">${c.amount} ${suitHtml(c.suit)}</span><span class="cb-team">${c.team}${c.mult > 1 ? ` · <b>${multLabel(c.mult)}</b>` : ""}</span>
    ${g.phase === "counter" ? `<span class="cb-counter">Surcontre possible · <b data-deadline="${g.counterDeadline ?? 0}"></b></span>` : ""}</div>
    ${c.mult > 1 ? `<span class="stamp">${multLabel(c.mult).toUpperCase()} !</span>` : ""}
  </div>`;
}
function centerView(g, t, me) {
  // Un nouveau pli a commencé (ou l'on vient de jouer) : le pli précédent s'efface aussitôt.
  // Seule notre propre carte interrompt l'affichage du pli précédent ; les cartes des autres
  // apparaissent juste après, avec leur animation.
  if (collection && sentCard && Date.now() < sentCard.until && !collection.cards.some((x) => x.card === sentCard.card)) collection = null;
  if (collection) return collection.stage === "hold" ? trickCards(collection.cards, me) : trickCards(collection.cards, me, `collecting to${(collection.winner - me + 4) % 4}`);
  const c = contractInfo(g, t, me);
  if (g.phase === "counter") return contractBanner(c, g);
  if (g.phase === "playing") {
    // Annonce du preneur affichée brièvement, puis le centre accueille les cartes jouées.
    const key = `${t.gameId}:${g.deal}`;
    if (bannerKey !== key) {
      bannerKey = key;
      bannerUntil = Date.now() + 2600;
      setTimeout(render, 2700);
    }
    if (!g.tricks.length && !g.trick.length && Date.now() < bannerUntil) return contractBanner(c, g);
    // Carte que l'on vient de jouer : posée au centre tout de suite, sans attendre le serveur.
    const pending = sentCard && g.version === sentCard.version && Date.now() < sentCard.until && !g.trick.some((x) => x.card === sentCard.card) ? [{ seat: me, card: sentCard.card }] : [];
    return trickCards([...g.trick, ...pending], me);
  }
  if (["summary", "finished"].includes(g.phase)) return "";
  if (g.turn === me) return "";
  // Contre à la volée : proposé aux adversaires du preneur, même hors de leur tour (règle de la table).
  const flying = g.contract && g.contract.seat % 2 !== me % 2 && g.rules.flyingCounter;
  return `<div class="bid-zone watching">${auctionStrip(g, t, me)}${flying ? btn("Contrer à la volée", "counter", "red-btn counter-fly") : ""}</div>`;
}
// Maquette « Résultat de la donne ».
function dealResult(g, t, me) {
  const h = g.history.at(-1);
  if (!h) return "";
  const ours = h.contract.seat % 2 === me % 2;
  const taker = t.seats[h.contract.seat];
  const belote = h.belote[me % 2] ? `<div class="res-line">${icon("cards", "big")}<div><b>Belote : +${h.belote[me % 2]} points</b><small>Pour votre équipe</small></div></div>` : h.belote[1 - (me % 2)] ? `<div class="res-line">${icon("cards", "big")}<div><b>Belote : +${h.belote[1 - (me % 2)]} points</b><small>Pour l’équipe adverse</small></div></div>` : "";
  return `<div class="overlay-page"><div class="op-inner">
    <h2 class="op-title">Résultat de la donne</h2>
    <div class="taker-pill">${avatar(taker?.avatar, "lg")}<span>${e(taker?.name)} • ${ours ? "Nous" : "Eux"} • ${amountLabel(h.contract.amount)} ${suitHtml(h.contract.suit)}${h.multiplier > 1 ? ` • ${multLabel(h.multiplier)}` : ""}</span></div>
    <div class="res-box ${h.made ? "ok" : "ko"}">${h.made ? icon("check", "res-ico") : '<span class="res-ico x">✕</span>'}<div><b>${h.made ? "Contrat réussi" : "Contrat chuté"}</b><small>${h.made ? `${ours ? "Bravo" : "Ils ont"} atteint ${amountLabel(h.contract.amount)} !` : `${ours ? "Dommage" : "Bien défendu"} : ${amountLabel(h.contract.amount)} non atteint.`}</small></div></div>
    <div class="duo"><div class="${h.score[me % 2] >= h.score[1 - (me % 2)] ? "lead" : ""}">${h.score[me % 2] >= h.score[1 - (me % 2)] ? icon("crown") : ""}<small>Nous</small><b>${h.score[me % 2]}</b></div><div class="${h.score[1 - (me % 2)] > h.score[me % 2] ? "lead" : ""}"><small>Eux</small><b>${h.score[1 - (me % 2)]}</b></div></div>
    ${belote}
    ${h.capot && h.contract.amount !== 250 ? `<div class="res-line">${icon("trophy", "big")}<div><b>Capot ! ${amountLabel(h.contract.amount)} + 250 points</b><small>Tous les plis, sans l’avoir annoncé</small></div></div>` : ""}
    <p class="op-sub">Score total de la partie</p>
    <div class="total-pill"><div><small>Nous</small><b>${g.scores[me % 2]}</b></div><i></i><div class="them"><small>Eux</small><b>${g.scores[1 - (me % 2)]}</b></div></div>
    <p class="next-auto">Donne suivante dans <b data-deadline="${t.nextAt ?? 0}"></b></p>
    ${tipLine(`deal:${t.gameId}:${h.deal}`)}
  </div></div>`;
}
// Maquette « Victoire ! » + règlement des crédits + revanche.
function finalResult(g, t, me) {
  const won = g.scores[me % 2] > g.scores[1 - (me % 2)];
  const r = t.result;
  const votes = t.rematch?.votes ?? {};
  const mine = votes[state.player.id];
  const blocked = t.rematch?.blocked ?? [];
  return `<div class="overlay-page final ${won ? "win" : "lose"}"><div class="op-inner">
    ${won ? '<div class="confetti" aria-hidden="true">' + "<i></i>".repeat(14) + "</div>" : ""}
    ${won ? '<img class="art final-art-img" src="/decor/victoire.webp" alt="" draggable="false">' : `<div class="final-art">${avatar(t.seats[me]?.avatar, "xl")}${avatar(t.seats[(me + 2) % 4]?.avatar, "xl")}</div>`}
    <div class="ribbon">${won ? "Victoire !" : "Défaite…"}</div>
    <div class="final-scores"><div><small>Votre équipe</small><b>${won ? icon("crown") : ""}${fmt(g.scores[me % 2])}</b></div><i></i><div class="them"><small>Équipe adverse</small><b>${fmt(g.scores[1 - (me % 2)])}</b></div></div>
    ${r ? moneyLines(r) + `<div class="xp-line">✨ +${r.xp} XP${r.badges?.length ? ` · ${r.badges.map((b) => `${b.icon} ${e(b.name)}`).join(", ")}` : ""}${r.challenges?.length ? ` · 🎯 ${r.challenges.map(e).join(", ")}` : ""}</div>` : ""}
    ${
      t.tournament
        ? `<p class="op-note">${won ? "Qualifiés ! Votre prochaine table s’ouvrira dès la fin du tour : vous serez prévenus." : "Fin du parcours dans ce tournoi. Merci d’avoir joué !"}</p>
      ${btn(`${icon("trophy")} Voir le tableau du tournoi`, "backToTour", "gold-btn wide")}`
        : `<div class="votes">${t.seats.map((s) => `<span class="vote ${s && votes[s.id] ? "ok" : ""}" title="${e(s?.name ?? "")}">${avatar(s?.avatar)}<i>${s && votes[s.id] ? "✓" : "…"}</i></span>`).join("")}</div>
    ${t.stake ? `<p class="op-note">${e(stakeRisk(t.stake))}</p>` : ""}
    ${blocked.length ? `<p class="warn">Solde insuffisant pour ${blocked.map(e).join(", ")}. ${btn("Boutique", "shop", "inline-link")} · ${btn("Tables moins chères", "cheaper", "inline-link")}</p>` : ""}
    ${mine ? '<p class="waiting-vote">En attente des autres joueurs…</p>' : btn(`${icon("refresh")} Rejouer avec cette table`, "rematchYes", "gold-btn wide")}
    ${btn(`${icon("home")} Retour au salon${t.vip ? " VIP" : ""}`, "rematchNo", "line-btn wide")}
    ${btn(`${icon("logout")} Quitter la table`, "leave", "line-btn wide small")}`
    }
  </div></div>`;
}
function moneyLines(r) {
  if (!r || !r.stake) return "";
  const kind = r.rubicon ? "Rubicon" : "Victoire simple";
  if (r.delta > 0)
    return `<div class="money win"><b>Bénéfice : ${signed(r.delta)} crédits</b><small>${fmt(r.stake + r.delta)} récupérés, dont ${fmt(r.stake)} de mise — bénéfice ${signed(r.delta)} · ${kind}</small>${r.adjusted ? '<small class="adjusted">Gain ajusté aux crédits engagés par les adversaires.</small>' : ""}<span>Nouveau solde ${coins(r.balance)}</span></div>`;
  return `<div class="money lose"><b>Perte : ${signed(r.delta)} crédits</b><small>${kind} · ${fmt(r.engaged)} étaient engagés</small><span>Nouveau solde ${coins(r.balance)}</span></div>`;
}
// Maquette « Choisir votre contrat ».
// Maquette « Votre annonce ».
function bidPanel(g, me, t) {
  const options = BIDS.filter((n) => !g.contract || n > g.contract.amount);
  // À chaque nouveau tour d'enchère : montant par défaut = le plus bas permis (80, ou juste au-dessus
  // de la dernière enchère d'un joueur).
  const key = `${t.gameId}:${g.deal}:${(g.auction ?? []).length}`;
  if (bidKey !== key || !options.includes(bidAmount)) {
    bidKey = key;
    bidAmount = options[0] ?? null;
  }
  const canCounter = g.contract && g.contract.seat % 2 !== me % 2;
  return `<div class="bid-zone">${auctionStrip(g, t, me)}
  <form id="bid-form" class="bid-panel" aria-label="Votre annonce">
    <b class="bp-title"><i>⟡</i>Votre annonce<i>⟡</i></b>
    <input type="hidden" name="amount" value="${bidAmount ?? ""}"><input type="hidden" name="suit" value="${bidSuit ?? ""}">
    <div class="bid-suits">${HAND_ORDER.map((s) => `<button type="button" class="suit-btn ${isRed(s) ? "red" : ""} ${s === bidSuit ? "on" : ""}" data-action="pickSuit" data-suit="${s}" aria-label="Atout ${SUIT_NAMES[s]}" aria-pressed="${s === bidSuit}">${SUITS[s]}</button>`).join("")}</div>
    <div class="bid-amounts">${options.map((n) => `<button type="button" class="amount ${n === bidAmount ? "on" : ""}" data-action="pickAmount" data-amount="${n}">${amountLabel(n)}</button>`).join("")}</div>
    <span class="bp-sep" aria-hidden="true">◆</span>
    <div class="bid-actions">${btn("Passer", "pass", "teal-btn")}<button class="gold-btn announce" name="go" value="1" ${options.length && bidSuit ? "" : "disabled"}><span>Annoncer</span><b>${bidAmount ? amountLabel(bidAmount) : ""} ${bidSuit ? suitHtml(bidSuit) : ""}</b></button>${btn(g.rules.flyingCounter ? "Contrer<br>à la volée" : "Contrer", "counter", "red-btn", "", !canCounter)}</div>
  </form></div>`;
}
// Le bouton « Annoncer 90 ♠ » suit le choix sans redessiner toute la table.
function announceLabel(form) {
  const b = form.querySelector(".announce b");
  if (b) b.innerHTML = `${bidAmount ? amountLabel(bidAmount) : ""} ${bidSuit ? suitHtml(bidSuit) : ""}`;
}
function floatingAction(g, me) {
  const flying = g.phase === "bidding" && g.contract && g.contract.seat % 2 !== me % 2 && g.turn !== me && g.rules.flyingCounter;
  if (flying) return ""; // bouton intégré à la zone des enchères
  if (g.phase === "counter" && g.contract.seat % 2 === me % 2) return `<div class="float-action center-act">${btn(`Surcontrer ! <small data-deadline="${g.counterDeadline ?? 0}"></small>`, "surcounter", "danger-btn big")}</div>`;
  return "";
}
function handView(g, me, t) {
  const pending = sentCard && g.version === sentCard.version && Date.now() < sentCard.until ? sentCard.card : null;
  const hand = g.hand.filter((c) => c !== pending).sort((a, b) => HAND_ORDER.indexOf(a.slice(-1)) - HAND_ORDER.indexOf(b.slice(-1)) || RANKS.indexOf(a.slice(0, -1)) - RANKS.indexOf(b.slice(0, -1)));
  if (selected && !hand.includes(selected)) selected = null;
  const myTurn = g.phase === "playing" && g.turn === me && !collection;
  const glow = g.phase === "bidding" && g.turn === me;
  const status = myTurn
    ? `<span class="turn-pill on">À vous de jouer <b class="my-timer" data-deadline="${t.deadline ?? 0}"></b></span>`
    : glow
      ? `<span class="turn-pill">À vous d’annoncer <b class="my-timer" data-deadline="${t.deadline ?? 0}"></b></span>`
      : g.phase === "bidding"
        ? `<span class="turn-pill">À ${e(t.seats[g.turn]?.name)} d’annoncer</span>`
        : g.phase === "playing"
          ? `<span class="turn-pill">Au tour de ${e(t.seats[g.turn]?.name)}</span>`
        : "";
  const mine = t.money?.seats.find((x) => x.seat === me);
  return `<div class="hand n${hand.length} ${dealing ? "dealing" : ""} ${glow ? "glow" : ""} ${myTurn ? "my-turn" : ""}" aria-label="Votre main">
    ${hand.map((c, i) => `<button type="button" class="hcard c${i} ${c === selected ? "selected" : ""}" data-action="pick" data-card="${c}" aria-label="${cardName(c)}" aria-pressed="${c === selected}"><img src="${cardImage(c)}" alt="" draggable="false"></button>`).join("")}
  </div>
  <div class="status-row">
    <span class="me-mini"><span class="me-seat">${avatar(state.player.avatar)}<b>${e(state.player.name)}</b>${takerBadge(g, me)}</span>${t.money ? `<small>${fmt(mine?.engaged ?? 0)} engagés</small>` : ""}</span>
    ${status}
    <span class="status-btns">${btn("😊", "react", "round-btn", 'aria-label="Réactions"')}${btn(`${icon("chat")}${t.chat.length > seenChat && sheet !== "chat" ? '<i class="dot"></i>' : ""}`, "chat", "round-btn gold-round", 'aria-label="Discussion"')}</span>
  </div>`;
}
function gameView() {
  const t = state.table,
    g = t.game,
    me = Math.max(0, t.seats.findIndex((s) => s?.id === state.player.id));
  const myBid = g.phase === "bidding" && g.turn === me;
  const eq = state.player.progress.equipped;
  const vip = t.vip && !t.practice;
  return `<div class="screen game phase-${g.phase} ${vip ? "theme-vip" : "theme-club"} ${myBid ? "bidding-me" : ""} ${eq.back} ${eq.felt?.startsWith("tapis-") ? `${eq.felt} tapis` : vip ? "" : eq.felt}">
    <div class="ambient" aria-hidden="true"><i class="lamp l1"></i><i class="lamp l2"></i><i class="leaf f1"></i><i class="leaf f2"></i></div>
    ${topBar(g, t, me)}
    <main class="arena">
      <div class="felt"></div>
      ${[1, 2, 3].map((r) => seatView(g, t, me, (me + r) % 4)).join("")}
      <div class="center">${centerView(g, t, me)}</div>
      ${g.tricks.length && g.phase === "playing" ? btn(`${icon("cards")} Dernier pli`, "lastTrick", "last-trick-btn") : ""}
      ${myBid ? bidPanel(g, me, t) : floatingAction(g, me)}
      ${seatBubble(g, me) || reactionBubble(t, t.seats[me]) ? `<div class="my-bubble">${seatBubble(g, me)}${reactionBubble(t, t.seats[me])}</div>` : ""}
    </main>
    <footer class="dock">${handView(g, me, t)}</footer>
    ${collection ? "" : g.phase === "summary" ? dealResult(g, t, me) : g.phase === "finished" ? finalResult(g, t, me) : ""}
    ${sheetView(g, t, me)}
  </div>`;
}

// ———————————————————————————————————————————————————————————— rendu
// Un rafraîchissement pendant un appui ferait perdre la touche : on le diffère au relâchement.
let bidKey = null;
let bannerKey = null,
  bannerUntil = 0;
let pressing = false,
  pendingRender = false;
document.addEventListener("pointerdown", () => (pressing = true), true);
// Jeu d'une carte dès l'appui du doigt (sans attendre le relâchement) : la carte part aussitôt
// vers le centre, le serveur confirme ensuite et le pli s'affiche.
let playedOnDown = null,
  lastDownPlay = 0,
  sentCard = null; // carte envoyée, masquée de la main jusqu'à la réponse du serveur (pas de retour visuel)
const markSent = (card, version) => {
  sentCard = { card, version, until: Date.now() + 2500 };
  setTimeout(() => sentCard?.card === card && Date.now() >= sentCard.until && (sentCard = null, render()), 2600);
};
document.addEventListener("pointerdown", (ev) => {
  const el = ev.target.closest?.(".hand .hcard");
  const t = state?.table,
    g = t?.game;
  if (!el || !g || ev.button > 0) return;
  const me = t.seats.findIndex((s) => s?.id === state.player.id);
  const c = el.dataset.card;
  if (g.phase !== "playing" || g.turn !== me || collection || !g.legal.includes(c) || playedOnDown) return;
  playedOnDown = c;
  lastDownPlay = Date.now();
  el.classList.add("flying");
  const r = el.getBoundingClientRect();
  lastPlayRect = { left: r.left, top: r.top, width: r.width, height: r.height, at: performance.now() };
  markSent(c, g.version);
  cmd("action", { version: g.version, action: { type: "play", card: c } });
  // Affichage immédiat : la carte quitte la main (sans laisser de trou) et arrive au centre.
  pressing = false;
  render();
  setTimeout(() => playedOnDown === c && (playedOnDown = null), 1500);
});
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
let lastShape = "",
  lastShapeNode = null;
function render() {
  if (!state) return;
  if (pressing) {
    pendingRender = true;
    return;
  }
  const t = state.table,
    g = t?.game;
  const vipTheme = (t?.vip && !t.practice) || (!t && ["vip", "vipCreate", "tournaments", "tournament"].includes(page.name));
  document.body.className = `${g ? "in-game" : t ? "in-room" : "in-lobby"} ${vipTheme ? "night-vip" : "club-pop"} ${state.player.settings.animations ? "" : "calm"}`;
  sound = state.player.settings.sounds;
  const dealKey = g ? t.gameId + ":" + g.deal : null;
  const trickKey = dealKey + ":" + (g?.tricks.length ?? 0);
  if (dealKey !== lastRenderedDeal) {
    collection = null;
    clearTimeout(collectionTimer);
    selected = null;
  } else if (trickKey !== lastTrickKey && g?.tricks.length) {
    // Ramassage animé du pli vers son gagnant.
    // Le pli complet (4e carte comprise) reste visible un instant, puis il est ramassé vers son gagnant.
    collection = { ...g.tricks.at(-1), startedAt: performance.now(), stage: "hold" };
    clearTimeout(collectionTimer);
    collectionTimer = setTimeout(() => {
      if (!collection) return;
      collection.stage = "collect";
      render();
      collectionTimer = setTimeout(() => {
        collection = null;
        render();
      }, 700);
    }, 1200);
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
  const key = (el) => el.closest("form").id + ":" + el.name + (el.type === "radio" ? ":" + el.value : "");
  const box = (el) => el.type === "checkbox" || el.type === "radio";
  document.querySelectorAll("#app form[id] input:not([type=hidden])").forEach((el) => (fields[key(el)] = box(el) ? el.checked : el.value));
  // On ne reconstruit l'écran que s'il a changé (le texte des chronos mis à part) :
  // sinon chaque message du serveur relançait les animations et faisait clignoter l'écran.
  const html = g ? gameView() : t ? roomView() : pageView();
  const shape = html.replace(/(data-(?:deadline|countdown)="[^"]*">)[^<]*/g, "$1");
  const app = $("#app");
  if (shape !== lastShape || !app.firstElementChild || app.firstElementChild !== lastShapeNode) {
    app.innerHTML = html;
    lastShape = shape;
    lastShapeNode = app.firstElementChild;
  }
  if (g) animateTrick();
  if (state.player.avatar) localStorage.setItem("lastAvatar", state.player.avatar);
  document.querySelectorAll("#app form[id] input:not([type=hidden])").forEach((el) => {
    const v = fields[key(el)];
    if (v !== undefined) box(el) ? (el.checked = v) : (el.value = v);
  });
  if (focusForm && focusName) document.querySelector(`#app #${focusForm} [name="${focusName}"]`)?.focus();
  const log = $(".chat-log");
  if (log) log.scrollTop = log.scrollHeight;
  if (collection) $(".collecting")?.getAnimations({ subtree: true }).forEach((a) => (a.currentTime = performance.now() - collection.startedAt));
  clock();
  fitBidZone();
}
// Sur les écrans bas (portable, petit téléphone), la zone d'annonce est réduite juste assez
// pour ne jamais passer sous la main ni sous l'indication du tour : aucun défilement.
function fitBidZone() {
  const z = $(".bid-zone:not(.watching)"),
    limit = $(".status-row");
  if (!z || !limit) return;
  z.style.removeProperty("scale");
  const handTop = ($(".hand")?.getBoundingClientRect().top ?? Infinity) - 8;
  const room = Math.min(limit.getBoundingClientRect().top, handTop) - 4 - z.getBoundingClientRect().top;
  const need = z.scrollHeight;
  if (need > room && room > 0) z.style.setProperty("scale", String(Math.max(0.6, room / need)));
}
addEventListener("resize", fitBidZone);
// Retour dans l'application : le serveur revérifie l'éligibilité au bonus (au plus une fois par minute).
let lastCheckin = 0;
function checkin() {
  if (!state?.player.account || ws?.readyState !== 1 || Date.now() - lastCheckin < 60_000) return;
  lastCheckin = Date.now();
  cmd("checkin");
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkin());
addEventListener("focus", checkin);
addEventListener("pageshow", checkin);
const hms = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")} min ${String(t % 60).padStart(2, "0")} s`;
};
function clock() {
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    const left = Number(el.dataset.countdown) - Date.now();
    el.textContent = left > 0 ? hms(left) : "maintenant";
    // Échéance atteinte en restant connecté : on redemande le bonus, une seule fois.
    if (left <= 0) checkin();
  });
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

// Petite pluie de pièces : « Bonus de connexion : +200 crédits ! » et nouveau solde.
function showBonus(m) {
  document.querySelector(".bonus-pop")?.remove();
  const el = document.createElement("div");
  el.className = "bonus-pop";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="bp-coins" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="k${i}"></i>`).join("")}</div>
    <div class="bp-card"><span class="big-coin"></span><b>Bonus de connexion : +${fmt(m.amount)} crédits !</b><small>Nouveau solde : ${fmt(m.balance)} crédits</small></div>`;
  document.body.append(el);
  tone([523, 659, 784, 1046], 0.09, 0.05);
  el.addEventListener("click", () => el.remove());
  setTimeout(() => el.remove(), 3600);
}

// ———————————————————————————————————————————————————————————— comptes et profil
async function loadAuthConfig() {
  try {
    authConfig = await (await fetch("/api/auth/config")).json();
  } catch {}
}
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
      ${acc ? `<p class="daily-done">🎁 Bonus de connexion : +${fmt(w.loginBonus?.amount ?? 200)} crédits toutes les 24 h · prochain dans <b data-countdown="${w.loginBonus?.next ?? 0}"></b></p>` : `<div class="account-box guest"><b>Créez un compte</b><p class="muted small">Recevez vos crédits de bienvenue et le bonus quotidien, sur le site et dans l’application.</p>${btn("Créer un compte", "auth", "pill small", 'data-mode="register"')}</div>`}
      <div class="row">${btn("🪙 Boutique", "shop", "pill small")}${btn("📜 Historique", "history", "chip-btn")}${btn("🤖 Entraînement gratuit", "practice", "chip-btn")}</div>
      <p class="muted small wallet-note">Les crédits servent uniquement à jouer : ils ne peuvent être ni retirés, ni transférés, ni convertis en argent.</p>
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
    </div></div>`,
    "confirm-modal",
  );
}
function needFunds(stake) {
  if (!stake) return false;
  if (!state.player.account) {
    go("register");
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
// Commande avec suite : le rappel ne s'exécute qu'en cas de succès (les erreurs s'affichent seules).
function ask(type, data, then) {
  if (ws?.readyState !== 1) return toast("Connexion en cours…");
  const id = crypto.randomUUID();
  pendingAcks[id] = then;
  ws.send(JSON.stringify({ id, type, data }));
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
      <fieldset class="stakes"><legend>Mise par joueur</legend><div class="seg radio">${[0, ...STAKES].map((n) => `<label><input type="radio" name="stake" value="${n}" ${n === (editing ? state.table.stake : 0) ? "checked" : ""}><span>${n ? `🪙 ${fmt(n)}` : "Gratuit"}</span></label>`).join("")}</div><small class="muted">Avec crédits : quatre joueurs, rubicon jusqu’à 2 × la mise.</small></fieldset>
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
    `<h2>Rejoindre avec un code</h2><p class="lead">Saisissez le code donné par l’hôte, par exemple VIP-482.</p>
    <form id="invite-form" class="stack">
      ${prefill.tableId ? `<input type="hidden" name="tableId" value="${e(prefill.tableId)}"><input type="hidden" name="invite" value="${e(prefill.invite)}">` : field("link", "code", "text", "Code d’invitation", `value="${e(prefill.code ?? "")}" required autocapitalize="characters"`)}
      ${field("lock", "password", "password", "Mot de passe (si demandé)", 'maxlength="128"')}
      <button class="gold-btn wide">Voir les règles</button></form>`,
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

      break;
    case "auth":
      go(el.dataset.mode === "register" ? "register" : "login");
      break;
    case "go":
      if (["home", "tables", "profile", "boutique", "settings"].includes(el.dataset.page) && !el.dataset.f) pageStack = [];
      go(el.dataset.page, { ...(el.dataset.tab ? { tab: el.dataset.tab } : {}), ...(el.dataset.id ? { id: el.dataset.id } : {}), ...(el.dataset.f ? { f: el.dataset.f } : {}) });
      break;
    case "tourNew":
      tourForm(null);
      break;
    case "tourEdit":
      tourForm(adminData.tournaments.find((x) => x.id === el.dataset.id));
      break;
    case "tourAdminBack":
      $("#admin-tours").innerHTML = tourAdmin(adminData);
      break;
    case "tourPublish":
      await adminRequest({ type: "tourPublish", id: el.dataset.id });
      break;
    case "tourDuplicate":
      await adminRequest({ type: "tourDuplicate", id: el.dataset.id });
      toast("Copie créée en brouillon");
      break;
    case "tourPostpone": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<form id="tour-postpone-form" class="form"><input type="hidden" name="tid" value="${t.id}"><p><b>${e(t.name)}</b> · départ actuel ${e(t.local.start.replace("T", " "))} (${e(t.timeZone)})</p><label>Nouveau départ (${e(t.timeZone)})<input type="datetime-local" name="start" value="${t.local.start}" required></label><p class="muted small">Toutes les dates sont décalées d’autant ; rappels reprogrammés et inscrits informés.</p><div class="row"><button class="pill small">Reporter</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div></form>`;
      break;
    }
    case "tourCancel": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<form id="tour-cancel-form" class="form"><input type="hidden" name="tid" value="${t.id}"><p>Annuler <b>${e(t.name)}</b> ? Les ${t.places.used} inscrits seront prévenus.</p><label>Motif<input name="reason" maxlength="200" value="Annulé par l’organisateur"></label><div class="row"><button class="pill small danger">Annuler le tournoi</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div></form>`;
      break;
    }
    case "tourDetails": {
      const t = adminData.tournaments.find((x) => x.id === el.dataset.id);
      $("#admin-tours").innerHTML = `<p><b>${e(t.name)}</b> · ${TOUR_LABELS[t.status]}</p><h4>Inscriptions</h4><ul class="admin-list">${t.regs.map((r) => `<li>${r.names.map(e).join(" & ")}${r.partnerName ? ` (+ ${e(r.partnerName)} invité)` : ""}${r.waitlist ? " · liste d’attente" : ""} · présence ${r.confirmed.length}/${r.names.length}</li>`).join("") || "<li>Aucune</li>"}</ul>
        <h4>Journal</h4><ul class="admin-list">${t.log.slice().reverse().map((l) => `<li>${when(l.at)} · ${e(l.kind)} · ${e(l.by)}</li>`).join("")}</ul>${btn("Retour", "tourAdminBack", "chip-btn ghost")}`;
      break;
    }
    case "createFromLogin":
      try {
        await api("/api/auth/register", loginDraft);
        closeModal();
        localStorage.setItem("welcomed", "1");
        toast("Compte créé, bienvenue !");
        go("avatar", { onboarding: true });
      } catch (err) {
        toast(err.message);
      }
      break;
    case "inviteOnline":
      ask("invite", { id: el.dataset.id }, () => toast("Invitation envoyée"));
      break;
    case "inbox":
      inboxModal();
      break;
    case "enablePush":
      await ensurePush();
      closeModal();
      render();
      break;
    case "bracketRound":
      page.params.round = Number(el.dataset.round);
      render();
      break;
    case "tourRegister":
    case "tourRegisterWith":
      ask("tourRegister", { id: page.params.id, ...(a === "tourRegisterWith" ? { partner: el.dataset.id } : {}) }, () => {
        closeModal();
        toast("Inscription enregistrée !");
        tone([523, 659, 784], 0.08, 0.05);
        ensurePush();
      });
      break;
    case "tourPartnerPick":
      partnerModal();
      break;
    case "tourPartnerYes":
    case "tourPartnerNo":
      ask("tourPartner", { id: page.params.id, accept: a === "tourPartnerYes" }, () => a === "tourPartnerYes" && ensurePush());
      break;
    case "tourUnregister":
      modal(`<div class="confirm"><span class="confirm-icon">🎟️</span><h2>Se désinscrire ?</h2><p>Votre place sera proposée à la liste d’attente.</p><div class="row">${btn("Rester inscrit", "close", "chip-btn ghost")}${btn("Me désinscrire", "tourUnregisterYes", "danger-btn")}</div></div>`, "confirm-modal");
      break;
    case "tourUnregisterYes":
      closeModal();
      ask("tourUnregister", { id: page.params.id }, () => toast("Désinscription enregistrée"));
      break;
    case "tourConfirm":
      ask("tourConfirm", { id: page.params.id }, () => toast("Présence confirmée, à tout à l’heure !"));
      break;
    case "backToTour": {
      const tid = state.table?.tournament?.id;
      cmd("leave");
      if (tid) go("tournament", { id: tid });
      break;
    }
    case "back":
      if (state.table) cmd("leave");
      else back();
      break;
    case "discover":
      sessionStorage.setItem("discover", "1");
      go("home");
      break;
    case "peek": {
      const input = el.parentElement.querySelector("input");
      input.type = input.type === "password" ? "text" : "password";
      break;
    }
    case "checkVerified": {
      const me = await (await fetch("/api/session", { method: "POST" })).json();
      if (me.account?.verified) {
        toast("Adresse confirmée, merci !");
        go("home");
      } else toast("Pas encore confirmé : ouvrez le lien reçu par e-mail.");
      break;
    }
    case "changeEmail":
      toast("Déconnectez-vous puis créez un compte avec la bonne adresse.");
      go("settings");
      break;
    case "editName":
      modal(`<h2>Modifier mon pseudo</h2><form id="profile-form" class="stack">${field("user", "name", "text", "Pseudo", `minlength="2" maxlength="24" required value="${e(state.player.name)}"`)}<button class="gold-btn wide">Enregistrer</button></form>`, "sheet-modal");
      break;
    case "avatarTab":
    case "historyTab":
      page = { ...page, params: { ...page.params, tab: el.dataset.tab } };
      render();
      break;
    case "pickAvatar":
      page = { ...page, params: { ...page.params, pick: el.dataset.avatar } };
      render();
      break;
    case "useAvatar":
      cmd("profile", { avatar: el.dataset.avatar });
      toast("Avatar enregistré");
      if (page.params.onboarding) go(needVerify() ? "verify" : "home");
      else back();
      break;
    case "afterAvatar":
      go(needVerify() ? "verify" : "home");
      break;
    case "createPublic":
      createModal();
      setTimeout(() => document.querySelector('#create-form input[name="vip"][value="false"]')?.click(), 0);
      break;
    case "enterTable":
      cmd("enter", { tableId: el.dataset.id });
      break;
    case "copyCode":
      try {
        await navigator.clipboard.writeText(t.code);
        toast(`Code ${t.code} copié !`);
      } catch {
        toast(t.code);
      }
      break;
    case "shareInvite": {
      const link = location.origin + "/#" + encodeURIComponent(JSON.stringify({ code: t.code }));
      try {
        if (navigator.share) await navigator.share({ title: t.name, text: `Rejoins ma table de contrée ! Code ${t.code}`, url: link });
        else {
          await navigator.clipboard.writeText(link);
          toast("Lien d’invitation copié !");
        }
      } catch {}
      break;
    }
    case "roomMenu":
      modal(`<h2>${e(t.name)}</h2><div class="menu-card">${menuLink("doc", "Règles de la table", "rulesInfo")}${t.owner === state.player.id && !t.quick ? menuLink("pen", "Modifier les règles", "editRules") : ""}${menuLink("users", "Inviter un ami", "friends")}${menuLink("logout", "Quitter la table", "leave")}${t.vip && t.host === state.player.id && t.seats.filter((s) => s && !s.bot).length <= 1 ? menuLink("trash", "Fermer définitivement la table", "closeTable", `data-id="${t.id}"`) : ""}</div>`, "sheet-modal");
      break;
    case "closeTableAsk": {
      const mt = state.player.myTables.find((x) => x.id === el.dataset.id);
      modal(`<div class="confirm"><span class="confirm-icon">🗑️</span><h2>Supprimer cette table ?</h2><p>« ${e(mt?.name ?? "")} » disparaîtra de vos tables.</p><div class="row">${btn("Annuler", "close", "chip-btn ghost")}${btn("Supprimer", "closeTable", "danger-btn", `data-id="${el.dataset.id}"`)}</div></div>`, "confirm-modal");
      break;
    }
    case "closeTable":
      closeModal();
      cmd("closeTable", { tableId: el.dataset.id });
      closeModal();
      break;
    case "teams":
      modal(`<h2>Choisir les équipes</h2><p class="lead">Places 1 et 3 contre 2 et 4. Déplacer un joueur vers une place occupée échange les deux places.</p>${t.seats.map((s, i) => `<label class="lbl">Place ${i + 1} · ${e(s?.name ?? "libre")}<select data-move="${i}">${[0, 1, 2, 3].map((j) => `<option value="${j}" ${j === i ? "selected" : ""}>Place ${j + 1} · équipe ${(j % 2) + 1}</option>`).join("")}</select></label>`).join("")}`, "sheet-modal");
      break;
    case "help":
      modal(`<h2>Aide & contact</h2><div class="text-card"><p><b>Une question sur les règles ?</b> Consultez « Règles de la table ».</p><p><b>Un problème avec un joueur ?</b> Touchez son avatar pendant la partie puis « Signaler ».</p><p><b>Un souci technique ?</b> Écrivez-nous ici : la modération reçoit votre message avec le contexte de votre table.</p></div>${btn("Signaler un problème", "report", "gold-btn wide")}`, "sheet-modal");
      break;
    case "changePassword":
      modal(`<h2>Modifier mon mot de passe</h2><form id="password-form" class="stack">${field("lock", "current", "password", "Mot de passe actuel", 'autocomplete="current-password" required')}${field("lock", "password", "password", "Nouveau mot de passe", 'minlength="8" autocomplete="new-password" required')}<button class="gold-btn wide">Enregistrer</button></form>`, "sheet-modal");
      break;
    case "pickSuit":
      bidSuit = el.dataset.suit;
      el.form.suit.value = bidSuit;
      el.form.querySelectorAll(".suit-btn").forEach((b) => b.classList.toggle("on", b === el));
      el.form.querySelector('button[name="go"]').disabled = false;
      announceLabel(el.form);
      break;
    case "oidc":
      oidc(el.dataset.provider);
      break;
    case "profile":
      go("profile");
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
      // Entrée directe, sans fenêtre de règles (consultables dans le salon).
      const target = state.tables.find((x) => x.id === el.dataset.table);
      if (needFunds(target.stake)) break;
      cmd("join", { tableId: target.id });
      break;
    }
    case "playLobby": {
      const stake = Number(el.dataset.stake);
      if (!state.player.account) {
        toast("Créez un compte pour jouer avec des jetons");
        go("register");
        break;
      }
      if (needFunds(stake)) break;
      ask("playLobby", { stake }, () => toast(`Table à ${fmt(stake)} : en attente de joueurs…`));
      break;
    }
    case "wallet":
      walletModal();
      break;
    case "shop":
      shopModal();
      break;
    case "shopFilter":
      page = { ...page, params: { f: el.dataset.f } };
      render();
      break;
    case "shopCat":
      page = { ...page, params: { f: "all", cat: el.dataset.cat } };
      render();
      break;
    case "shopItem":
      shopItemModal(el.dataset.id);
      break;
    case "shopBuyAsk":
      shopBuyAsk(el.dataset.id);
      break;
    case "shopBuy":
      shopBuy(el.dataset.id);
      break;
    case "feltDefault":
      cmd("equip", { id: "felt-emeraude" });
      toast("Tapis vert d’origine remis");
      closeModal();
      break;
    case "shopUse":
      shopUse(el.dataset.id);
      break;
    case "history":
      historyModal();
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
      announceLabel(el.form);
      break;
    case "pass":
    case "counter":
    case "surcounter":
      cmd("action", { version: g.version, action: { type: a } });
      break;
    case "pick": {
      // Une seule touche : la carte est jouée si c'est votre tour et qu'elle est autorisée.
      const c = el.dataset.card;
      // Une carte vient d'être jouée dès l'appui (pointerdown) : le clic qui suit, parfois sur la
      // carte voisine après le rafraîchissement, est ignoré pour ne jamais jouer deux fois.
      if (playedOnDown || Date.now() - lastDownPlay < 700) {
        playedOnDown = null;
        break;
      }
      const myTurn = g.phase === "playing" && g.turn === me && !collection;
      if (!myTurn) break;
      if (!g.legal.includes(c)) {
        toast("Cette carte n’est pas autorisée ici");
        break;
      }
      markSent(c, g.version);
      cmd("action", { version: g.version, action: { type: "play", card: c } });
      render();
      break;
    }
    case "quitGame":
      sheet = null;
      render();
      modal(`<div class="confirm"><span class="confirm-icon">🚪</span><h2>Quitter la partie ?</h2><p>${state.table?.tournament ? "Tournoi : quitter la rencontre fait perdre votre équipe par forfait." : "Un robot prendra votre place."}</p><div class="row">${btn("Rester", "close", "chip-btn ghost")}${btn("Quitter", "confirmLeave", "danger-btn")}</div></div>`, "confirm-modal");
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
      modal('<h2>Administration</h2><p class="muted">Accès réservé (clé BELOTE_ADMIN_KEY du serveur).</p><form id="admin-form" class="form"><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="pill small">Ouvrir</button></form><div id="admin-result"></div>', "sheet-modal admin-modal");
      break;
    case "adminTab":
      adminTab = el.dataset.tab;
      for (const b of document.querySelectorAll(".admin-tab")) b.classList.toggle("on", b.dataset.tab === adminTab);
      for (const p of document.querySelectorAll(".admin-panel")) p.hidden = p.dataset.panel !== adminTab;
      break;
    case "adminLogout":
      try {
        localStorage.removeItem("adminKey");
      } catch {}
      location.reload();
      break;
    case "clientOpen":
      await openClient(el.dataset.id);
      break;
    case "clientBack":
      adminClient = null;
      if ($("#admin-clients")) $("#admin-clients").innerHTML = clientList(adminData);
      break;
    case "clientSuspend":
      await adminRequest({ type: "suspend", id: el.dataset.id, enabled: el.dataset.enabled === "true" });
      break;
    case "clientDelete":
      if (confirm(`Supprimer définitivement « ${el.dataset.name} » ? Compte, crédits et historique seront effacés.`)) {
        adminClient = null;
        if (await adminRequest({ type: "playerDelete", id: el.dataset.id })) toast("Client supprimé");
      }
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
  if (/^photo-input/.test(ev.target.id) && ev.target.files[0]) openCropper(ev.target.files[0]);
  if (ev.target.dataset?.local) localStorage.setItem(ev.target.dataset.local, ev.target.checked ? "on" : "off");
  const k = ev.target.dataset?.setting;
  if (k) cmd("settings", { [k]: ev.target.type === "checkbox" ? ev.target.checked : ev.target.value });
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && sheet) {
    sheet = null;
    render();
  }
});
let loginDraft = null; // identifiants saisis à la connexion, réutilisés pour créer le compte
let adminToken = "",
  adminData = null;
// ———————————————— administration des tournois : calendrier et programmation
const TOUR_LABELS = { draft: "Brouillon", published: "Publié", running: "En cours", finished: "Terminé", cancelled: "Annulé" };
function tourAdmin(d) {
  const byDay = {};
  for (const t of d.tournaments) (byDay[new Date(t.start).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })] ??= []).push(t);
  return `<p class="muted small">Push navigateur ${d.push.web ? "✓ configuré" : "— clés VAPID manquantes"} · push iOS/Android ${d.push.native ? "✓ configuré" : "— Firebase non configuré"} · les rappels restent dans l’application dans tous les cas.</p>
    ${btn("＋ Nouveau tournoi", "tourNew", "pill small")}
    <div class="tour-cal">${Object.entries(byDay).map(([day, list]) => `<div class="cal-day"><b>${e(day)}</b>${list.map((t) => `<div class="admin-card"><b>${e(t.name)}</b><small>${new Date(t.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} (votre heure) · ${e(t.local.start.replace("T", " "))} ${e(t.timeZone)} · ${TOUR_LABELS[t.status]} · ${t.places.used}/${t.places.capacity} inscrits${t.places.waitlist ? ` · ${t.places.waitlist} en attente` : ""}</small>
      <div class="row">${["draft", "published"].includes(t.status) && !t.rounds ? btn("Modifier", "tourEdit", "chip-btn", `data-id="${t.id}"`) : ""}${t.status === "draft" ? btn("Publier", "tourPublish", "chip-btn", `data-id="${t.id}"`) : ""}${["draft", "published"].includes(t.status) ? btn("Reporter", "tourPostpone", "chip-btn", `data-id="${t.id}"`) + btn("Annuler", "tourCancel", "chip-btn danger", `data-id="${t.id}"`) : ""}${btn("Dupliquer", "tourDuplicate", "chip-btn", `data-id="${t.id}"`)}${btn("Détails", "tourDetails", "chip-btn", `data-id="${t.id}"`)}</div></div>`).join("")}</div>`).join("") || "<p>Aucun tournoi programmé.</p>"}</div>`;
}
function tourForm(t) {
  const d = adminData;
  const now = new Date(Date.now() + 86400_000);
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const n0 = new Date();
  const nowLocal = `${n0.getFullYear()}-${pad(n0.getMonth() + 1)}-${pad(n0.getDate())}T${pad(n0.getHours())}:${pad(n0.getMinutes())}`; // inscriptions ouvertes dès la publication
  const v = t
    ? { ...t, ...t.local }
    : { name: "", description: "", timeZone: myTz(), teams: 8, minTeams: 4, minBalance: 0, rules: { target: 1500, turnSeconds: 20, flyingCounter: true, reconnectSeconds: 120, forfeitSeconds: 300 }, insufficient: "postpone", postponeMinutes: 30, rewards: { winner: ["tournoi-vainqueur", "frame-champion"], finalist: ["tournoi-finaliste"], participant: ["tournoi-participant"] }, regOpen: nowLocal, regClose: `${day}T20:00`, confirmBy: `${day}T20:50`, start: `${day}T21:00` };
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([val, label]) => `<option value="${val}" ${String(val) === String(cur) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  const rw = (kind, label) => `<fieldset><legend>${label}</legend>${d.rewards.map((r) => `<label class="check-line"><input type="checkbox" name="rw-${kind}" value="${r.id}" ${v.rewards[kind].includes(r.id) ? "checked" : ""}>${e(r.name)}</label>`).join("")}</fieldset>`;
  $("#admin-tours").innerHTML = `<form id="tour-form" class="form">
    <input type="hidden" name="tid" value="${t?.id ?? ""}">
    <label>Nom<input name="name" value="${e(v.name)}" minlength="3" maxlength="60" required></label>
    <label>Description<input name="description" value="${e(v.description ?? "")}" maxlength="400"></label>
    <label>Fuseau de référence<input name="timeZone" value="${e(v.timeZone)}" list="tz-list" required></label>
    <datalist id="tz-list">${["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "America/Montreal", "Indian/Reunion", "America/Martinique", "Pacific/Noumea", "UTC"].map((z) => `<option value="${z}">`).join("")}</datalist>
    <div class="form-grid">
      <label>Ouverture des inscriptions<input type="datetime-local" name="regOpen" value="${v.regOpen}" required></label>
      <label>Fermeture des inscriptions<input type="datetime-local" name="regClose" value="${v.regClose}" required></label>
      <label>Fin de la confirmation de présence<input type="datetime-local" name="confirmBy" value="${v.confirmBy}" required></label>
      <label>Départ<input type="datetime-local" name="start" value="${v.start}" required></label>
      <label>Équipes${sel("teams", [[8, "8 équipes"], [16, "16 équipes"], [32, "32 équipes"]], v.teams)}</label>
      <label>Minimum pour lancer<input type="number" name="minTeams" min="2" max="32" value="${v.minTeams}"></label>
      <label>Seuil de jetons<input type="number" name="minBalance" min="0" step="1000" value="${v.minBalance}"></label>
      <label>Score cible${sel("target", [[500, "500"], [1000, "1 000"], [1500, "1 500"], [2000, "2 000"]], v.rules.target)}</label>
      <label>Temps par tour (s)<input type="number" name="turnSeconds" min="10" max="120" value="${v.rules.turnSeconds}"></label>
      <label>Reprise après coupure (s)<input type="number" name="reconnectSeconds" min="30" max="600" value="${v.rules.reconnectSeconds}"></label>
      <label>Forfait après absence (s)<input type="number" name="forfeitSeconds" min="30" max="1800" value="${v.rules.forfeitSeconds}"></label>
      <label>Équipes insuffisantes${sel("insufficient", [["postpone", "Reporter"], ["cancel", "Annuler"]], v.insufficient)}</label>
      <label>Rappel avant le départ (heures)<input type="number" name="reminderHours" min="0" max="48" value="${v.reminderHours ?? 3}"></label>
      <label>Report de (min)<input type="number" name="postponeMinutes" min="5" max="10080" value="${v.postponeMinutes}"></label>
    </div>
    <label class="check-line"><input type="checkbox" name="flyingCounter" ${v.rules.flyingCounter ? "checked" : ""}>Contrée à la volée</label>
    <fieldset><legend>Enjeux (crédits offerts à chaque joueur, sans droit d’entrée)</legend><div class="form-grid"><label>🏆 Vainqueurs<input type="number" name="prizeWinner" min="0" max="1000000" step="1" value="${v.prizes?.winner ?? 0}"></label><label>🥈 Finalistes<input type="number" name="prizeFinalist" min="0" max="1000000" step="1" value="${v.prizes?.finalist ?? 0}"></label></div></fieldset>
    ${rw("winner", "Récompenses des vainqueurs")}${rw("finalist", "Récompenses des finalistes")}${rw("participant", "Récompenses de participation")}
    <p class="muted small">Après le départ, seuls le nom et la description restent modifiables.</p>
    <div class="row"><button class="chip-btn" name="publish" value="">Enregistrer le brouillon</button><button class="pill small" name="publish" value="1">${t?.status === "published" ? "Enregistrer" : "Publier"}</button>${btn("Retour", "tourAdminBack", "chip-btn ghost")}</div>
  </form>`;
}
// ———————————————— back office : clients
let adminClient = null,
  adminTab = "dash";
function clientList(d) {
  const players = [...d.players].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  return `<input id="client-search" class="client-search" type="search" placeholder="Rechercher un pseudo ou un e-mail" autocomplete="off">
    <div class="client-list">${players.map((p) => `<div class="admin-row client-row" data-q="${e((p.name + " " + (p.account?.email ?? "") + " " + (p.tag ?? "")).toLowerCase())}"><span>${p.online ? "🟢" : "⚪"} <b>${e(p.name)}</b> <small>${e(p.account?.email ?? "invité")}${p.banned ? " · suspendu" : ""}</small></span><span class="row"><small>🪙 ${fmt(p.wallet.balance / 2)}</small>${btn("Fiche", "clientOpen", "chip-btn", `data-id="${p.id}"`)}</span></div>`).join("") || "<p>Aucun client.</p>"}</div>`;
}
async function openClient(id) {
  try {
    const res = await fetch("/api/admin?player=" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + adminToken } });
    if (!res.ok) throw Error(await res.text());
    const c = await res.json();
    adminClient = id;
    const box = $("#admin-clients");
    if (!box) return;
    const w = c.wallet;
    box.innerHTML = `<div class="client-sheet">
      <div class="row">${btn("← Liste des clients", "clientBack", "chip-btn ghost")}</div>
      <div class="client-head">${avatar(c.avatar)}<div><b>${e(c.name)}</b><small>${e(c.tag ?? "")} · ${c.online ? "en ligne" : "hors ligne"}${c.banned ? " · <b>suspendu</b>" : ""}</small><small>${c.account ? `${e(c.account.email)} · ${c.account.verified ? "e-mail vérifié" : "e-mail non vérifié"}${c.account.providers.length ? " · " + c.account.providers.map(e).join(", ") : ""}` : "Invité sans compte"}</small></div></div>
      <div class="admin-stats"><div><b>${fmt(w.balance / 2)}</b><small>solde</small></div><div><b>${fmt(w.reserved / 2)}</b><small>engagés</small></div><div><b>${c.stats.games}</b><small>parties</small></div><div><b>${c.stats.wins ?? 0}</b><small>victoires</small></div></div>
      <h4>Créditer / débiter</h4>
      <form id="client-credit-form" class="form inline"><input type="hidden" name="cid" value="${c.id}"><label>Montant (crédits, négatif pour retirer)<input name="amount" type="number" step="0.5" min="-1000000" max="1000000" required></label><label>Motif<input name="reason" maxlength="120" placeholder="Geste commercial, correction…"></label><button class="pill small">Valider</button></form>
      <h4>Fiche</h4>
      <form id="client-edit-form" class="form"><input type="hidden" name="cid" value="${c.id}">
        <div class="form-grid"><label>Pseudo<input name="name" value="${e(c.name)}" minlength="2" maxlength="24" required></label><label>Avatar<input name="avatar" value="${e(c.avatar)}" maxlength="8"></label>
        ${c.account ? `<label>E-mail<input name="email" type="email" value="${e(c.account.email)}" required></label><label class="check-line"><input type="checkbox" name="verified" ${c.account.verified ? "checked" : ""}>E-mail vérifié</label>` : ""}</div>
        <button class="pill small">Enregistrer la fiche</button></form>
      <div class="row">${btn(c.banned ? "Réactiver le compte" : "Suspendre le compte", "clientSuspend", "chip-btn", `data-id="${c.id}" data-enabled="${!c.banned}"`)}${btn("Supprimer le client", "clientDelete", "chip-btn danger", `data-id="${c.id}" data-name="${e(c.name)}"`)}</div>
      <h4>Journal des crédits</h4>
      <div class="client-ledger">${c.ledger.map((x) => `<div class="admin-row"><span>${when(x.at)} · ${e(x.label ?? x.type)}</span><span class="${x.amount < 0 ? "neg" : "pos"}">${x.amount > 0 ? "+" : ""}${fmt(x.amount)} → ${fmt(x.balance)}</span></div>`).join("") || "<p class='muted small'>Aucun mouvement.</p>"}</div>
      <h4>Dernières parties</h4>
      <div>${(c.history ?? []).slice(0, 15).map((h) => `<div class="admin-row"><span>${h.at ? when(h.at) : ""} ${e(h.table ?? h.name ?? "")}</span><span>${h.won ? "Gagnée" : "Perdue"}${h.score ? ` · ${e(String(h.score))}` : ""}</span></div>`).join("") || "<p class='muted small'>Aucune partie.</p>"}</div>
    </div>`;
  } catch (err) {
    adminClient = null;
    toast(err.message);
  }
}
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "client-search") return;
  const q = ev.target.value.trim().toLowerCase();
  for (const r of document.querySelectorAll(".client-row")) r.hidden = !!q && !r.dataset.q.includes(q);
});
async function adminRequest(data) {
  try {
    const res = await fetch("/api/admin", {
      method: data ? "POST" : "GET",
      headers: { Authorization: "Bearer " + adminToken, ...(data ? { "Content-Type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw Error(await res.text());
    const d = await res.json();
    adminData = d;
    const row = (l, r) => `<div class="admin-row"><span>${l}</span>${r}</div>`;
    const open = d.reports.filter((r) => !r.resolved);
    const alerts = d.alerts.filter((x) => !x.reviewed);
    const online = d.players.filter((p) => p.online).length;
    const upcoming = d.tournaments.filter((t) => ["draft", "published", "running"].includes(t.status));
    const tabs = [
      ["dash", "📊", "Tableau de bord"],
      ["clients", "👥", `Clients`, d.players.length],
      ["tours", "🏆", "Tournois", upcoming.length],
      ["moderation", "🚩", "Modération", open.length + alerts.length],
      ["boutique", "🛍️", "Boutique"],
      ["tables", "🃏", "Tables", d.tables.length],
      ["settings", "⚙️", "Réglages"],
    ];
    const panel = (id, html) => `<section class="admin-panel" data-panel="${id}" ${adminTab === id ? "" : "hidden"}>${html}</section>`;
    $("#admin-result").innerHTML = `
      ${d.storage?.ephemeral ? '<p class="warn">⚠️ Données temporaires : aucun volume n’est attaché au service Railway. Ajoutez un volume (Railway › service › Settings › Volumes, point de montage /data).</p>' : ""}
      <nav class="admin-tabs">${tabs.map(([id, ic, label, n]) => `<button type="button" class="admin-tab ${adminTab === id ? "on" : ""}" data-action="adminTab" data-tab="${id}"><span>${ic}</span>${label}${n ? `<i>${n}</i>` : ""}</button>`).join("")}</nav>
      <div class="admin-body">
      ${panel("dash", `<h2>Tableau de bord</h2>
        <div class="admin-stats"><div><b>${d.players.length}</b><small>clients</small></div><div><b>${online}</b><small>en ligne</small></div><div><b>${d.tables.length}</b><small>tables</small></div><div><b>${upcoming.length}</b><small>tournois à venir</small></div><div><b>${fmt(d.economy.circulating)}</b><small>crédits en circulation</small></div><div><b>${fmt(d.economy.reserved)}</b><small>crédits engagés</small></div><div><b>${open.length}</b><small>signalements</small></div><div><b>${alerts.length}</b><small>alertes</small></div></div>
        <p class="muted small">Achats ${d.economy.purchases ? "ouverts" : "fermés"} (web ${d.economy.stripe ? "✓" : "—"}, iOS ${d.economy.apple ? "✓" : "—"}, Android ${d.economy.google ? "✓" : "—"}) · Push navigateur ${d.push.web ? "✓" : "—"} · Push natif ${d.push.native ? "✓" : "—"} · Entrées ${d.settings.maintenance ? "suspendues" : "ouvertes"}</p>`)}
      ${panel("clients", `<h2>Clients</h2><div id="admin-clients">${clientList(d)}</div>`)}
      ${panel("tours", `<h2>Tournois</h2><div id="admin-tours">${tourAdmin(d)}</div>`)}
      ${panel("moderation", `<h2>Modération</h2><h3>Alertes à examiner</h3><p class="muted small">Indices combinés, jamais une preuve : aucune sanction automatique.</p>
      ${alerts.map((x) => `<div class="admin-card"><b>${e(x.kind)}</b><small>${when(x.at)} · ${x.names.map(e).join(", ")}</small><ul>${x.indicators.map((i) => `<li>${e(i)}</li>`).join("")}</ul>${btn("Marquer comme examinée", "reviewAlert", "chip-btn", `data-id="${x.id}"`)}</div>`).join("") || "<p>Aucune alerte.</p>"}
      <h3>Signalements</h3>
      ${open.map((r) => `<div class="admin-card"><b>${e(r.reason)}${r.targetName ? ` · ${e(r.targetName)}` : ""}</b><small>${when(r.at)} · par ${e(r.byName ?? r.by)}${r.gameId ? ` · partie ${e(r.gameId.slice(0, 8))}, donne ${r.deal ?? "—"}` : ""}</small>${r.comment ? `<p>${e(r.comment)}</p>` : ""}${r.context?.chat?.length ? `<p class="muted small">Messages : ${r.context.chat.map((m) => e(m.text)).join(" · ")}</p>` : ""}${r.context?.reactions?.length ? `<p class="muted small">${r.context.reactions.length} réaction(s) récente(s)</p>` : ""}${btn("Traiter", "resolveReport", "chip-btn", `data-id="${r.id}"`)}</div>`).join("") || "<p>Aucun signalement ouvert.</p>"}`)}
      ${panel("boutique", `<h2>Boutique</h2><p class="muted small">Nom, prix (jetons), ordre d’affichage et visibilité. Un article masqué reste acquis à ceux qui le possèdent.</p>
        <div class="shop-admin">${d.shop.map((it) => `<form class="form inline shop-item-form" data-id="${it.id}"><img src="${it.img}" alt=""><label>Nom<input name="name" value="${e(it.name)}" maxlength="40" required></label><label>Prix<input name="price" type="number" min="0" max="1000000" value="${it.price}" required></label><label>Ordre<input name="order" type="number" step="1" value="${it.order}"></label><label class="check-line"><input type="checkbox" name="hidden" ${it.hidden ? "checked" : ""}>Masqué</label><button class="pill small">Enregistrer</button></form>`).join("")}</div>`)}
      ${panel("tables", `<h2>Tables</h2>${d.tables.map((t) => row(`${e(t.name)} · ${e(t.status)}${t.stake ? ` · 🪙 ${t.stake}` : ""}`, t.engaged ? btn("Annuler (incident)", "cancelGame", "chip-btn danger", `data-id="${t.id}"`) : btn("Supprimer", "deleteTable", "chip-btn", `data-id="${t.id}"`, t.status === "Partie en cours"))).join("") || "<p>Aucune table.</p>"}`)}
      ${panel("settings", `<h2>Réglages</h2>
        <div class="admin-card"><b>Nouvelles entrées</b><small>Bloque l’arrivée de nouveaux joueurs aux tables (maintenance).</small>${btn(d.settings.maintenance ? "Rouvrir les entrées" : "Suspendre les nouvelles entrées", "maintenance", "chip-btn", `data-enabled="${!d.settings.maintenance}"`)}</div>
        <div class="admin-card"><form id="bonus-form" class="form inline"><label>Bonus de connexion (crédits / 24 h)<input name="amount" type="number" min="0" max="100000" step="1" value="${d.settings.loginBonus ?? d.economy.loginBonus}" required></label><button class="pill small">Enregistrer</button></form></div>`)}
      </div>`;
    if (adminClient) await openClient(adminClient);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}
document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  const d = Object.fromEntries(new FormData(f, ev.submitter));
  if (f.classList.contains("shop-item-form")) {
    if (await adminRequest({ type: "shopItem", id: f.dataset.id, name: d.name, price: Number(d.price), order: Number(d.order), hidden: d.hidden === "on" })) toast("Article enregistré");
    return;
  }
  try {
    switch (f.id) {
      case "bid-form":
        if (!d.suit) return toast("Choisissez d’abord une couleur d’atout");
        cmd("action", { version: state.table.game.version, action: { type: "bid", amount: Number(d.amount), suit: d.suit } });
        bidSuit = null;
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
        cmd(f.id === "create-form" ? "create" : "rules", { name: d.name, password: d.password || undefined, vip: d.vip === "true", rules: r, stake: Number(d.stake ?? 0), fillBots: d.fillBots === "on" });
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
      case "tour-form": {
        const f2 = new FormData(f);
        const data = {
          name: d.name,
          description: d.description,
          timeZone: d.timeZone,
          regOpen: d.regOpen,
          regClose: d.regClose,
          confirmBy: d.confirmBy,
          start: d.start,
          teams: Number(d.teams),
          minTeams: Number(d.minTeams),
          minBalance: Number(d.minBalance),
          rules: { target: Number(d.target), turnSeconds: Number(d.turnSeconds), flyingCounter: d.flyingCounter === "on" },
          reconnectSeconds: Number(d.reconnectSeconds),
          forfeitSeconds: Number(d.forfeitSeconds),
          insufficient: d.insufficient,
          postponeMinutes: Number(d.postponeMinutes),
          reminderHours: Number(d.reminderHours),
          prizes: { winner: Number(d.prizeWinner || 0), finalist: Number(d.prizeFinalist || 0) },
          rewards: { winner: f2.getAll("rw-winner"), finalist: f2.getAll("rw-finalist"), participant: f2.getAll("rw-participant") },
          publish: d.publish === "1",
        };
        // (champ « tid » : un champ nommé « id » masquerait l'identifiant du formulaire)
        if (await adminRequest(d.tid ? { type: "tourUpdate", id: d.tid, data } : { type: "tourCreate", data }))
          toast(data.publish ? "Tournoi publié" : "Brouillon enregistré");
        return;
      }
      case "tour-postpone-form":
        if (await adminRequest({ type: "tourPostpone", id: d.tid, start: d.start }))
          toast("Tournoi reporté, inscrits prévenus");
        return;
      case "tour-cancel-form":
        if (await adminRequest({ type: "tourCancel", id: d.tid, reason: d.reason }))
          toast("Tournoi annulé, inscrits prévenus");
        return;
      case "client-credit-form":
        if (await adminRequest({ type: "playerCredit", id: d.cid, amount: Number(d.amount), reason: d.reason }))
          toast("Solde mis à jour");
        return;
      case "client-edit-form":
        if (await adminRequest({ type: "playerUpdate", id: d.cid, name: d.name, avatar: d.avatar, ...(d.email !== undefined ? { email: d.email, verified: d.verified === "on" } : {}) }))
          toast("Fiche enregistrée");
        return;
      case "bonus-form":
        if (await adminRequest({ type: "loginBonus", amount: Number(d.amount) }))
          toast("Montant du bonus de connexion enregistré");
        return;
      case "admin-form":
        adminToken = d.key;
        f.reset();
        if (await adminRequest()) {
          f.hidden = true;
          try {
            localStorage.setItem("adminKey", adminToken); // reste connecté sur cet appareil
          } catch {}
        }
        return;
      case "login-form":
        try {
          await api("/api/auth/login", d);
          localStorage.setItem("lastEmail", d.email.trim());
        } catch (err) {
          if (err.status !== 404) throw err;
          // Adresse inconnue : on propose de créer le compte tout de suite avec ces identifiants.
          loginDraft = d;
          modal(`<div class="confirm"><span class="confirm-icon">✉️</span><h2>Nouvelle adresse</h2><p>Aucun compte n’existe pour <b>${e(d.email)}</b>. Voulez-vous le créer maintenant avec ce mot de passe ?</p><div class="stack">${btn("Créer mon compte", "createFromLogin", "gold-btn wide")}${btn("Corriger l’adresse", "close", "line-btn wide")}</div></div>`, "confirm-modal");
          return;
        }
        localStorage.setItem("welcomed", "1");
        toast("Heureux de vous revoir !");
        go("home");
        break;
      case "register-form":
        await api("/api/auth/register", d);
        localStorage.setItem("lastEmail", d.email.trim());
        localStorage.setItem("welcomed", "1");
        pendingName = d.name;
        go("avatar", { onboarding: true });
        return;
      case "forgot-form":
        await api("/api/auth/forgot", d);
        page = { ...page, params: { sent: true } };
        render();
        break;
      case "reset-form":
        await api("/api/auth/reset", { ...d, token: resetToken });
        history.replaceState(null, "", "/");
        toast("Mot de passe modifié, vous êtes connecté");
        go("home");
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
function handleDeepLink() {
  // Lien d'une notification : /?tournoi=<id> ouvre le tournoi (après connexion si nécessaire).
  const q = new URLSearchParams(location.search);
  if (q.get("tournoi")) {
    page = { name: "tournament", params: { id: q.get("tournoi") } };
    pageStack = [{ name: "tournaments", params: {} }];
    localStorage.setItem("welcomed", "1");
    history.replaceState(null, "", "/");
  }
}
function handleHash() {
  const h = location.hash;
  if (h === "#verified") toast("Adresse e-mail confirmée, merci !");
  if (h === "#verify-failed") toast("Ce lien de confirmation n’est plus valable.");
  if (h.startsWith("#reset=")) {
    resetToken = h.slice(7);
    page = { name: "reset", params: {} };
  }
  if (["#verified", "#verify-failed"].includes(h)) history.replaceState(null, "", "/");
}
async function connect() {
  try {
    const session = await fetch("/api/session", { method: "POST" });
    if (!session.ok) return toast("Accès au profil indisponible. Contactez l’administrateur.");
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: crypto.randomUUID(), type: "timezone", data: { timeZone: myTz() } }));
      if (retry) toast("Connexion rétablie · partie restaurée");
      retry = 0;
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "state") {
        const first = !state;
        const prevDeal = state?.table?.game?.deal;
        const ng = msg.table?.game;
        if (ng?.allPassed && prevDeal && ng.deal > prevDeal)
          toast(`Tout le monde a passé · nouvelle donne, ${msg.table.seats[ng.dealer]?.name ?? "le joueur suivant"} distribue`);
        const m = msg.table?.game?.multiplier ?? 1;
        if (m > lastMultiplier) tone([880, 660, 990], 0.1, 0.07);
        lastMultiplier = m;
        if (msg.table?.game?.trick.length > (state?.table?.game?.trick.length ?? 0)) tone([300], 0.05, 0.05);
        state = msg;
        render();
        if (first && pendingInvite && !state.table) joinModal(pendingInvite);
      }
      if (msg.type === "bonus") showBonus(msg);
      if (msg.type === "notice") {
        state.player.inbox = [msg.notice, ...(state.player.inbox ?? [])];
        toast(`🔔 ${msg.notice.title}`);
        tone([660, 880], 0.08, 0.05);
        render();
      }
      if (msg.type === "ack" && pendingAcks[msg.id]) {
        pendingAcks[msg.id](msg);
        delete pendingAcks[msg.id];
      }
      if (msg.type === "state") {
        if (pendingName && state.player.account) {
          cmd("profile", { name: pendingName });
          pendingName = null;
        }
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
        shopBuying = false;
        if (msg.code === "shopFunds") {
          shopBuying = false;
          delete pendingAcks[msg.id];
          const it = state.player.shop.items.find((x) => x.price === msg.price) ?? { name: "Cet article", price: msg.price };
          return shopFundsModal(it, msg.missing);
        }
        if (msg.code === "funds") {
          delete pendingAcks[msg.id];
          return fundsTourModal(msg);
        }
        delete pendingAcks[msg.id];
        if (/Solde insuffisant/.test(msg.message)) fundsModal(state.table?.stake ?? 100);
        // Coup envoyé sur un état déjà dépassé : la table vient d'être actualisée, rien à signaler.
        if (!/Action périmée/.test(msg.message)) toast(msg.message);
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
// Écran de chargement : une astuce de joueur pendant que la partie se prépare.
{
  const sp = document.querySelector("#app .splash p");
  if (sp && location.pathname.replace(/\/$/, "") !== "/admin") {
    const tip = nextTip();
    sp.insertAdjacentHTML("afterend", `<p class="tip-line"><span>💡 Astuce · ${e(tip.category)}</span>${e(tip.text)}</p>`);
  }
}
// Back office : page séparée (/admin), jamais affichée dans l'application des joueurs.
if (location.pathname.replace(/\/$/, "") === "/admin") {
  document.title = "Administration — Belote Prestige";
  $("#app").innerHTML = `<main class="admin-page"><header class="admin-top"><img src="/decor/logo.webp" alt=""><div><h1>Back office</h1><small>Belote Prestige · administration</small></div><button type="button" class="chip-btn ghost admin-logout" data-action="adminLogout">Se déconnecter</button></header><form id="admin-form" class="form inline admin-login"><p class="muted">Accès réservé (clé BELOTE_ADMIN_KEY du serveur).</p><label>Clé d’administration<input name="key" type="password" required autocomplete="off"></label><button class="pill small">Ouvrir</button></form><div id="admin-result"></div></main>`;
  let saved = null;
  try {
    saved = localStorage.getItem("adminKey");
  } catch {}
  if (saved) {
    adminToken = saved;
    $("#admin-form").hidden = true;
    adminRequest().then((ok) => {
      if (ok) return;
      try {
        localStorage.removeItem("adminKey"); // clé changée sur le serveur : on la redemande
      } catch {}
      $("#admin-form").hidden = false;
    });
  }
} else {
  loadAuthConfig();
  handleHash();
  handleDeepLink();
  connect();
}
