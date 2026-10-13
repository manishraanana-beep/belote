// Génère la collection d'avatars : node scripts/build-avatars.mjs
// Style des maquettes « Contrée » : portraits chaleureux, médaillon teal, ombres douces.
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";

const out = new URL("../public/avatars/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) unlinkSync(new URL(f, out));
const INK = "#2a1a14";

function frame(body, bg = ["#2f8f86", "#14524f"]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient><radialGradient id="glow" cx="30%" cy="20%" r="40%"><stop offset="0" stop-color="#ffd98a" stop-opacity=".35"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient><clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath></defs><g clip-path="url(#c)"><rect width="120" height="120" fill="url(#bg)"/><rect width="120" height="120" fill="url(#glow)"/><g transform="translate(-10 -6) scale(1.17)">${body}</g></g></svg>`;
}
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
};

function person(o) {
  const { skin, hair, shirt, collar = shade(shirt, 0.75) } = o;
  const sk2 = shade(skin, 0.86),
    hr2 = shade(hair, 0.7),
    hr3 = shade(hair, 1.25);
  const eyeY = 63;
  const eyes = `
    <g><ellipse cx="49" cy="${eyeY}" rx="4.6" ry="4" fill="#fff"/><ellipse cx="71" cy="${eyeY}" rx="4.6" ry="4" fill="#fff"/>
    <circle cx="49.6" cy="${eyeY + 0.4}" r="3" fill="${o.iris ?? "#5a3a1e"}"/><circle cx="71.6" cy="${eyeY + 0.4}" r="3" fill="${o.iris ?? "#5a3a1e"}"/>
    <circle cx="49.8" cy="${eyeY + 0.6}" r="1.5" fill="${INK}"/><circle cx="71.8" cy="${eyeY + 0.6}" r="1.5" fill="${INK}"/>
    <circle cx="50.8" cy="${eyeY - 0.8}" r="0.9" fill="#fff"/><circle cx="72.8" cy="${eyeY - 0.8}" r="0.9" fill="#fff"/>
    <path d="M44 ${eyeY - 3.5} Q49 ${eyeY - 6.5} 54 ${eyeY - 3.6}" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M66 ${eyeY - 3.6} Q71 ${eyeY - 6.5} 76 ${eyeY - 3.5}" stroke="${INK}" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>
    <path d="M43 ${eyeY - 9} Q49 ${eyeY - 12.5} 55 ${eyeY - 9.5}" stroke="${o.brow ?? hr2}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path d="M65 ${eyeY - 9.5} Q71 ${eyeY - 12.5} 77 ${eyeY - 9}" stroke="${o.brow ?? hr2}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const mouth = o.beard
    ? `<path d="M51 80 Q60 88 69 80 Q60 84 51 80 Z" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`
    : `<path d="M50 79 Q60 89 70 79 Q60 83.5 50 79 Z" fill="#fff" stroke="#8a3a2a" stroke-width="1.3"/><path d="M54 84 Q60 87 66 84" stroke="#e07a6a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  const face = `
    <path d="M14 126 Q16 96 42 91 L78 91 Q104 96 106 126 Z" fill="${shirt}"/>
    <path d="M44 91 L60 106 L76 91 Z" fill="${collar}"/>
    <path d="M51 80 L51 95 Q60 101 69 95 L69 80 Z" fill="${sk2}"/>
    <ellipse cx="34.5" cy="66" rx="5" ry="7.5" fill="${sk2}"/><ellipse cx="85.5" cy="66" rx="5" ry="7.5" fill="${sk2}"/>
    <path d="M36 58 Q36 34 60 33 Q84 34 84 58 Q84 84 60 90 Q36 84 36 58 Z" fill="${skin}"/>
    <path d="M38 72 Q46 86 60 90 Q48 88 40 78 Z" fill="${sk2}" opacity=".6"/>
    ${eyes}
    <path d="M60 66 Q57.5 73 59.5 74.5 Q61.5 75.3 63 74" stroke="${sk2}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <ellipse cx="44" cy="74" rx="5" ry="3" fill="#ff8a7a" opacity=".35"/><ellipse cx="76" cy="74" rx="5" ry="3" fill="#ff8a7a" opacity=".35"/>
    ${o.beard ? `<path d="M37 64 Q38 92 60 96 Q82 92 83 64 Q80 78 72 80 Q66 76 60 77 Q54 76 48 80 Q40 78 37 64 Z" fill="${o.beard}"/><path d="M50 79 Q60 74 70 79" stroke="${shade(o.beard, 0.7)}" stroke-width="3" fill="none" stroke-linecap="round"/>` : ""}
    ${mouth}`;
  return `${o.back ?? ""}${face}${o.front ?? ""}${o.glasses ? `<g fill="none" stroke="${o.glasses}" stroke-width="2.2"><rect x="41" y="57" width="16" height="12" rx="5"/><rect x="63" y="57" width="16" height="12" rx="5"/><path d="M57 62 L63 62 M41 61 L36 59 M79 61 L84 59"/></g>` : ""}${o.extra ?? ""}`.replaceAll("HR", hair).replaceAll("H2", hr2).replaceAll("H3", hr3);
}

const avatars = {
  jacques: frame(person({
    skin: "#e9b48e", hair: "#4a2c1a", shirt: "#2f6b4f", beard: "#4a2c1a",
    front: `<path d="M34 56 Q30 30 50 26 Q56 18 66 22 Q86 20 87 44 Q88 54 84 58 Q82 44 74 40 Q70 46 60 42 Q50 46 44 40 Q38 46 36 58 Z" fill="HR"/>
      <g fill="H3" opacity=".7"><circle cx="48" cy="30" r="4"/><circle cx="62" cy="26" r="4"/><circle cx="76" cy="31" r="4"/></g>
      <g fill="H2"><circle cx="40" cy="38" r="5"/><circle cx="54" cy="31" r="5"/><circle cx="69" cy="30" r="5"/><circle cx="81" cy="39" r="5"/></g>`,
  })),
  sophie: frame(person({
    skin: "#f2c4a2", hair: "#a24a22", shirt: "#d9733f", iris: "#3f6b3a",
    back: `<path d="M28 60 Q24 24 60 22 Q96 24 92 60 Q98 86 90 104 L30 104 Q22 86 28 60 Z" fill="HR"/>
      <g fill="H2"><circle cx="28" cy="80" r="9"/><circle cx="92" cy="80" r="9"/><circle cx="30" cy="96" r="9"/><circle cx="90" cy="96" r="9"/></g>`,
    front: `<path d="M36 58 Q34 30 60 28 Q86 30 84 56 Q78 40 64 42 Q62 34 54 38 Q42 40 36 58 Z" fill="HR"/>
      <g fill="H3" opacity=".7"><circle cx="46" cy="34" r="5"/><circle cx="60" cy="29" r="5"/><circle cx="74" cy="34" r="5"/></g>`,
    extra: `<circle cx="34" cy="76" r="2.4" fill="#ffd36a"/><circle cx="86" cy="76" r="2.4" fill="#ffd36a"/>`,
  }), ["#3a9a8e", "#14524f"]),
  camille: frame(person({
    skin: "#f4cfb2", hair: "#e9c77a", shirt: "#3d8f8a", iris: "#3a6a9a", brow: "#b8924a",
    back: `<path d="M26 62 Q22 22 60 20 Q98 22 94 62 Q100 92 88 108 L32 108 Q20 92 26 62 Z" fill="HR"/>
      <path d="M28 70 Q22 86 32 100 M92 70 Q98 86 88 100" stroke="H2" stroke-width="5" fill="none"/>`,
    front: `<path d="M35 60 Q32 28 60 26 Q88 28 85 58 Q76 36 58 40 Q46 42 35 60 Z" fill="HR"/><path d="M44 34 Q56 28 70 33" stroke="H3" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>`,
    extra: `<circle cx="34" cy="76" r="2.4" fill="#ffd36a"/><circle cx="86" cy="76" r="2.4" fill="#ffd36a"/>`,
  }), ["#3a9a8e", "#14524f"]),
  emma: frame(person({
    skin: "#e2a982", hair: "#1c1424", shirt: "#7a3fb0", iris: "#3a2614",
    back: `<path d="M27 64 Q24 24 60 22 Q96 24 93 64 Q96 96 86 110 L34 110 Q24 96 27 64 Z" fill="HR"/>`,
    front: `<path d="M35 60 Q33 28 60 26 Q87 28 85 60 Q80 40 66 38 Q52 36 44 44 Q38 50 35 60 Z" fill="HR"/><path d="M48 32 Q60 27 72 32" stroke="#4a3a5a" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    extra: `<circle cx="34" cy="77" r="3.6" fill="none" stroke="#ffcf5a" stroke-width="2"/><circle cx="86" cy="77" r="3.6" fill="none" stroke="#ffcf5a" stroke-width="2"/>`,
  }), ["#6a4fb0", "#2a1a5a"]),
  malik: frame(person({
    skin: "#a8714d", hair: "#1a120c", shirt: "#c99a3a", beard: "#1a120c", glasses: "#2a1a14",
    front: `<path d="M35 54 Q32 28 60 26 Q88 28 85 54 Q80 40 60 38 Q42 38 35 54 Z" fill="HR"/><g fill="#2a1e16"><circle cx="44" cy="32" r="4"/><circle cx="56" cy="27" r="4"/><circle cx="68" cy="27" r="4"/><circle cx="79" cy="33" r="4"/></g>`,
  })),
  henri: frame(person({
    skin: "#efc4a4", hair: "#d8d6dc", shirt: "#5a4a8a", beard: "#dcdade", glasses: "#3a2a20", brow: "#a8a6ac",
    front: `<path d="M35 58 Q34 46 38 40 Q42 50 40 60 Z M85 58 Q86 46 82 40 Q78 50 80 60 Z" fill="HR"/><path d="M40 40 Q50 30 60 31 Q70 30 80 40 Q70 35 60 36 Q50 35 40 40 Z" fill="HR"/>`,
  }), ["#3a9a8e", "#14524f"]),
  leo: frame(person({
    skin: "#f0bf98", hair: "#6a3a1a", shirt: "#e0563f",
    front: `<path d="M36 56 Q34 38 44 36 L76 36 Q86 38 84 56 Q78 46 60 46 Q42 46 36 56 Z" fill="HR"/>
      <path d="M33 44 Q34 20 60 20 Q86 20 87 44 Z" fill="#f2b01e"/><path d="M33 44 Q60 38 87 44 L92 48 Q60 41 30 48 Z" fill="#c98a0e"/><path d="M60 44 Q94 42 104 50 Q90 54 60 50 Z" fill="#e0a114"/><circle cx="60" cy="21" r="3" fill="#c98a0e"/>`,
  })),
  chat: frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="#2f6b6f"/>
    <path d="M30 24 L48 48 L26 56 Z M90 24 L72 48 L94 56 Z" fill="#f08a2e"/><path d="M33 32 L45 48 L32 52 Z M87 32 L75 48 L88 52 Z" fill="#ffd0c0"/>
    <ellipse cx="60" cy="64" rx="34" ry="29" fill="#f59a3c"/><path d="M50 36 L54 48 M60 34 L60 47 M70 36 L66 48" stroke="#c96a1e" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="60" cy="78" rx="17" ry="12" fill="#fff4e8"/>
    <g><ellipse cx="47" cy="62" rx="6.5" ry="7" fill="#fff"/><ellipse cx="73" cy="62" rx="6.5" ry="7" fill="#fff"/><ellipse cx="47.5" cy="63" rx="4" ry="5.5" fill="#5aa04a"/><ellipse cx="73.5" cy="63" rx="4" ry="5.5" fill="#5aa04a"/><ellipse cx="47.5" cy="63" rx="1.8" ry="4.4" fill="${INK}"/><ellipse cx="73.5" cy="63" rx="1.8" ry="4.4" fill="${INK}"/><circle cx="49" cy="60" r="1.3" fill="#fff"/><circle cx="75" cy="60" r="1.3" fill="#fff"/></g>
    <path d="M56.5 72 L63.5 72 L60 76 Z" fill="#ff8a9a"/><path d="M53 78 Q60 84 67 78" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
    <g stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".9"><path d="M42 76 L24 72 M42 80 L24 82 M78 76 L96 72 M78 80 L96 82"/></g>`),
  chien: frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="#c9433a"/>
    <path d="M30 40 Q16 50 22 82 Q32 86 38 64 Z M90 40 Q104 50 98 82 Q88 86 82 64 Z" fill="#a8641e"/>
    <ellipse cx="60" cy="62" rx="31" ry="30" fill="#e8a24a"/><ellipse cx="60" cy="80" rx="18" ry="13" fill="#fbe2bc"/>
    <g><ellipse cx="48" cy="60" rx="5.5" ry="6" fill="#fff"/><ellipse cx="72" cy="60" rx="5.5" ry="6" fill="#fff"/><circle cx="48.5" cy="61" r="3.8" fill="#4a2a10"/><circle cx="72.5" cy="61" r="3.8" fill="#4a2a10"/><circle cx="50" cy="59.5" r="1.3" fill="#fff"/><circle cx="74" cy="59.5" r="1.3" fill="#fff"/></g>
    <ellipse cx="60" cy="73" rx="6.5" ry="4.6" fill="${INK}"/><path d="M60 77 L60 82 M52 82 Q60 88 68 82" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M58 84 Q60 93 65 90 Q66 86 63 84 Z" fill="#ff7a8a"/>`),
  renard: frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="#2a3a5a"/><path d="M28 28 L46 56 L24 56 Z M92 28 L74 56 L96 56 Z" fill="#e8642a"/><path d="M32 36 L42 54 L30 53 Z M88 36 L78 54 L90 53 Z" fill="#3a1e10"/>
    <path d="M60 94 Q24 88 26 58 Q34 46 60 46 Q86 46 94 58 Q96 88 60 94 Z" fill="#ee7432"/><path d="M60 94 Q34 88 33 70 Q46 66 60 80 Q74 66 87 70 Q86 88 60 94 Z" fill="#fff6ea"/>
    <g><ellipse cx="47" cy="64" rx="4.5" ry="5" fill="${INK}"/><ellipse cx="73" cy="64" rx="4.5" ry="5" fill="${INK}"/><circle cx="48.5" cy="62.5" r="1.4" fill="#fff"/><circle cx="74.5" cy="62.5" r="1.4" fill="#fff"/></g><ellipse cx="60" cy="80" rx="5" ry="3.6" fill="${INK}"/>`),
  hibou: frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="#3d6b4a"/><path d="M28 34 L42 46 L30 52 Z M92 34 L78 46 L90 52 Z" fill="#7a4a2a"/><ellipse cx="60" cy="66" rx="34" ry="32" fill="#9a6440"/><path d="M60 98 Q38 94 38 76 Q48 84 60 84 Q72 84 82 76 Q82 94 60 98 Z" fill="#e8c9a0"/>
    <circle cx="46" cy="58" r="13" fill="#fff6e0"/><circle cx="74" cy="58" r="13" fill="#fff6e0"/><circle cx="46" cy="59" r="7" fill="#f2a01e"/><circle cx="74" cy="59" r="7" fill="#f2a01e"/><circle cx="46" cy="59" r="4" fill="${INK}"/><circle cx="74" cy="59" r="4" fill="${INK}"/><circle cx="47.5" cy="57" r="1.5" fill="#fff"/><circle cx="75.5" cy="57" r="1.5" fill="#fff"/><path d="M54 68 L66 68 L60 78 Z" fill="#ffb21f"/>`),
  panda: frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="#c9433a"/><circle cx="34" cy="38" r="11" fill="${INK}"/><circle cx="86" cy="38" r="11" fill="${INK}"/><ellipse cx="60" cy="64" rx="32" ry="29" fill="#fff"/><ellipse cx="47" cy="61" rx="9" ry="11" transform="rotate(-20 47 61)" fill="${INK}"/><ellipse cx="73" cy="61" rx="9" ry="11" transform="rotate(20 73 61)" fill="${INK}"/><circle cx="48" cy="60" r="3.5" fill="#fff"/><circle cx="72" cy="60" r="3.5" fill="#fff"/><ellipse cx="60" cy="74" rx="5" ry="3.5" fill="${INK}"/><path d="M54 79 Q60 84 66 79" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`, ["#6a4fb0", "#2a1a5a"]),
};
const robot = (bg, body, accent) =>
  frame(`<path d="M14 126 Q16 98 42 93 L78 93 Q104 98 106 126 Z" fill="${body}"/><rect x="56" y="16" width="8" height="14" rx="3" fill="#9aa3b5"/><circle cx="60" cy="14" r="6" fill="${accent}"/><rect x="24" y="52" width="10" height="22" rx="4" fill="#9aa3b5"/><rect x="86" y="52" width="10" height="22" rx="4" fill="#9aa3b5"/>
    <rect x="30" y="28" width="60" height="60" rx="20" fill="#eef2f8"/><rect x="30" y="28" width="60" height="60" rx="20" fill="none" stroke="#c9d2e2" stroke-width="2"/><rect x="38" y="40" width="44" height="32" rx="12" fill="#14213d"/>
    <g fill="${accent}"><rect x="46" y="49" width="9" height="12" rx="4.5"/><rect x="65" y="49" width="9" height="12" rx="4.5"/></g><path d="M50 66 Q60 71 70 66" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round"/>`, bg);
avatars["robot-bleu"] = robot(["#3a6aa8", "#14284a"], "#3d6fd8", "#4fd1ff");
avatars["robot-corail"] = robot(["#a85a4a", "#4a1e18"], "#e0563f", "#ff8a6b");
avatars["robot-menthe"] = robot(["#2f8f86", "#14524f"], "#2fae86", "#5ee0b5");
avatars["robot-soleil"] = robot(["#a8843a", "#4a3410"], "#e0a114", "#ffd23d");
for (const [name, svg] of Object.entries(avatars)) writeFileSync(new URL(name + ".svg", out), svg + "\n");
console.log(Object.keys(avatars).length, "avatars");
