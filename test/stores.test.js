// Achats intégrés (App Store, Google Play) et notifications natives (Firebase) :
// vérifiés sans compte développeur grâce à une chaîne de certificats factice et à des réponses simulées.
import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyAppleTransaction, verifyGooglePurchase } from "../src/purchases.js";
import { sendFcm } from "../src/push.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/stores-test.json", import.meta.url)));
const rootSha = new X509Certificate(Buffer.from(fx.x5c[2], "base64")).fingerprint256;
const env = { APPLE_IAP_BUNDLE_ID: "com.beloteprestige.app", APPLE_ROOT_CA_SHA256: rootSha };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function appleJws(claims, { x5c = fx.x5c, key = fx.leafKey } = {}) {
  const head = b64({ alg: "ES256", x5c });
  const body = b64({ bundleId: "com.beloteprestige.app", productId: "credits-5000", transactionId: "2000000123", environment: "Production", type: "Consumable", ...claims });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(key), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

test("App Store : transaction signée acceptée, contrôles de sécurité", () => {
  assert.deepEqual(verifyAppleTransaction(appleJws({}), env), { provider: "apple", transactionId: "2000000123", packId: "credits-5000" });
  // Autre application, achat remboursé, achat de test hors bac à sable autorisé.
  assert.throws(() => verifyAppleTransaction(appleJws({ bundleId: "com.autre.app" }), env), /Application inconnue/);
  assert.throws(() => verifyAppleTransaction(appleJws({ revocationDate: 1 }), env), /remboursé/);
  assert.throws(() => verifyAppleTransaction(appleJws({ environment: "Sandbox" }), env), /test refusé/);
  assert.ok(verifyAppleTransaction(appleJws({ environment: "Sandbox" }), { ...env, APPLE_IAP_SANDBOX: "on" }));
  // Racine inconnue (la vraie racine Apple est exigée par défaut), signature falsifiée, chaîne incomplète.
  assert.throws(() => verifyAppleTransaction(appleJws({}), { APPLE_IAP_BUNDLE_ID: env.APPLE_IAP_BUNDLE_ID }), /Certificat Apple inconnu/);
  const jws = appleJws({});
  const forged = jws.split(".");
  forged[1] = b64({ bundleId: "com.beloteprestige.app", productId: "credits-50000", transactionId: "2000000123" });
  assert.throws(() => verifyAppleTransaction(forged.join("."), env), /Signature Apple invalide/);
  assert.throws(() => verifyAppleTransaction(appleJws({}, { x5c: fx.x5c.slice(0, 2) }), env), /Transaction invalide/);
  assert.throws(() => verifyAppleTransaction(appleJws({}, { x5c: [fx.x5c[0], fx.x5c[0], fx.x5c[2]] }), env), /Chaîne de certificats invalide/);
});

const sa = { client_email: "play@test.iam.gserviceaccount.com", private_key: fx.serviceAccountKey, project_id: "belote-test" };
function googleApi(purchase) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? "GET" });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "jeton", expires_in: 3600 }));
    if (String(url).endsWith(":consume")) return new Response("{}");
    if (String(url).startsWith("https://fcm.googleapis.com/")) return new Response("{}", { status: purchase.fcmStatus ?? 200 });
    return purchase.missing ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(purchase));
  };
  return { calls, fetchImpl };
}
const genv = { GOOGLE_PLAY_PACKAGE: "com.beloteprestige.app", GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(sa) };

test("Google Play : achat payé vérifié puis consommé, refus sinon", async () => {
  const ok = googleApi({ purchaseState: 0, consumptionState: 0, orderId: "GPA.1234" });
  const r = await verifyGooglePurchase({ productId: "credits-5000", purchaseToken: "tok-abc" }, genv, ok.fetchImpl);
  assert.deepEqual(r, { provider: "google", transactionId: "GPA.1234", packId: "credits-5000" });
  assert.ok(ok.calls.some((c) => c.url.includes("/applications/com.beloteprestige.app/purchases/products/credits-5000/tokens/tok-abc") && c.method === "GET"));
  assert.ok(ok.calls.some((c) => c.url.endsWith(":consume") && c.method === "POST"), "achat consommé (rachetable)");
  // Déjà consommé (reprise après coupure) : pas de nouvelle consommation, même identifiant de transaction.
  const again = googleApi({ purchaseState: 0, consumptionState: 1, orderId: "GPA.1234" });
  assert.equal((await verifyGooglePurchase({ productId: "credits-5000", purchaseToken: "tok-abc" }, genv, again.fetchImpl)).transactionId, "GPA.1234");
  assert.ok(!again.calls.some((c) => c.url.endsWith(":consume")));
  await assert.rejects(verifyGooglePurchase({ productId: "credits-5000", purchaseToken: "t" }, genv, googleApi({ purchaseState: 2 }).fetchImpl), /non finalisé/);
  await assert.rejects(verifyGooglePurchase({ productId: "credits-5000", purchaseToken: "t" }, genv, googleApi({ missing: true }).fetchImpl), /introuvable/);
  await assert.rejects(verifyGooglePurchase({ productId: "credits-5000" }, genv, ok.fetchImpl), /Achat invalide/);
});

test("Firebase : notification envoyée au bon appareil, jeton périmé signalé", async () => {
  const cfg = { fcm: sa };
  const ok = googleApi({});
  assert.equal(await sendFcm("jeton-appareil", { title: "Tournoi", body: "Départ dans 1 h", url: "/#tour", tag: "t1" }, cfg, ok.fetchImpl), true);
  assert.ok(ok.calls.some((c) => c.url === "https://fcm.googleapis.com/v1/projects/belote-test/messages:send" && c.method === "POST"));
  assert.equal(await sendFcm("jeton-perime", { title: "x", body: "y" }, cfg, googleApi({ fcmStatus: 404 }).fetchImpl), "gone");
  assert.equal(await sendFcm("jeton", { title: "x", body: "y" }, { fcm: null }, ok.fetchImpl), false);
});
