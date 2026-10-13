// Notifications push : Web Push (navigateurs, y compris iPhone/iPad en application installée
// depuis iOS 16.4) et Firebase Cloud Messaging (applications iOS et Android natives).
// Aucune clé n'est écrite dans le dépôt : tout vient des variables d'environnement.
import { createCipheriv, createECDH, createHmac, createPrivateKey, createSign, randomBytes, sign as signData } from "node:crypto";

const b64u = (b) => Buffer.from(b).toString("base64url");

export function pushConfig(env = process.env) {
  let fcm = null;
  try {
    if (env.FCM_SERVICE_ACCOUNT) fcm = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  } catch {
    console.error("FCM_SERVICE_ACCOUNT illisible : notifications natives désactivées");
  }
  return {
    vapidPublic: env.BELOTE_VAPID_PUBLIC_KEY || null,
    vapidPrivate: env.BELOTE_VAPID_PRIVATE_KEY || null,
    subject: env.BELOTE_VAPID_SUBJECT || "mailto:contact@example.com",
    fcm,
  };
}

// Paire de clés VAPID (P-256) à placer dans les variables d'environnement.
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function hkdf(salt, ikm, info, length) {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}
// Chiffrement « aes128gcm » (RFC 8291 / RFC 8188) d'un message pour un abonnement.
export function encryptPayload(subscription, payload) {
  const uaPublic = Buffer.from(subscription.keys.p256dh, "base64url");
  const auth = Buffer.from(subscription.keys.auth, "base64url");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}
function vapidHeader(endpoint, cfg) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: cfg.subject })}`;
  const pub = Buffer.from(cfg.vapidPublic, "base64url");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: cfg.vapidPrivate, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const sig = signData("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${cfg.vapidPublic}`;
}
// Renvoie "gone" quand l'abonnement n'existe plus (à supprimer), true si accepté.
export async function sendWebPush(subscription, message, cfg, fetchImpl = fetch) {
  if (!cfg.vapidPublic || !cfg.vapidPrivate) return false;
  const r = await fetchImpl(subscription.endpoint, {
    method: "POST",
    headers: { TTL: "3600", Urgency: "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: vapidHeader(subscription.endpoint, cfg) },
    body: encryptPayload(subscription, JSON.stringify(message)),
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404 || r.status === 410) return "gone";
  return r.ok;
}

// ———————————————————————— Firebase Cloud Messaging (applications natives)
let fcmToken = null;
async function fcmAccessToken(sa, fetchImpl) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw Error("Firebase indisponible");
  const d = await r.json();
  fcmToken = { value: d.access_token, exp: Date.now() + (d.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}
export async function sendFcm(token, message, cfg, fetchImpl = fetch) {
  if (!cfg.fcm) return false;
  const access = await fcmAccessToken(cfg.fcm, fetchImpl);
  const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.fcm.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { url: message.url ?? "/", tag: message.tag ?? "" },
        android: { priority: "high", notification: { tag: message.tag ?? undefined } },
        apns: { payload: { aps: { sound: "default", "thread-id": message.tag ?? "contree" } } },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404 || r.status === 400) return "gone";
  return r.ok;
}
