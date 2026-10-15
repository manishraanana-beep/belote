// Illustrations : SVG-cards (David Bellot, Huub de Beer et contributeurs, LGPL),
// adaptées par scripts/build-cards.py — voir /cards-LICENSE.txt.
const names = { S: "pique", H: "cœur", C: "trèfle", D: "carreau" };
const ranks = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const labels = { J: "Valet", Q: "Dame", K: "Roi", A: "As" };
export function cardImage(c) {
  const s = c.slice(-1),
    r = c.slice(0, -1);
  if (!names[s] || !ranks.includes(r)) throw Error("Carte inconnue");
  return `/cards/${r}${s}.svg?v=epure1`; // version : force le rechargement des nouvelles cartes
}
export function card(c, { disabled = false, play = false } = {}) {
  const src = cardImage(c),
    s = c.slice(-1),
    r = c.slice(0, -1);
  return `<button type="button" class="card deck-card ${["H", "D"].includes(s) ? "red" : ""}" data-card="${c}" ${disabled ? "disabled" : ""} ${play ? 'data-action="play"' : ""} aria-label="${labels[r] ?? r} de ${names[s]}"><img src="${src}" alt="" draggable="false" decoding="async"></button>`;
}
