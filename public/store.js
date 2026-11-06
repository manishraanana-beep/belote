// État partagé de l'application, importé par app.js et ui.js (et par les modules à venir : admin, boutique…).
// Une liaison importée est en lecture seule : toute affectation passe par un setter (`setState`, `setPage`…).
export let state = null; // dernier état reçu du serveur (profil, table, tables, tournois…)
export const setState = (v) => (state = v);
export let ws = null; // connexion WebSocket
export const setWs = (v) => (ws = v);
export let page = { name: null, params: {} }; // page affichée hors partie
export const setPage = (v) => (page = v);
export let authConfig = { google: null, apple: null, mail: false };
export const setAuthConfig = (v) => (authConfig = v);
export let shopConfig = null;
export const setShopConfig = (v) => (shopConfig = v);
export let sound = localStorage.getItem("beloteSound") !== "false";
export const setSound = (v) => (sound = v);
export let vibra = (() => {
  try {
    return localStorage.getItem("beloteVibra") !== "false";
  } catch {
    return true;
  }
})();
export const setVibra = (v) => (vibra = v);
export const pendingAcks = {}; // rappels des commandes `ask`, par identifiant
