// Boutique Prestige : goodies purement cosmétiques vendus à l'unité, payés en jetons (crédits).
// L'achat vérifie le solde disponible (hors jetons engagés en partie), débite et attribue l'article
// dans la même opération ; la clé de journal par joueur et par article interdit tout double débit.
import { toCredits, toUnits } from "./economy.js";

// Avatars : visages gratuits (dix classiques, plus d'« or »/« couronne » payants — remplacés par les
// cadres de la boutique, qui s'équipent par-dessus n'importe quel avatar). Liste et prix : plan jetons/
// boutique (29–30/10), onglet « Objets » du tableur — 24 objets en vente, 7 à gagner (progression.js).
const AVATAR_NAMES = ["Inès", "Gérard", "Chloé", "Hugo", "Monique", "Bakary", "Rose", "Philippe", "Yasmine", "Bernard"];
const EMOJI_NAMES = ["Ravi", "Clin d’œil", "Mort de rire", "Cœur", "Bravo", "Merci", "Bien joué", "Complices", "Waouh", "Hmm…", "Pitié", "Dommage", "Salut", "Applaudissements", "Sérénité", "Défi", "Top", "Bonne partie", "Pause café", "Chut"];
const pad = (n) => String(n).padStart(2, "0");
export const FREE_AVATARS = AVATAR_NAMES.map((name, i) => ({ id: `av-${pad(i + 1)}`, name, img: `/shop/avatars/av-${pad(i + 1)}.webp` }));

// Tapis et dos : les 5 couleurs existantes (art déjà prêt) reprises une par ville.
const CITY_COLOR = { paris: "vert", cannes: "bleu", monaco: "violet", dubai: "rouge", vegas: "ivoire" };
const CITY_NAME = { paris: "Paris", cannes: "Cannes", monaco: "Monaco", dubai: "Dubaï", vegas: "Las Vegas" };
// Cadres : images provisoires (cadre-or-N / cadre-roi-N existants) en attendant les visuels définitifs
// par ville (prompts prêts dans PROMPTS-IMAGES-BELOTE.md) — même principe que la photo de Cannes.
const CITY_FRAME_IMG = { paris: "/shop/frames/cadre-or-3.webp", cannes: "/shop/frames/cadre-roi-2.webp", monaco: "/shop/frames/cadre-roi-3.webp", dubai: "/shop/frames/cadre-or-4.webp", vegas: "/shop/frames/cadre-or-5.webp" };

export const SHOP_CATEGORIES = [
  { id: "felt", kind: "felt", name: "Tapis" },
  { id: "back", kind: "back", name: "Dos de cartes" },
  { id: "frame", kind: "frame", name: "Cadre" },
  { id: "effect", kind: "effect", name: "Effet de victoire" },
  { id: "reaction", kind: "reaction", name: "Réactions" },
  { id: "emoji", kind: "emoji", name: "Emoji" },
];
const CITIES = ["paris", "cannes", "monaco", "dubai", "vegas"];
const GAMME = { paris: "Classique", cannes: "Classique", monaco: "Rare", dubai: "Rare", vegas: "Prestige" };

export const SHOP_ITEMS = [
  // Tapis par ville.
  ...CITIES.map((v) => ({ id: `felt-${v}`, cat: "felt", ville: v, gamme: GAMME[v], name: `Tapis ${CITY_NAME[v]}`, price: { paris: 2000, cannes: 4000, monaco: 15000, dubai: 25000, vegas: 100000 }[v], img: `/shop/felts/felt-${CITY_COLOR[v]}.webp` })),
  // Dos de cartes par ville.
  ...CITIES.map((v) => ({ id: `back-${v}`, cat: "back", ville: v, gamme: GAMME[v], name: `Dos ${CITY_NAME[v]}`, price: { paris: 2000, cannes: 4000, monaco: 10000, dubai: 20000, vegas: 75000 }[v], img: `/shop/backs/back-${CITY_COLOR[v]}.webp` })),
  // Cadres par ville (le dernier, animé, pour Las Vegas) + 3 cadres génériques.
  ...CITIES.map((v) => ({ id: `frame-v-${v}`, cat: "frame", ville: v, gamme: GAMME[v], name: v === "vegas" ? "Cadre animé Las Vegas" : `Cadre ${CITY_NAME[v]}`, price: { paris: 3000, cannes: 5000, monaco: 15000, dubai: 25000, vegas: 150000 }[v], img: CITY_FRAME_IMG[v] })),
  { id: "frame-dore", cat: "frame", ville: null, gamme: "Classique", name: "Cadre doré", price: 5000, img: "/shop/frames/cadre-or-1.webp" },
  { id: "frame-couronne-shop", cat: "frame", ville: null, gamme: "Rare", name: "Cadre couronne", price: 10000, img: "/shop/frames/cadre-roi-1.webp" },
  { id: "frame-etoile", cat: "frame", ville: null, gamme: "Prestige", name: "Cadre étoilé animé", price: 50000, img: "/shop/frames/cadre-or-2.webp" },
  // Effets de victoire.
  { id: "effect-confettis", cat: "effect", ville: null, gamme: "Classique", name: "Confettis tricolores", price: 3000 },
  { id: "effect-jetons", cat: "effect", ville: null, gamme: "Rare", name: "Pluie de jetons", price: 15000 },
  { id: "effect-feu", cat: "effect", ville: null, gamme: "Prestige", name: "Feu d’artifice doré", price: 60000 },
  // Réactions : un emoji à l'unité, puis deux packs groupés (le reste de la collection).
  { id: "emo-02", cat: "emoji", ville: null, gamme: "Classique", name: "Clin d’œil", price: 500, img: "/shop/emoji/emo-02.webp" },
  { id: "pack-bistrot", cat: "reaction", ville: null, gamme: "Classique", name: "Pack Bistrot", price: 2000, includes: [1, 3, 4, 6, 7, 8, 9, 10] },
  { id: "pack-champion", cat: "reaction", ville: null, gamme: "Rare", name: "Pack Champion", price: 12000, includes: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
].map((it, order) => {
  const c = SHOP_CATEGORIES.find((x) => x.id === it.cat);
  return { ...it, kind: c.kind, order, includes: it.includes ? it.includes.map((n) => `emo-${pad(n)}`) : undefined };
});
// Les emoji compris dans un pack « Réactions » (avec leur image, pour l'affichage).
export const packEmojis = (ids) => ids.map((id) => ({ id, name: EMOJI_NAMES[Number(id.slice(4)) - 1], img: `/shop/emoji/${id}.webp` }));
// Une collection par ville (tapis + dos + cadre) : complète, elle donne un titre (progression.js).
export const CITY_COLLECTION = Object.fromEntries(CITIES.map((v) => [v, [`felt-${v}`, `back-${v}`, `frame-v-${v}`]]));
export const isShopAvatar = (v) => typeof v === "string" && /^av-\d\d$/.test(v);
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
    // Objet offert avec un pack de jetons (ville) : attribué sans débit, jamais deux fois.
    grant(p, id) {
      if (!SHOP_ITEMS.some((x) => x.id === id)) throw Error("Article inconnu");
      owned(p)[id] = Date.now();
    },
    view(p) {
      const mine = owned(p);
      return {
        items: catalog()
          .filter((it) => !it.hidden || mine[it.id])
          .map(({ id, cat, kind, name, img, price, ville, gamme, includes }) => ({ id, cat, kind, name, img, price, ville, gamme, includes, owned: !!mine[id] })),
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
      // Pack de réactions : les emoji qu'il contient deviennent possédés d'un coup.
      if (it.kind === "reaction") for (const emoId of it.includes ?? []) owned(p)[emoId] = Date.now();
      return { item: it, balance: toCredits(economy.wallet(p).balance) };
    },
    // Offrir un objet à un ami : débite l'offreur, attribue l'objet à l'ami — jamais de jetons échangés.
    gift(p, friend, id, note) {
      const it = item(id);
      if (!it || it.hidden) fail("Article indisponible");
      if (!p.accountId) fail("Créez un compte pour offrir dans la boutique");
      if (!friend) fail("Ami introuvable");
      if (owned(friend)[id]) fail("Votre ami possède déjà cet article", { code: "owned" });
      const units = toUnits(it.price);
      const available = economy.available(p);
      if (available < units) fail(`Il vous manque ${toCredits(units - available)} jetons`, { code: "shopFunds", missing: toCredits(units - available), price: it.price });
      const entry = economy.post(p, `gift:${p.id}:${friend.id}:${id}`, "cadeau", -units, { label: `Cadeau pour ${friend.name} : ${it.name}`, item: id, to: friend.id });
      if (!entry) fail("Offre impossible");
      owned(friend)[id] = Date.now();
      return { item: it, balance: toCredits(economy.wallet(p).balance), note: String(note ?? "").trim().slice(0, 140) };
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
