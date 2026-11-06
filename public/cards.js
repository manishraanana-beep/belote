// Illustrations : SVG-cards (David Bellot, Huub de Beer et contributeurs, LGPL),
// adaptées par scripts/build-cards.py — voir /cards-LICENSE.txt.
const names = { S: "pique", H: "cœur", C: "trèfle", D: "carreau" };
const ranks = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const labels = { J: "Valet", Q: "Dame", K: "Roi", A: "As" };
export function cardImage(c) {
  const s = c.slice(-1),
    r = c.slice(0, -1);
  if (!names[s] || !ranks.includes(r)) throw Error("Carte inconnue");
  return `/cards/${r}${s}.webp?v=${CARD_V}`; // image déjà dessinée (WebP) : affichage léger, sans redessin du dessin vectoriel
}
// Version légère (200 px, ~10 Ko) pour la main et le tapis ; la HD (400 px) seulement si l'écran l'exige (écran dense ou large).
export const CARD_V = "epure2"; // à changer pour forcer la mise à jour du cache des cartes
export const CARD_SIZES = "(min-width: 700px) 124px, 20vw";
export const cardSrcset = (c) => `${cardImage(c).replace(".webp?", "-200.webp?")} 200w, ${cardImage(c)} 400w`;
export const cardAttrs = (c) => `src="${cardImage(c)}" srcset="${cardSrcset(c)}" sizes="${CARD_SIZES}"`;
export function card(c, { disabled = false, play = false } = {}) {
  const src = cardImage(c),
    s = c.slice(-1),
    r = c.slice(0, -1);
  return `<button type="button" class="card deck-card ${["H", "D"].includes(s) ? "red" : ""}" data-card="${c}" ${disabled ? "disabled" : ""} ${play ? 'data-action="play"' : ""} aria-label="${labels[r] ?? r} de ${names[s]}"><img ${cardAttrs(c)} alt="" draggable="false" decoding="async"></button>`;
}
