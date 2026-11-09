// Vérifie, avant de compiler, ce qui manque encore pour les versions App Store et Google Play.
// Usage : npm run check   (dans le dossier mobile/)
import { existsSync, readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const server = cfg.server?.url;
const rows = [];
const line = (ok, label, help = "") => rows.push(`${ok ? "✅" : "⚙️ "} ${label}${ok || !help ? "" : `\n     → ${help}`}`);

line(existsSync("ios/App/App/GoogleService-Info.plist"), "iOS : GoogleService-Info.plist (Firebase)", "Firebase › Paramètres du projet › app iOS › télécharger, puis le glisser dans Xcode (dossier App, cocher « Copy items »).");
line(existsSync("android/app/google-services.json"), "Android : google-services.json (Firebase)", "Firebase › Paramètres du projet › app Android › télécharger dans mobile/android/app/.");
const plist = readFileSync("ios/App/App/Info.plist", "utf8");
line(!plist.includes("REMPLACER-ID-CLIENT-IOS"), "iOS : schéma d'URL de la connexion Google", "Remplacer REMPLACER-ID-CLIENT-IOS dans ios/App/App/Info.plist par l'identifiant client iOS inversé (voir README).");
line(existsSync("android/keystore.properties"), "Android : clé de signature (keystore.properties)", "Créer la clé d'envoi Google Play (voir README, étape Android).");
line(cfg.appId !== "com.example.app", `Identifiant de l'application : ${cfg.appId}`);

if (server) {
  try {
    const shop = await (await fetch(server + "/api/shop/config")).json();
    const auth = await (await fetch(server + "/api/auth/config")).json();
    const push = await (await fetch(server + "/api/push/config")).json();
    line(shop.purchases, "Serveur : achats ouverts (BELOTE_PURCHASES=on)", "Ne l'activer qu'après validation juridique et tests en bac à sable.");
    line(shop.apple, "Serveur : achats App Store configurés (APPLE_IAP_BUNDLE_ID)", "Variable Railway APPLE_IAP_BUNDLE_ID = identifiant de l'app.");
    line(shop.google, "Serveur : achats Google Play configurés (GOOGLE_PLAY_PACKAGE, GOOGLE_PLAY_SERVICE_ACCOUNT)");
    line(push.native, "Serveur : notifications natives (FCM_SERVICE_ACCOUNT)");
    line(!!auth.apple, "Serveur : connexion Apple (APPLE_CLIENT_ID)");
    line(!!auth.google, "Serveur : connexion Google (GOOGLE_CLIENT_ID)");
    line(!!auth.googleIos, "Serveur : connexion Google sur iPhone (GOOGLE_IOS_CLIENT_ID)");
    line(auth.mail, "Serveur : envoi des e-mails (RESEND_API_KEY, BELOTE_MAIL_FROM)");
    for (const p of ["/confidentialite.html", "/suppression-compte.html"]) line((await fetch(server + p)).ok, `Page publique ${server}${p}`);
  } catch (e) {
    line(false, `Serveur ${server} injoignable`, e.message);
  }
}
console.log(rows.join("\n"));
