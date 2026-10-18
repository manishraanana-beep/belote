// Application iPhone simulée : l'interface du site avec de faux plugins natifs (Capacitor).
// Vérifie que l'app passe par l'achat intégré, les notifications natives et la reprise d'un achat
// interrompu, sans jamais proposer le paiement web.
import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { X509Certificate, createPrivateKey, sign } from "node:crypto";

const fx = JSON.parse(readFileSync(new URL("../test/fixtures/stores-test.json", import.meta.url)));
const PORT = 3111;
const base = `http://127.0.0.1:${PORT}`;
let server;

function appleJws(transactionId, productId = "credits_3000") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", x5c: fx.x5c });
  const body = b64({ bundleId: "com.beloteprestige.app", productId, transactionId, environment: "Production" });
  return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(fx.leafKey), dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

test.beforeAll(async () => {
  server = spawn("node", ["src/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      BELOTE_DATA_DIR: "/tmp/belote-natif-" + Date.now(),
      BELOTE_PURCHASES: "on",
      APPLE_IAP_BUNDLE_ID: "com.beloteprestige.app",
      APPLE_ROOT_CA_SHA256: new X509Certificate(Buffer.from(fx.x5c[2], "base64")).fingerprint256,
      BELOTE_SIGNUP_BONUS: "0",
      BELOTE_LOGIN_BONUS: "0",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("serveur non démarré");
});
test.afterAll(() => server?.kill());

// Faux Capacitor : mêmes noms et réponses que les vrais plugins.
async function fakeIphone(page, { purchaseJws, unfinishedJws }) {
  await page.addInitScript(
    ({ purchaseJws, unfinishedJws }) => {
      const calls = (window.__native = []);
      const log = (name, args) => calls.push([name, args]);
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
        Plugins: {
          NativePurchases: {
            configure: async (o) => log("configure", o),
            addListener: async () => ({ remove() {} }),
            getProducts: async (o) => ({ products: o.productIdentifiers.map((id) => ({ identifier: id, priceString: "2,99 € (App Store)" })) }),
            purchaseProduct: async (o) => (log("purchase", o), { transactionId: "4200", productIdentifier: o.productIdentifier, jwsRepresentation: purchaseJws }),
            finishTransaction: async (o) => log("finish", o),
            getUnfinishedTransactions: async () => ({ transactions: unfinishedJws ? [{ transactionId: "4100", jwsRepresentation: unfinishedJws }] : [] }),
          },
          FirebaseMessaging: {
            requestPermissions: async () => ({ receive: "granted" }),
            getToken: async () => ({ token: "jeton-fcm-iphone-de-test" }),
            addListener: async () => ({ remove() {} }),
          },
          SocialLogin: { initialize: async () => {}, login: async () => ({ result: {} }) },
        },
      };
    },
    { purchaseJws, unfinishedJws },
  );
}

test("app iPhone : achat intégré vérifié, achat interrompu repris, notifications natives", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await fakeIphone(page, { purchaseJws: appleJws("4200"), unfinishedJws: appleJws("4100", "credits_1000") });
  await page.goto(base + "/");
  // Compte requis pour acheter.
  await page.evaluate(async (email) => {
    await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "motdepasse" }) });
  }, `natif-${Date.now()}@exemple.fr`);
  await page.reload();
  const balance = page.locator(".shop-balance .sb-main b").first();
  // Au lancement : l'achat payé mais pas encore crédité (coupure réseau) est repris, crédité puis terminé.
  await expect.poll(() => page.evaluate(() => window.__native.filter(([n]) => n === "finish").map(([, a]) => a.transactionId))).toEqual(["4100"]);
  await expect(balance).toContainText("1 000");
  // Boutique de crédits : prix affichés par l'App Store, aucune mention du paiement web.
  await page.locator('.shop-balance [data-action="shop"]').first().click();
  await expect(page.locator(".packs")).toContainText("2,99 € (App Store)");
  await expect(page.locator("#modal")).toContainText("Paiement par l’App Store");
  await expect(page.locator("#modal")).not.toContainText("sur le site");
  await page.screenshot({ path: "test-results/screens/natif-boutique.png" });
  await page.locator('[data-action="buy"][data-pack="credits_3000"]').click();
  await expect(page.locator("#toast")).toContainText("Crédits ajoutés");
  await expect(balance).toContainText("4 000");
  const calls = await page.evaluate(() => window.__native);
  expect(calls.find(([n]) => n === "configure")[1]).toEqual({ autoFinishTransactions: false });
  expect(calls.find(([n]) => n === "purchase")[1]).toMatchObject({ productIdentifier: "credits_3000", isConsumable: false, autoAcknowledgePurchases: false });
  expect(calls.filter(([n]) => n === "finish").map(([, a]) => a.transactionId)).toEqual(["4100", "4200"]);
  // Relancer l'app ne recrédite rien (transaction déjà terminée et déjà enregistrée).
  await page.reload();
  await expect(balance).toContainText("4 000");
  // Notifications natives : permission, jeton Firebase envoyé et accepté par le serveur.
  expect(await page.evaluate(() => import("/native.js").then((m) => m.enablePush()))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("pushNative"))).toBe("on");
});
