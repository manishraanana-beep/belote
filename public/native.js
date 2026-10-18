// Pont vers les fonctions natives des applications iOS et Android (Capacitor).
// Dans un navigateur, rien ne change : toutes les fonctions répondent « non disponible ».
// L'interface, le graphisme et les règles restent ceux du site : seules les fonctions
// imposées par les stores (achat intégré, notifications, connexion Apple/Google) passent ici.

const C = globalThis.Capacitor;
export const isNative = !!C?.isNativePlatform?.();
export const platform = isNative ? C.getPlatform() : "web"; // "ios" | "android" | "web"
const plugin = (name) => (isNative ? C.Plugins?.[name] : null);

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(d.error ?? "Erreur réseau"), { status: r.status });
  return d;
}

// ———————————————— achats intégrés (App Store / Google Play)
// Le serveur vérifie chaque achat auprès d'Apple ou de Google avant de créditer, une seule fois
// par transaction. La transaction n'est terminée côté store qu'après ce crédit : un achat
// interrompu (réseau, appli fermée) est repris au lancement suivant, jamais perdu ni doublé.
const Purchases = () => plugin("NativePurchases");
let storeReady = null;
function storeSetup() {
  const P = Purchases();
  if (!P) return Promise.resolve(false);
  storeReady ??= (async () => {
    await P.configure?.({ autoFinishTransactions: false }).catch(() => {});
    if (platform === "ios")
      P.addListener("transactionUpdated", (t) => deliver(t).catch((e) => console.warn("Achat en attente :", e.message)));
    return true;
  })();
  return storeReady;
}
// Envoie une transaction au serveur, puis la termine côté store.
async function deliver(t) {
  const P = Purchases();
  let result;
  if (platform === "ios") {
    if (!t?.jwsRepresentation) throw Error("Transaction App Store illisible");
    result = await post("/api/shop/apple", { signedTransaction: t.jwsRepresentation });
    await P.finishTransaction({ transactionId: String(t.transactionId) }).catch(() => {});
  } else {
    if (!t?.purchaseToken) throw Error("Achat Google Play illisible");
    if (t.purchaseState !== undefined && String(t.purchaseState) !== "1") throw Error("Paiement en attente de validation");
    // Le serveur consomme l'achat chez Google après l'avoir crédité (achat de crédits renouvelable).
    result = await post("/api/shop/google", { productId: t.productIdentifier, purchaseToken: t.purchaseToken });
  }
  return result;
}
// Prix affichés par le store (devise et taxes du pays de l'utilisateur).
export async function storePrices(ids) {
  if (!(await storeSetup()) || !ids.length) return {};
  try {
    const { products } = await Purchases().getProducts({ productIdentifiers: ids, productType: "inapp" });
    return Object.fromEntries((products ?? []).map((p) => [p.identifier, p.priceString]));
  } catch {
    return {};
  }
}
export async function buyCredits(packId) {
  if (!(await storeSetup())) throw Error("Achat intégré indisponible");
  const t = await Purchases().purchaseProduct({
    productIdentifier: packId,
    productType: "inapp",
    quantity: 1,
    isConsumable: false, // la consommation est faite par le serveur, après vérification
    autoAcknowledgePurchases: false,
  });
  return deliver(t);
}
// Au lancement (compte connecté) : achats payés mais pas encore crédités.
export async function recoverPurchases() {
  if (!(await storeSetup())) return 0;
  const P = Purchases();
  let list = [];
  try {
    if (platform === "ios") list = (await P.getUnfinishedTransactions()).transactions ?? [];
    else list = ((await P.getPurchases({ productType: "inapp" })).purchases ?? []).filter((t) => String(t.purchaseState) === "1");
  } catch {
    return 0;
  }
  let n = 0;
  for (const t of list) {
    try {
      if ((await deliver(t))?.credited) n++;
    } catch (e) {
      console.warn("Achat non repris :", e.message);
    }
  }
  return n;
}

// ———————————————— notifications (Firebase Cloud Messaging, iOS et Android)
const Messaging = () => plugin("FirebaseMessaging");
export const pushAvailable = () => !!Messaging();
export const pushEnabled = () => localStorage.getItem("pushNative") === "on";
let pushWired = false;
export async function enablePush() {
  const M = Messaging();
  if (!M) return false;
  const perm = await M.requestPermissions();
  if (perm.receive !== "granted") return false;
  if (platform === "android") await M.createChannel({ id: "belote", name: "Belote Prestige", description: "Tournois, invitations et tours de jeu", importance: 4 }).catch(() => {});
  const send = (token) => token && post("/api/push/subscribe", { type: "fcm", token, platform }).then(() => localStorage.setItem("pushNative", "on"));
  if (!pushWired) {
    pushWired = true;
    M.addListener("tokenReceived", (e) => send(e.token).catch(() => {}));
    M.addListener("notificationActionPerformed", (e) => {
      const url = e.notification?.data?.url;
      if (typeof url === "string" && url.startsWith("/")) location.href = url;
    });
  }
  const { token } = await M.getToken();
  await send(token);
  return true;
}

// ———————————————— connexion Apple / Google native
// Les fenêtres web de Google sont refusées dans une application : on passe par les SDK natifs.
// Le jeton d'identité obtenu est vérifié par le serveur (signature, émetteur, audience).
const Social = () => plugin("SocialLogin");
let socialReady = null;
export function socialAvailable(provider, cfg) {
  if (!Social()) return false;
  if (provider === "apple") return platform === "ios" && !!cfg.apple;
  if (provider === "google") return !!cfg.google && (platform === "android" || !!cfg.googleIos);
  return false;
}
export async function socialLogin(provider, cfg) {
  const S = Social();
  socialReady ??= S.initialize({
    ...(cfg.google ? { google: { webClientId: cfg.google, iOSClientId: cfg.googleIos ?? undefined, iOSServerClientId: cfg.google, mode: "online" } } : {}),
    ...(cfg.apple && platform === "ios" ? { apple: {} } : {}),
  });
  await socialReady;
  const r = await S.login({ provider, options: provider === "apple" ? { scopes: ["email", "name"] } : { scopes: ["email", "profile"] } });
  const idToken = r?.result?.idToken;
  if (!idToken) throw Error("Connexion annulée");
  return idToken;
}
