// Vérification serveur des achats de crédits, selon la plateforme.
// Aucun achat n'est jamais crédité sur la seule parole du client.
//  - Site web  : Stripe Checkout + webhook signé.
//  - iOS       : StoreKit 2, transaction signée (JWS) vérifiée avec la chaîne de certificats Apple.
//  - Android   : Google Play Billing, jeton vérifié auprès de l'API Google Play Developer.
import { X509Certificate, createSign, createVerify } from "node:crypto";
import { verifyStripeSignature } from "./economy.js";

function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString());

// ———————————————————————— Stripe (web)
export async function stripeCheckout({ env, pack, player, origin, fetchImpl = fetch }) {
  if (!pack.priceCents) fail("Prix du pack non configuré");
  const body = new URLSearchParams({
    mode: "payment",
    client_reference_id: player.id,
    "metadata[pack]": pack.id,
    "metadata[player]": player.id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": env.STRIPE_CURRENCY || "eur",
    "line_items[0][price_data][unit_amount]": String(pack.priceCents),
    "line_items[0][price_data][product_data][name]": `${pack.credits} crédits Maison Belote`,
    success_url: `${origin}/#shop-ok`,
    cancel_url: `${origin}/#shop-cancel`,
  });
  const r = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const d = await r.json();
  if (!r.ok) fail("Paiement indisponible", 502);
  return d.url;
}
export function stripeEvent(raw, signature, env) {
  if (!verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET)) fail("Signature invalide", 401);
  const ev = JSON.parse(raw);
  if (ev.type !== "checkout.session.completed") return null;
  const s = ev.data.object;
  if (s.payment_status !== "paid") return null;
  return { provider: "stripe", transactionId: s.id, playerId: s.client_reference_id, packId: s.metadata?.pack };
}

// ———————————————————————— Apple (StoreKit 2)
// Empreinte SHA-256 de « Apple Root CA - G3 » (à confirmer et surchargeable par variable).
const APPLE_ROOT_G3 =
  "63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79";
export function verifyAppleTransaction(jws, env) {
  if (typeof jws !== "string" || jws.length > 20000) fail("Transaction invalide");
  const [h, p, s] = jws.split(".");
  if (!s) fail("Transaction invalide");
  const header = b64json(h);
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length < 3) fail("Transaction invalide");
  const chain = header.x5c.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  const root = chain.at(-1);
  if (root.fingerprint256 !== (env.APPLE_ROOT_CA_SHA256 || APPLE_ROOT_G3)) fail("Certificat Apple inconnu", 401);
  for (let i = 0; i < chain.length - 1; i++)
    if (!chain[i].verify(chain[i + 1].publicKey) || !chain[i].checkIssued(chain[i + 1])) fail("Chaîne de certificats invalide", 401);
  const ok = createVerify("sha256").update(`${h}.${p}`).verify({ key: chain[0].publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) fail("Signature Apple invalide", 401);
  const t = b64json(p);
  if (t.bundleId !== env.APPLE_IAP_BUNDLE_ID) fail("Application inconnue", 401);
  if (t.environment === "Sandbox" && env.APPLE_IAP_SANDBOX !== "on") fail("Achat de test refusé", 401);
  if (t.revocationDate) fail("Achat remboursé", 409);
  return { provider: "apple", transactionId: String(t.transactionId), packId: t.productId };
}

// ———————————————————————— Google Play
async function googleToken(sa, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) fail("Google Play indisponible", 502);
  return (await r.json()).access_token;
}
export async function verifyGooglePurchase({ productId, purchaseToken }, env, fetchImpl = fetch) {
  if (typeof productId !== "string" || typeof purchaseToken !== "string" || purchaseToken.length > 4096) fail("Achat invalide");
  const sa = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT);
  const token = await googleToken(sa, fetchImpl);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env.GOOGLE_PLAY_PACKAGE)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const r = await fetchImpl(base, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) fail("Achat introuvable chez Google Play", 402);
  const d = await r.json();
  if (d.purchaseState !== 0) fail("Paiement non finalisé", 402);
  // Consommation : le même jeton ne peut plus être racheté.
  if (d.consumptionState === 0) await fetchImpl(`${base}:consume`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  return { provider: "google", transactionId: d.orderId || purchaseToken, packId: productId };
}
