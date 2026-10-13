// Génère la collection d'avatars illustrés : node scripts/build-avatars.mjs
// Style commun : médaillon rond, dégradé doux, personnages en buste, traits épais et arrondis.
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("../public/avatars/", import.meta.url);
mkdirSync(out, { recursive: true });
const INK = "#2b2140";

function frame(id, bg1, bg2, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="g" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient><clipPath id="c"><circle cx="60" cy="60" r="60"/></clipPath></defs><g clip-path="url(#c)"><rect width="120" height="120" fill="url(#g)"/><circle cx="22" cy="24" r="10" fill="#fff" opacity=".18"/><circle cx="98" cy="30" r="5" fill="#fff" opacity=".18"/>${body}</g></svg>`;
}
const eyes = (y = 60, dx = 11, cx = 60, r = 4.2) =>
  `<g fill="${INK}"><ellipse cx="${cx - dx}" cy="${y}" rx="${r}" ry="${r * 1.15}"/><ellipse cx="${cx + dx}" cy="${y}" rx="${r}" ry="${r * 1.15}"/></g><g fill="#fff"><circle cx="${cx - dx + 1.4}" cy="${y - 1.6}" r="1.4"/><circle cx="${cx + dx + 1.4}" cy="${y - 1.6}" r="1.4"/></g>`;
const cheeks = (y = 70, dx = 18, cx = 60) =>
  `<g fill="#ff7d8a" opacity=".45"><ellipse cx="${cx - dx}" cy="${y}" rx="5.5" ry="3.5"/><ellipse cx="${cx + dx}" cy="${y}" rx="5.5" ry="3.5"/></g>`;
const smile = (y = 74, w = 8, cx = 60) =>
  `<path d="M${cx - w} ${y} Q${cx} ${y + w * 0.9} ${cx + w} ${y}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
const shoulders = (color, collar = "#fff") =>
  `<path d="M14 124 Q16 94 44 90 L76 90 Q104 94 106 124 Z" fill="${color}"/><path d="M48 90 L60 103 L72 90 Z" fill="${collar}"/>`;
const neck = (skin) => `<rect x="52" y="78" width="16" height="16" rx="6" fill="${skin}"/>`;
const head = (skin, rx = 25, ry = 28, cy = 60) =>
  `<ellipse cx="34" cy="${cy + 2}" rx="5" ry="7" fill="${skin}"/><ellipse cx="86" cy="${cy + 2}" rx="5" ry="7" fill="${skin}"/><ellipse cx="60" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}"/>`;

function person({ skin, hairBack = "", hairFront, shirt, collar, extra = "", mouth = smile() }) {
  return `${hairBack}${shoulders(shirt, collar)}${neck(skin)}${head(skin)}${eyes()}${cheeks()}${mouth}${hairFront}${extra}`;
}

const avatars = {
  // — Personnages —
  lea: frame("lea", "#ffd9a8", "#ff9e7a", person({
    skin: "#f6c9a4",
    hairBack: `<path d="M30 58 Q28 26 60 24 Q92 26 90 58 L94 100 Q78 92 76 70 L44 70 Q42 92 26 100 Z" fill="#7a3b1e"/>`,
    hairFront: `<path d="M34 54 Q36 30 60 30 Q84 30 86 54 Q74 40 58 44 Q44 46 34 54 Z" fill="#8c4524"/>`,
    shirt: "#4f7cff",
    extra: `<circle cx="80" cy="36" r="6" fill="#ffcf3d"/><circle cx="80" cy="36" r="2.5" fill="#ff6f61"/>`,
  })),
  hugo: frame("hugo", "#bfe8ff", "#5ab4f0", person({
    skin: "#f1c39a",
    hairFront: `<path d="M33 54 Q30 28 58 27 Q88 26 87 52 Q80 38 66 42 Q52 34 33 54 Z" fill="#3b2a20"/>`,
    shirt: "#ff6f61",
    extra: `<path d="M30 40 Q58 14 90 38 L92 44 Q60 30 28 46 Z" fill="#2b2140"/><circle cx="60" cy="22" r="3.5" fill="#2b2140"/>`,
  })),
  nadia: frame("nadia", "#e7d4ff", "#a67cf2", person({
    skin: "#a8714d",
    hairBack: `<circle cx="60" cy="50" r="38" fill="#24170f"/><circle cx="28" cy="70" r="14" fill="#24170f"/><circle cx="92" cy="70" r="14" fill="#24170f"/>`,
    hairFront: `<path d="M34 52 Q40 30 60 30 Q80 30 86 52 Q72 40 60 42 Q46 40 34 52 Z" fill="#2d1d13"/>`,
    shirt: "#ffcf3d",
    collar: "#ff6f61",
    extra: `<circle cx="35" cy="72" r="3" fill="#ffcf3d"/><circle cx="85" cy="72" r="3" fill="#ffcf3d"/>`,
  })),
  karim: frame("karim", "#c8f5e2", "#3fc79a", person({
    skin: "#c98d62",
    hairFront: `<path d="M34 52 Q32 30 60 28 Q88 30 86 52 L82 46 Q60 36 38 46 Z" fill="#1d1410"/>`,
    shirt: "#2b2140",
    collar: "#5ee0b5",
    mouth: `<path d="M44 76 Q60 92 76 76 Q60 84 44 76 Z" fill="#1d1410"/>${smile(73, 7)}`,
  })),
  mamie: frame("mamie", "#ffe3ef", "#ff9cc0", person({
    skin: "#f4d2b8",
    hairFront: `<path d="M32 58 Q30 30 60 28 Q90 30 88 58 Q84 40 60 40 Q36 40 32 58 Z" fill="#e8e6f0"/><circle cx="60" cy="24" r="12" fill="#e8e6f0"/>`,
    shirt: "#8a5cf6",
    extra: `<g fill="none" stroke="${INK}" stroke-width="2.5"><circle cx="49" cy="60" r="8"/><circle cx="71" cy="60" r="8"/><path d="M57 60 L63 60"/></g>`,
  })),
  papi: frame("papi", "#ffeab3", "#ffb84d", person({
    skin: "#f0c7a3",
    hairFront: `<path d="M34 50 Q36 40 42 40 L42 52 Z M86 50 Q84 40 78 40 L78 52 Z" fill="#d9d6e3"/>`,
    shirt: "#3a8f5c",
    mouth: `<path d="M42 72 Q50 66 60 72 Q70 66 78 72 Q72 80 60 76 Q48 80 42 72 Z" fill="#d9d6e3"/>`,
    extra: `<path d="M30 42 Q60 22 90 42 Q92 34 84 30 Q60 18 36 30 Q28 34 30 42 Z" fill="#ff6f61"/><circle cx="60" cy="22" r="3" fill="#ff6f61"/>`,
  })),
  lou: frame("lou", "#fff2b3", "#ffd23d", person({
    skin: "#ffd8bf",
    hairBack: `<circle cx="30" cy="56" r="12" fill="#ff8c3a"/><circle cx="90" cy="56" r="12" fill="#ff8c3a"/>`,
    hairFront: `<path d="M33 56 Q30 28 60 26 Q90 28 87 56 Q80 42 70 44 Q64 34 56 40 Q44 38 33 56 Z" fill="#ff8c3a"/>`,
    shirt: "#5ee0b5",
    extra: `<g fill="#c26a2a" opacity=".6"><circle cx="44" cy="68" r="1.2"/><circle cx="48" cy="70" r="1.2"/><circle cx="72" cy="70" r="1.2"/><circle cx="76" cy="68" r="1.2"/></g>`,
  })),
  sacha: frame("sacha", "#d6f0ff", "#7cc3ff", person({
    skin: "#e0a77f",
    hairFront: `<path d="M34 54 Q32 34 60 32 Q88 34 86 54 Q74 46 60 46 Q46 46 34 54 Z" fill="#5a3a26"/>`,
    shirt: "#ff9e2c",
    extra: `<path d="M32 46 Q34 22 60 22 Q86 22 88 46 Z" fill="#ff4f6d"/><path d="M60 44 Q94 42 104 50 Q90 54 60 50 Z" fill="#e23b59"/><circle cx="60" cy="23" r="3.5" fill="#fff"/>`,
  })),
  // — Animaux —
  renard: frame("renard", "#ffe0c2", "#ff9d5c",
    `${shoulders("#2b2140", "#ffcf3d")}<path d="M30 30 L44 58 L24 56 Z M90 30 L76 58 L96 56 Z" fill="#ff7a2f"/><path d="M33 36 L42 54 L30 53 Z M87 36 L78 54 L90 53 Z" fill="#2b2140"/><path d="M60 92 Q24 86 26 56 Q34 44 60 44 Q86 44 94 56 Q96 86 60 92 Z" fill="#ff7a2f"/><path d="M60 92 Q36 86 34 70 Q46 66 60 78 Q74 66 86 70 Q84 86 60 92 Z" fill="#fff6ea"/>${eyes(62, 13)}<ellipse cx="60" cy="78" rx="5" ry="3.6" fill="${INK}"/>${cheeks(72, 22)}`),
  chat: frame("chat", "#e5e8ff", "#9aa6f5",
    `${shoulders("#ff6f61", "#fff")}<path d="M30 28 L46 50 L28 58 Z M90 28 L74 50 L92 58 Z" fill="#8b8fa8"/><path d="M34 36 L43 50 L33 54 Z M86 36 L77 50 L87 54 Z" fill="#ffb3c1"/><ellipse cx="60" cy="64" rx="32" ry="28" fill="#9b9fb8"/><path d="M50 38 L54 48 M60 36 L60 47 M70 38 L66 48" stroke="#7d8198" stroke-width="3" stroke-linecap="round"/><ellipse cx="60" cy="76" rx="14" ry="10" fill="#f1f1f6"/>${eyes(62, 13)}<path d="M57 72 L63 72 L60 75 Z" fill="#ff7d8a"/>${smile(76, 5)}<g stroke="${INK}" stroke-width="1.6" stroke-linecap="round"><path d="M44 74 L28 70 M44 78 L28 80 M76 74 L92 70 M76 78 L92 80"/></g>`),
  hibou: frame("hibou", "#d9f2e6", "#6cc9a0",
    `${shoulders("#2b2140", "#ffcf3d")}<path d="M28 34 L42 46 L30 52 Z M92 34 L78 46 L90 52 Z" fill="#8a5a3c"/><ellipse cx="60" cy="66" rx="34" ry="32" fill="#a26b47"/><path d="M60 98 Q38 94 38 76 Q48 84 60 84 Q72 84 82 76 Q82 94 60 98 Z" fill="#e8c9a0"/><circle cx="46" cy="58" r="13" fill="#fff6e0"/><circle cx="74" cy="58" r="13" fill="#fff6e0"/>${eyes(58, 14, 60, 6)}<path d="M54 68 L66 68 L60 78 Z" fill="#ffb21f"/>`),
  panda: frame("panda", "#e9f7d9", "#9fd96b",
    `${shoulders("#4f7cff", "#fff")}<circle cx="34" cy="38" r="11" fill="${INK}"/><circle cx="86" cy="38" r="11" fill="${INK}"/><ellipse cx="60" cy="64" rx="32" ry="29" fill="#fff"/><ellipse cx="47" cy="61" rx="9" ry="11" transform="rotate(-20 47 61)" fill="${INK}"/><ellipse cx="73" cy="61" rx="9" ry="11" transform="rotate(20 73 61)" fill="${INK}"/><circle cx="48" cy="60" r="3.5" fill="#fff"/><circle cx="72" cy="60" r="3.5" fill="#fff"/><ellipse cx="60" cy="74" rx="5" ry="3.5" fill="${INK}"/>${smile(79, 6)}${cheeks(74, 20)}`),
  ours: frame("ours", "#ffe9c7", "#f2b766",
    `${shoulders("#3fc79a", "#fff")}<circle cx="34" cy="38" r="12" fill="#8c5a33"/><circle cx="86" cy="38" r="12" fill="#8c5a33"/><circle cx="34" cy="38" r="6" fill="#d9a074"/><circle cx="86" cy="38" r="6" fill="#d9a074"/><ellipse cx="60" cy="64" rx="32" ry="29" fill="#9c6a40"/><ellipse cx="60" cy="76" rx="15" ry="11" fill="#e4bb8f"/>${eyes(60, 13)}<ellipse cx="60" cy="72" rx="6" ry="4.2" fill="${INK}"/>${smile(78, 5)}${cheeks(70, 22)}`),
  lapin: frame("lapin", "#ffe1ea", "#ff9fbb",
    `${shoulders("#8a5cf6", "#fff")}<ellipse cx="46" cy="22" rx="9" ry="24" fill="#f7f3f8"/><ellipse cx="74" cy="22" rx="9" ry="24" fill="#f7f3f8"/><ellipse cx="46" cy="22" rx="4.5" ry="17" fill="#ffb3c8"/><ellipse cx="74" cy="22" rx="4.5" ry="17" fill="#ffb3c8"/><ellipse cx="60" cy="66" rx="30" ry="28" fill="#f7f3f8"/>${eyes(62, 12)}<path d="M57 71 L63 71 L60 74 Z" fill="#ff7d8a"/><rect x="56" y="76" width="8" height="7" rx="2" fill="#fff" stroke="${INK}" stroke-width="1.5"/>${cheeks(72, 19)}`),
  grenouille: frame("grenouille", "#e3f9c9", "#8fd94f",
    `${shoulders("#ffcf3d", "#ff6f61")}<ellipse cx="60" cy="70" rx="36" ry="26" fill="#58c24a"/><circle cx="40" cy="46" r="14" fill="#58c24a"/><circle cx="80" cy="46" r="14" fill="#58c24a"/><circle cx="40" cy="46" r="9" fill="#fff"/><circle cx="80" cy="46" r="9" fill="#fff"/><circle cx="41" cy="47" r="5" fill="${INK}"/><circle cx="81" cy="47" r="5" fill="${INK}"/><circle cx="42.5" cy="45" r="1.6" fill="#fff"/><circle cx="82.5" cy="45" r="1.6" fill="#fff"/><path d="M36 74 Q60 94 84 74" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>${cheeks(76, 26)}`),
  chien: frame("chien", "#fff1d6", "#ffc76b",
    `${shoulders("#ff6f61", "#fff")}<ellipse cx="60" cy="64" rx="30" ry="29" fill="#e9c08f"/><path d="M32 40 Q20 46 24 74 Q34 76 38 56 Z M88 40 Q100 46 96 74 Q86 76 82 56 Z" fill="#8c5a33"/><ellipse cx="72" cy="56" rx="10" ry="9" fill="#c99566"/><ellipse cx="60" cy="78" rx="14" ry="10" fill="#fff4e4"/>${eyes(60, 12)}<ellipse cx="60" cy="72" rx="6" ry="4.4" fill="${INK}"/><path d="M60 80 Q60 90 66 88" fill="#ff7d8a" stroke="#ff7d8a" stroke-width="4" stroke-linecap="round"/>`),
  // — Robots (réservés aux joueurs automatiques) —
};
const robot = (bg1, bg2, body, accent) =>
  frame("robot", bg1, bg2,
    `${shoulders(body, accent)}<rect x="56" y="18" width="8" height="14" rx="3" fill="#9aa3b5"/><circle cx="60" cy="16" r="6" fill="${accent}"/><rect x="26" y="52" width="10" height="20" rx="4" fill="#9aa3b5"/><rect x="84" y="52" width="10" height="20" rx="4" fill="#9aa3b5"/><rect x="32" y="30" width="56" height="56" rx="16" fill="${body}"/><rect x="38" y="40" width="44" height="32" rx="10" fill="#1f2a44"/><g fill="${accent}"><rect x="46" y="49" width="9" height="11" rx="4.5"/><rect x="65" y="49" width="9" height="11" rx="4.5"/></g><path d="M50 66 Q60 71 70 66" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round"/><circle cx="40" cy="80" r="2.4" fill="#fff" opacity=".7"/><circle cx="80" cy="80" r="2.4" fill="#fff" opacity=".7"/>`);
avatars["robot-bleu"] = robot("#dbe7ff", "#7c9cf5", "#c7d3ec", "#4fd1ff");
avatars["robot-corail"] = robot("#ffe1dc", "#ff9a8a", "#efd0cb", "#ff6f61");
avatars["robot-menthe"] = robot("#d9f7ec", "#6fd6b0", "#cde9de", "#3fc79a");
avatars["robot-soleil"] = robot("#fff2c4", "#ffd04d", "#efe2b8", "#ffb21f");

for (const [name, svg] of Object.entries(avatars)) writeFileSync(new URL(name + ".svg", out), svg + "\n");
console.log(Object.keys(avatars).length, "avatars générés");
