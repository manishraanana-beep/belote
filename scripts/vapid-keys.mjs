// Génère une paire de clés VAPID pour les notifications push du navigateur.
// À copier dans les variables d'environnement du serveur (Railway), jamais dans le dépôt.
import { generateVapidKeys } from "../src/push.js";
const k = generateVapidKeys();
console.log(`BELOTE_VAPID_PUBLIC_KEY=${k.publicKey}\nBELOTE_VAPID_PRIVATE_KEY=${k.privateKey}\nBELOTE_VAPID_SUBJECT=mailto:votre-adresse@exemple.fr`);
