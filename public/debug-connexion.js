// Mode diagnostic de la connexion : invisible pour les joueurs. S'ouvre avec ?debug=connexion dans l'adresse, ou en touchant
// 5 fois le logo. Il n'affiche jamais de jeton ni de mot de passe (seulement « présent / absent »). À retirer une fois le bug réglé.
const lines = [];
let panel = null,
  infoFn = () => ({});
export function dbg(msg) {
  lines.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (lines.length > 60) lines.shift();
  refresh();
}
function refresh() {
  if (!panel) return;
  let info = {};
  try {
    info = infoFn();
  } catch {}
  panel.querySelector("pre").textContent =
    Object.entries(info)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n") +
    "\n— journal —\n" +
    lines.join("\n");
}
function show() {
  if (panel) return;
  panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;z-index:99999;background:rgba(0,0,0,.9);color:#cfe;font:11px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;";
  const b = document.createElement("button");
  b.textContent = "Fermer le diagnostic";
  b.style.cssText = "float:right;font:12px sans-serif;padding:4px 8px;";
  b.onclick = hide;
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-all;";
  panel.append(b, pre);
  document.body.append(panel);
  refresh();
}
function hide() {
  panel?.remove();
  panel = null;
}
export function dbgInit(fn) {
  infoFn = fn;
  if (/[?&#]debug=connexion\b/.test(location.href)) show();
  let taps = 0,
    last = 0;
  // « pointerup » et non « click » : iOS n'envoie pas de clic sur un élément non cliquable comme le logo.
  document.addEventListener(
    "pointerup",
    (ev) => {
      if (!ev.target.closest?.(".logo, .page-top")) return;
      const now = Date.now();
      taps = now - last < 1500 ? taps + 1 : 1;
      last = now;
      if (taps >= 5) {
        taps = 0;
        panel ? hide() : show();
      }
    },
    true,
  );
  setInterval(refresh, 1000);
}
