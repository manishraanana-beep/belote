// Boutique Prestige : goodies purement cosmétiques vendus à l'unité, payés en jetons (crédits).
// L'achat vérifie le solde disponible (hors jetons engagés en partie), débite et attribue l'article
// dans la même opération ; la clé de journal par joueur et par article interdit tout double débit.
import { toCredits, toUnits } from "./economy.js";

const AVATAR_NAMES = ["Inès", "Gérard", "Chloé", "Hugo", "Monique", "Bakary", "Rose", "Philippe", "Yasmine", "Bernard"];
const GOLD_NAMES = ["Lola", "Albert", "Manon", "Thomas", "Awa"];
const CROWN_NAMES = ["Richard", "Clara", "Gaston", "Odette", "Julien"];
const EMOJI_NAMES = ["Ravi", "Clin d’œil", "Mort de rire", "Cœur", "Bravo", "Merci", "Bien joué", "Complices", "Waouh", "Hmm…", "Pitié", "Dommage", "Salut", "Applaudissements", "Sérénité", "Défi", "Top", "Bonne partie", "Pause café", "Chut"];
const COLORS = [
  ["violet", "Violet royal"],
  ["vert", "Émeraude"],
  ["bleu", "Saphir"],
  ["rouge", "Rubis"],
  ["ivoire", "Ivoire"],
];
const pad = (n) => String(n).padStart(2, "0");

export const SHOP_CATEGORIES = [
  { id: "classic", kind: "avatar", name: "Avatar classique", price: 1000 },
  { id: "gold", kind: "avatar", name: "Avatar cadre doré", price: 2500 },
  { id: "crown", kind: "avatar", name: "Avatar couronné", price: 5000 },
  { id: "back", kind: "back", name: "Dos de cartes", price: 1500 },
  { id: "felt", kind: "felt", name: "Couleur de table", price: 3000 },
  { id: "emoji", kind: "emoji", name: "Emoji", price: 300 },
];

export const SHOP_ITEMS = [
  ...AVATAR_NAMES.map((name, i) => ({ id: `av-${pad(i + 1)}`, cat: "classic", name, img: `/shop/avatars/av-${pad(i + 1)}.webp` })),
  ...GOLD_NAMES.map((name, i) => ({ id: `av-or-${i + 1}`, cat: "gold", name, img: `/shop/avatars/av-or-${i + 1}.webp` })),
  ...CROWN_NAMES.map((name, i) => ({ id: `av-roi-${i + 1}`, cat: "crown", name, img: `/shop/avatars/av-roi-${i + 1}.webp` })),
  ...COLORS.map(([c, name]) => ({ id: `dos-${c}`, cat: "back", name, img: `/shop/backs/back-${c}.webp` })),
  ...[0, 2, 3, 4].map((k) => COLORS[k]).map(([c, name]) => ({ id: `tapis-${c}`, cat: "felt", name, img: `/shop/felts/felt-${c}.webp` })),
  ...EMOJI_NAMES.map((name, i) => ({ id: `emo-${pad(i + 1)}`, cat: "emoji", name, img: `/shop/emoji/emo-${pad(i + 1)}.webp` })),
].map((it, order) => {
  const c = SHOP_CATEGORIES.find((x) => x.id === it.cat);
  return { ...it, kind: c.kind, price: c.price, order };
});
export const isShopAvatar = (v) => typeof v === "string" && /^av-(?:\d\d|or-\d|roi-\d)$/.test(v);
export const FAVORITE_EMOJIS = 8;

export function createShop({ db, economy }) {
  db.settings ??= {};
  const overrides = () => (db.settings.shop ??= {});
  const owned = (p) => (p.progress ??= {}).owned ?? (p.progress.owned = {});
  // Catalogue courant, avec les réglages de l'administration (nom, prix, ordre, visibilité).
  function catalog() {
    return SHOP_ITEMS.map((it) => ({ ...it, ...overrides()[it.id] })).sort((a, b) => a.order - b.order);
  }
  const item = (id) => catalog().find((x) => x.id === id);
  const fail = (message, extra) => {
    throw Object.assign(Error(message), extra ?? {});
  };
  return {
    catalog,
    item,
    owns: (p, id) => !!owned(p)[id],
    view(p) {
      const mine = owned(p);
      return {
        items: catalog()
          .filter((it) => !it.hidden || mine[it.id])
          .map(({ id, cat, kind, name, img, price }) => ({ id, cat, kind, name, img, price, owned: !!mine[id] })),
        categories: SHOP_CATEGORIES,
        favorites: (p.progress?.favorites ?? []).filter((x) => mine[x]),
      };
    },
    buy(p, id) {
      const it = item(id);
      if (!it || (it.hidden && !owned(p)[id])) fail("Article indisponible");
      if (!p.accountId) fail("Créez un compte pour acheter dans la boutique");
      if (owned(p)[id]) fail("Vous possédez déjà cet article", { code: "owned" });
      const units = toUnits(it.price);
      const available = economy.available(p);
      if (available < units) fail(`Il vous manque ${toCredits(units - available)} jetons`, { code: "shopFunds", missing: toCredits(units - available), price: it.price });
      // Débit et attribution dans le même tour d'exécution : rien ne peut s'intercaler.
      const entry = economy.post(p, `shop:${p.id}:${id}`, "achat", -units, { label: `Boutique : ${it.name}`, item: id });
      if (!entry) fail("Vous possédez déjà cet article", { code: "owned" });
      owned(p)[id] = Date.now();
      if (it.kind === "emoji") {
        const fav = (p.progress.favorites ??= []);
        if (fav.length < FAVORITE_EMOJIS && !fav.includes(id)) fav.push(id);
      }
      return { item: it, balance: toCredits(economy.wallet(p).balance) };
    },
    setFavorites(p, ids) {
      if (!Array.isArray(ids)) fail("Liste invalide");
      const list = [...new Set(ids.map(String))].filter((x) => owned(p)[x] && item(x)?.kind === "emoji");
      if (list.length > FAVORITE_EMOJIS) fail(`${FAVORITE_EMOJIS} emojis favoris au maximum`);
      p.progress.favorites = list;
    },
    // Administration : nom, prix, ordre et visibilité. Masquer n'enlève rien aux possesseurs.
    update(id, d) {
      if (!SHOP_ITEMS.some((x) => x.id === id)) fail("Article inconnu");
      const o = (overrides()[id] ??= {});
      if (d.name !== undefined) {
        const name = String(d.name).trim().slice(0, 40);
        if (name.length < 2) fail("Nom trop court");
        o.name = name;
      }
      if (d.price !== undefined) {
        const price = Number(d.price);
        if (!Number.isInteger(price) || price < 0 || price > 1_000_000) fail("Prix invalide");
        o.price = price;
      }
      if (d.order !== undefined) {
        const order = Number(d.order);
        if (!Number.isFinite(order)) fail("Ordre invalide");
        o.order = order;
      }
      if (d.hidden !== undefined) o.hidden = !!d.hidden;
    },
  };
}
