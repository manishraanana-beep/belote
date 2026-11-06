// Utilitaires d'interface partagés : constantes du jeu, échappement et formats, composants HTML (`btn`, `icon`,
// `coins`, `avatar`…), toasts et fenêtres (`toast`, `modal`), commandes réseau (`cmd`, `ask`, `api`), sons, mesures `?debug=perf`.
// Ne contient aucun état propre : l'état partagé est dans store.js.
import { state, ws, sound, vibra, pendingAcks } from "./store.js";

export const $ = (s) => document.querySelector(s);
export const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const SUITS = { S: "♠", H: "♥", C: "♣", D: "♦" };
export const SUIT_NAMES = { S: "Pique", H: "Cœur", C: "Trèfle", D: "Carreau" };
export const HAND_ORDER = ["S", "H", "C", "D"];
export const TRUMP_STRENGTH = ["J", "9", "A", "10", "K", "Q", "8", "7"];
export const PLAIN_STRENGTH = ["A", "10", "K", "Q", "J", "9", "8", "7"];
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
export const RANK_NAMES = { J: "Valet", Q: "Dame", K: "Roi", A: "As" };
export const AVATARS = ["jacques", "sophie", "camille", "emma", "malik", "henri", "leo", "chat", "chien"];
export const BIDS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 250];
export const STAKES = [100, 200, 500, 1000, 2500, 10000];
export const REACTIONS = [
  { id: "bravo", text: "Bien joué !", emoji: "👏" },
  { id: "merci", text: "Merci partenaire !", emoji: "🤝" },
  { id: "belle", text: "Belle partie !", emoji: "🎉" },
  { id: "dommage", text: "Pas de chance !", emoji: "🍀" },
  { id: "rire", text: "", emoji: "😂" },
  { id: "feu", text: "", emoji: "🔥" },
  { id: "wow", text: "", emoji: "😮" },
  { id: "coeur", text: "", emoji: "❤️" },
];
export const REPORT_REASONS = {
  abuse: "Insultes ou harcèlement",
  spam: "Spam",
  cheat: "Suspicion de triche ou d’arrangement",
  profile: "Pseudo ou photo inappropriés",
  other: "Autre",
};
export const fmt = (n) => Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
export const coins = (n, cls = "") => `<span class="coins ${cls}"><i class="coin"></i>${fmt(n)}</span>`;
export const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
export const stakeRisk = (s) => `Mise : ${fmt(s)} jetons. Vous ne pouvez perdre que votre mise. Quitter la partie en cours fait perdre la mise.`;
export const DEFAULT_RULES = {
  target: 1000,
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
export const isRed = (s) => s === "H" || s === "D";
export const amountLabel = (n) => (n === 250 ? "Capot" : n === 0 ? "Pris" : String(n));
export const cardName = (c) => {
  const r = c.slice(0, -1);
  return `${RANK_NAMES[r] ?? r} de ${SUIT_NAMES[c.slice(-1)].toLowerCase()}`;
};
export const avatarUrl = (v) =>
  typeof v === "string" && v.startsWith("u:")
    ? `/u/${v.slice(2)}.jpg`
    : /^robot-[a-z]+$/.test(v ?? "")
      ? `/avatars/${v}.svg`
      : /^av-(?:\d\d|or-\d|roi-\d)$/.test(v ?? "")
        ? `/shop/avatars/${v}.webp`
        : `/avatars/${AVATARS.includes(v) ? v : "jacques"}.webp`;
// Les avatars de la boutique ont déjà leur propre cadre (doré, couronne) : on n'y ajoute pas d'anneau.
export const avatar = (v, cls = "") => `<img class="avatar ${cls} ${/^av-/.test(v ?? "") ? "framed" : ""}" src="${avatarUrl(v)}" alt="" draggable="false">`;
// Cadre de la boutique équipé par le joueur (posé autour de son avatar : accueil, profil, table).
export const myFrame = () => {
  const f = state?.player?.progress?.equipped?.frame;
  return state?.player?.shop?.items?.some((x) => x.id === f && x.owned && x.kind === "frame") ? f : "";
};
export const framed = (html) => (myFrame() ? `<span class="fr-wrap ${myFrame()}">${html}</span>` : html);
export const btn = (text, action, cls = "", data = "", disabled = false) =>
  `<button type="button" class="${cls}" data-action="${action}" ${data} ${disabled ? "disabled" : ""}>${text}</button>`;
export const suitHtml = (s) => `<span class="suit ${isRed(s) ? "red" : ""}">${SUITS[s]}</span>`;

export function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("visible"), 3800);
}

// Mode debug « ?debug=perf » : messages/min, tailles, délai action → réponse, calculs > 50 ms.
export const perf = (() => {
  try {
    if (new URLSearchParams(location.search).get("debug") !== "perf") return null;
  } catch {
    return null;
  }
  const P = { msgs: [], sizes: [], first: [], ack: [], handler: [], long: [], sent: new Map(), awaitingFirst: [] };
  const hud = document.createElement("pre");
  hud.className = "perf-hud";
  document.body.append(hud);
  const stat = (a) => (a.length ? `${Math.round(a.reduce((x, y) => x + y, 0) / a.length)} moy · ${Math.round(Math.max(...a))} max` : "–");
  const med = (a) => (a.length ? Math.round([...a].sort((x, y) => x - y)[a.length >> 1]) : "–");
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => P.long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
  } catch {}
  const draw = () => {
    const now = performance.now();
    P.msgs = P.msgs.filter((t) => now - t < 60000);
    hud.textContent =
      `perf · messages/min : ${P.msgs.length}\n` +
      `taille (Ko) : ${P.sizes.length ? `${(P.sizes.reduce((x, y) => x + y, 0) / P.sizes.length / 1024).toFixed(1)} moy · ${(Math.max(...P.sizes) / 1024).toFixed(1)} max` : "–"} (${P.sizes.length} msg)\n` +
      `action → 1er message (ms) : méd ${med(P.first)} · ${stat(P.first)}\n` +
      `action → ack (ms) : méd ${med(P.ack)} · ${stat(P.ack)}\n` +
      `traitement d’un message (ms) : ${stat(P.handler)}\n` +
      `calculs > 50 ms : ${P.long.length}${P.long.length ? ` (max ${Math.max(...P.long)} ms)` : ""}`;
  };
  setInterval(draw, 1000);
  window.__perf = P; // pour les mesures automatisées
  return {
    sent(id) {
      P.sent.set(id, performance.now());
      P.awaitingFirst.push(performance.now());
    },
    msg(data) {
      const now = performance.now();
      P.msgs.push(now);
      P.sizes.push(data.length);
      while (P.awaitingFirst.length) P.first.push(now - P.awaitingFirst.shift());
    },
    ack(id) {
      const t0 = P.sent.get(id);
      if (t0 !== undefined) {
        P.ack.push(performance.now() - t0);
        P.sent.delete(id);
      }
    },
    done(t0) {
      P.handler.push(performance.now() - t0);
    },
  };
})();
export function cmd(type, data = {}) {
  if (ws?.readyState !== 1) return toast("Connexion en cours…");
  const id = crypto.randomUUID();
  perf?.sent(id);
  ws.send(JSON.stringify({ id, type, data }));
}
export async function api(path, body, raw = false) {
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
// Réveille le contexte audio au premier geste (iOS/Safari le suspendent tant que l'utilisateur n'a pas touché l'écran).
export function unlockAudio() {
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume?.();
  } catch {}
}
export function cardSound(vol = 0.5) {
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
// Petits sons doux (cloche, sans fichier) et vibrations, pour les moments clés de la partie.
export function chime(notes, { gap = 0.11, vol = 0.07, type = "sine", decay = 0.9 } = {}) {
  if (!sound) return;
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(),
        o2 = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = type;
      o2.type = "sine";
      o.frequency.value = f;
      o2.frequency.value = f * 2; // harmonique légère : timbre de clochette
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * gap;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.start(t0);
      o2.start(t0);
      o.stop(t0 + decay + 0.05);
      o2.stop(t0 + decay + 0.05);
    });
  } catch {}
}
export function buzz(pattern) {
  if (!vibra) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
export const SFX = {
  myTurn: () => (chime([880], { vol: 0.035, decay: 0.35 }), buzz(25)),
  trickUs: () => chime([660, 990], { gap: 0.08, vol: 0.04, decay: 0.5 }),
  belote: () => (chime([784, 988, 1175], { gap: 0.09, vol: 0.05 }), buzz([20, 40, 20])),
  counter: () => (chime([392, 330], { gap: 0.12, vol: 0.06, type: "triangle" }), buzz([40, 30, 40])),
  win: () => (chime([523, 659, 784, 1046, 1318], { gap: 0.12, vol: 0.07, decay: 1.4 }), buzz([60, 50, 60, 50, 140])),
  lose: () => chime([392, 330, 262], { gap: 0.18, vol: 0.04, decay: 1 }),
  capot: () => (chime([523, 784, 1046, 1568], { gap: 0.1, vol: 0.08, decay: 1.6 }), buzz([80, 40, 80, 40, 200])),
  coin: () => chime([1568, 2093], { gap: 0.05, vol: 0.03, decay: 0.3 }),
};

export function tone(freqs, dur = 0.12, vol = 0.06) {
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

export function modal(content, cls = "") {
  const m = $("#modal");
  m.className = cls;
  m.innerHTML = `<button type="button" class="modal-close" data-action="close" aria-label="Fermer">✕</button>${content}`;
  if (!m.open) m.showModal();
}
export const closeModal = () => $("#modal").open && $("#modal").close();

export const ICONS = {
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

export const icon = (name, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;

export const readLocal = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const writeLocal = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

// Commande avec suite : le rappel ne s'exécute qu'en cas de succès (les erreurs s'affichent seules).
export function ask(type, data, then) {
  if (ws?.readyState !== 1) return toast("Connexion en cours…");
  const id = crypto.randomUUID();
  pendingAcks[id] = then;
  perf?.sent(id);
  ws.send(JSON.stringify({ id, type, data }));
}
// Date courte (jour, heure) en français ; fuseau horaire de l'appareil.
export const when = (ts) => new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
