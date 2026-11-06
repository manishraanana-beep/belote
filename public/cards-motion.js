// Fluidité des cartes : render() reconstruit l'écran (innerHTML), donc une carte qui change de place
// sautait. snapshot() mémorise la position visible avant, play() anime l'ancienne vers la nouvelle
// (propriété `translate`, qui se compose avec le `transform` final de la carte).
// L'arrivée d'une carte au centre reste gérée par animateTrick (non modifié).
import { state } from "./store.js";

const MAIN_MS = 200; // la main se resserre
const TRI_MS = 250; // tri de la main (même cartes, autre ordre)
const EASE = "ease-out";
const snap = { hand: new Map(), trick: new Map() };

const center = (el) => {
  const r = el.getBoundingClientRect();
  return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};
const trickKey = (el) => `${/p\d/.exec(el.className)?.[0] ?? ""}:${el.querySelector("img")?.alt ?? ""}`;

// À appeler juste avant app.innerHTML = html. getBoundingClientRect inclut l'animation en cours :
// une carte en plein mouvement repart donc de sa position actuelle.
export function snapshot() {
  snap.hand.clear();
  snap.trick.clear();
  for (const el of document.querySelectorAll(".hand .hcard")) {
    const c = center(el);
    if (c && el.dataset.card) snap.hand.set(el.dataset.card, c);
  }
  for (const el of document.querySelectorAll(".trick:not(.collecting) .tcard")) {
    const c = center(el);
    if (c) snap.trick.set(trickKey(el), c);
  }
}

const slide = (el, from, ms) => {
  const to = center(el);
  if (!to) return;
  const dx = from.x - to.x,
    dy = from.y - to.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }], { duration: ms, easing: EASE });
};

// À appeler juste après app.innerHTML = html.
export function play() {
  if (!snap.hand.size && !snap.trick.size) return;
  if (document.body.classList.contains("calm") || state?.player?.settings?.animations === false) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const hand = document.querySelector(".hand");
  if (hand && !hand.classList.contains("dealing")) {
    const cards = [...hand.querySelectorAll(".hcard")];
    const sameSet = cards.length === snap.hand.size && cards.every((el) => snap.hand.has(el.dataset.card));
    for (const el of cards) {
      const from = snap.hand.get(el.dataset.card);
      if (from) slide(el, from, sameSet ? TRI_MS : MAIN_MS);
    }
  }
  if (!document.querySelector(".trick.collecting")) {
    for (const el of document.querySelectorAll(".trick .tcard")) {
      const from = snap.trick.get(trickKey(el));
      if (from) slide(el, from, MAIN_MS);
    }
  }
}

// Carte refusée : petite secousse horizontale (200 ms).
export function shake(el) {
  if (!el || document.body.classList.contains("calm") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.animate({ translate: ["0px 0px", "-6px 0px", "6px 0px", "-3px 0px", "0px 0px"] }, { duration: 200, easing: EASE });
}
