import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { encryptPayload, generateVapidKeys, sendWebPush } from "../src/push.js";

const hkdf = (salt, ikm, info, n) => createHmac("sha256", createHmac("sha256", salt).update(ikm).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);

test("Web Push : message chiffré (RFC 8291) lisible uniquement par le navigateur abonné", () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const sub = { endpoint: "https://push.exemple/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
  const body = encryptPayload(sub, JSON.stringify({ title: "Votre table est prête, rejoignez la partie !" }));
  // Déchiffrement côté navigateur.
  const salt = body.subarray(0, 16);
  const keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen);
  const secret = ua.computeSecret(asPublic);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const data = body.subarray(21 + keyLen);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain.at(-1), 2);
  assert.equal(JSON.parse(plain.subarray(0, -1)).title, "Votre table est prête, rejoignez la partie !");
});

test("Web Push : en-tête VAPID signé, abonnement expiré signalé", async () => {
  const keys = generateVapidKeys();
  const cfg = { vapidPublic: keys.publicKey, vapidPrivate: keys.privateKey, subject: "mailto:test@exemple.fr" };
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const sub = { endpoint: "https://push.exemple/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
  let seen;
  const ok = await sendWebPush(sub, { title: "x" }, cfg, async (url, init) => {
    seen = init.headers.Authorization;
    return { status: 201, ok: true };
  });
  assert.equal(ok, true);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(seen);
  assert.equal(k, keys.publicKey);
  const [h, p, sig] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(p, "base64url")).aud, "https://push.exemple");
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  assert.equal(await sendWebPush(sub, { title: "x" }, cfg, async () => ({ status: 410, ok: false })), "gone");
  assert.equal(await sendWebPush(sub, { title: "x" }, { vapidPublic: null }, async () => assert.fail()), false);
});
