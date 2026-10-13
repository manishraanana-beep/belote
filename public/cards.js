const symbols = { S: "♠", H: "♥", C: "♣", D: "♦" };
const names = { S: "pique", H: "cœur", C: "trèfle", D: "carreau" };
const patterns = {
  7: [0, 2, 9, 11, 18, 20, 4],
  8: [0, 2, 9, 11, 18, 20, 4, 16],
  9: [0, 2, 6, 8, 12, 14, 18, 20, 10],
  10: [0, 2, 6, 8, 12, 14, 18, 20, 4, 16],
  A: [10],
};
function portrait(rank, symbol) {
  const crown =
    rank === "J"
      ? '<path d="M20 22V14H40V22"/>'
      : rank === "Q"
        ? '<path d="M20 22L17 11L25 16L30 7L35 16L43 11L40 22Z"/>'
        : '<path d="M19 22L16 8L24 13L30 5L36 13L44 8L41 22Z"/>';
  const figure = `<path fill="#31597b" d="M9 62L14 44L26 38H34L46 44L51 62Z"/><path fill="#d1ac56" d="M24 39L30 54L36 39L41 62H19Z"/><path fill="#f0d3ab" stroke="#443b30" stroke-width="1" d="M21 22H39V31Q37 42 30 42Q23 42 21 31Z"/><g fill="#d1ac56" stroke="#856631" stroke-width="1">${crown}</g><path stroke="#443b30" stroke-width="1" fill="none" d="M25 28H27M33 28H35M30 29L29 34H32M27 37H33"/><text x="30" y="61" text-anchor="middle" fill="currentColor" font-size="15">${symbol}</text>`;
  return `<svg class="court-art" viewBox="0 0 60 120" aria-hidden="true"><rect x="1" y="1" width="58" height="118" rx="2" fill="#f8efda" stroke="#b69b62"/><g>${figure}</g><g transform="translate(60 120) rotate(180)">${figure}</g></svg>`;
}
export function card(c, { disabled = false, play = false } = {}) {
  const s = c.slice(-1),
    r = c.slice(0, -1),
    label = { J: "V", Q: "D", K: "R" }[r] ?? r;
  if (!symbols[s] || !["7", "8", "9", "10", "J", "Q", "K", "A"].includes(r))
    throw Error("Carte inconnue");
  const body = patterns[r]
    ? `<span class="card-pips ${r === "A" ? "ace" : ""}" aria-hidden="true">${Array.from({ length: 21 }, (_, i) => `<span class="pip-cell ${i >= 12 ? "inverted" : ""}">${patterns[r].includes(i) ? `<span class="card-pip">${symbols[s]}</span>` : ""}</span>`).join("")}</span>`
    : portrait(r, symbols[s]);
  return `<button type="button" class="card ${["H", "D"].includes(s) ? "red" : ""}" data-card="${c}" ${disabled ? "disabled" : ""} ${play ? 'data-action="play"' : ""} aria-label="${label} de ${names[s]}"><span class="corner">${label}<small>${symbols[s]}</small></span>${body}<span class="corner bottom">${label}<small>${symbols[s]}</small></span></button>`;
}
