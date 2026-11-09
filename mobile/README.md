# Belote Prestige — applications iPhone et Android

Ce dossier contient les applications **iOS** et **Android** de Belote Prestige, construites avec
[Capacitor](https://capacitorjs.com). Rien n’est publié : tout ce qui suit se fait sur votre Mac et
dans vos comptes développeur, quand vous le décidez.

## Principe

```
App iPhone  (Xcode)          ─┐
App Android (Android Studio) ─┼──►  https://appi-belote.up.railway.app  (même serveur, même interface)
Site web    (navigateur)     ─┘
```

- L’application affiche **exactement** l’interface du site (mêmes fichiers `public/`), chargée depuis le
  serveur Railway : graphisme, règles, comptes, crédits et parties sont partagés. Une correction
  déployée sur Railway arrive aussitôt dans les applications, sans nouvelle version sur les stores.
- Seules trois fonctions passent par le téléphone, parce que les stores l’imposent (`public/native.js`) :
  1. **Achat de jetons** : achat intégré App Store / Google Play (le paiement web est masqué dans les apps).
  2. **Notifications** : Firebase Cloud Messaging (iPhone et Android).
  3. **Connexion Apple / Google** : fenêtres natives (Google refuse sa fenêtre web dans une application).
- Sans réseau, l’app affiche un écran « Pas de connexion » aux couleurs du jeu (`www/hors-ligne.html`).

## Ce qui est prêt / ce qui demande une configuration

| Élément | État |
|---|---|
| Projets Xcode (`ios/`) et Android Studio (`android/`) générés, nom « Belote Prestige », identifiant `com.beloteprestige.app` | ✅ prêt |
| Icône et écrans de démarrage (iPhone, iPad, Android) aux couleurs du jeu | ✅ prêt — ⚠️ icône agrandie depuis 512 px : demander au graphiste une icône **1024 × 1024** nette, puis `npm run assets` |
| Orientation portrait + paysage, encoche et barre système gérées | ✅ prêt (iOS 16 minimum, Android 7 minimum) |
| Achat intégré : achat, vérification par le serveur, crédit unique, reprise d’un achat interrompu au relancement | ✅ code prêt et testé (simulation) — ⚙️ produits à créer dans les stores + variables Railway |
| Vérification serveur App Store (signature Apple) et Google Play (API Google, consommation) | ✅ code prêt et testé avec des certificats et réponses simulés — ⚙️ à valider en bac à sable |
| Notifications natives (tournois, invitations) | ✅ code prêt — ⚙️ projet Firebase + clé APNs + `FCM_SERVICE_ACCOUNT` |
| Connexion Apple (iPhone) et Google (iPhone, Android) | ✅ code prêt — ⚙️ identifiants Apple / Google à créer |
| Suppression du compte dans l’app (Compte › Supprimer mon compte) | ✅ prêt (exigé par Apple et Google) |
| Page publique de suppression de compte : `/suppression-compte.html` | ✅ prêt — ⚙️ ajouter votre adresse de contact |
| Politique de confidentialité : `/confidentialite.html` | ✅ prêt — ⚙️ ajouter nom de l’éditeur et adresse de contact |
| Droits iOS : notifications, Sign in with Apple, manifeste de confidentialité, déclaration de chiffrement | ✅ prêt |
| Signature Android pour Google Play | ⚙️ clé à créer (commande ci-dessous) |
| Avis juridique sur les mises en crédits achetés (ANJ) | ❗ à obtenir avant d’ouvrir les achats (voir `docs/CREDITS-ET-STORES.md`) |

Vérification automatique à tout moment : `cd mobile && npm run check`.

---

## 1. Préparer le Mac (une fois)

1. **Xcode** (App Store du Mac), puis l’ouvrir une fois pour installer les composants.
2. **Android Studio** (developer.android.com/studio) : à la première ouverture, laisser installer le SDK.
3. **Node 22** : `brew install node@22` (ou nodejs.org).
4. Récupérer le projet et installer :
   ```bash
   git clone https://github.com/manishraanana-beep/belote.git
   cd belote/mobile
   npm ci
   npx cap sync
   ```

## 2. Choix à faire avant tout envoi

- **Identifiant de l’application** : `com.beloteprestige.app` (définitif après le premier envoi dans un
  store). Pour en changer : `capacitor.config.json` (`appId`), Xcode (Bundle Identifier) et
  `android/app/build.gradle` (`applicationId`, `namespace`), avant toute création dans les consoles.
- **Compte développeur** : individuel ou société. Pour une société, prévoir le numéro D-U-N-S (gratuit,
  quelques jours). Le nom du vendeur apparaît sur la fiche du store.

## 3. Firebase (notifications)

1. console.firebase.google.com › Créer un projet « Belote Prestige » (Analytics inutile).
2. Ajouter une app **iOS** (identifiant `com.beloteprestige.app`) › télécharger `GoogleService-Info.plist`
   › dans Xcode, le glisser dans le dossier **App** (cocher « Copy items if needed » et la cible App).
3. Ajouter une app **Android** (package `com.beloteprestige.app`) › télécharger `google-services.json`
   dans `mobile/android/app/`.
4. Paramètres du projet › Comptes de service › **Générer une nouvelle clé privée** (fichier JSON) :
   son contenu complet va dans la variable Railway `FCM_SERVICE_ACCOUNT`.
5. Paramètres du projet › Cloud Messaging › **Configuration de l’app Apple** : envoyer la clé APNs (`.p8`)
   créée à l’étape 4.3 ci-dessous (Key ID + Team ID).

Ces deux fichiers Firebase ne sont jamais mis dans le dépôt (déjà exclus).

## 4. Apple (App Store)

1. **Adhésion** : developer.apple.com/programs (99 $/an).
2. **Identifiant** : Certificates, IDs & Profiles › Identifiers › App IDs › `com.beloteprestige.app`, cocher
   **Push Notifications**, **Sign in with Apple** et **In-App Purchase**.
3. **Clé APNs** : Keys › « + » › Apple Push Notifications service › télécharger le `.p8` (une seule fois)
   › l’envoyer à Firebase (étape 3.5).
4. **App Store Connect** (appstoreconnect.apple.com) :
   - Accords, taxes et banque : signer l’accord **Applications payantes**, renseigner banque et fiscalité
     (sans cela, aucun achat intégré ne fonctionne).
   - Mes apps › « + » › Nouvelle app : nom « Belote Prestige », langue français, identifiant ci-dessus.
   - Fonctionnalités › **Achats intégrés** › créer 4 produits **Consommables** avec exactement les
     identifiants des packs du serveur :

     | Identifiant produit | Crédits | Prix conseillé |
     |---|---|---|
     | `credits_1000` | 1 000 | 0,99 € |
     | `credits_3000` | 3 000 | 2,49 € |
     | `credits_8000` | 8 000 | 4,99 € |
     | `credits_20000` | 20 000 | 9,99 € |

     (nom affiché, description, capture d’écran de la boutique pour la vérification Apple).
   - Utilisateurs et accès › **Testeurs Sandbox** : créer un compte de test (adresse jamais utilisée chez Apple).
5. **Xcode** : `cd mobile && npx cap open ios`
   - Cible **App** › Signing & Capabilities › Team = votre compte (signature automatique). Les capacités
     Push Notifications et Sign in with Apple sont déjà déclarées (`App.entitlements`) ; ajouter
     **In-App Purchase** avec le bouton « + Capability ».
   - Brancher l’iPhone en USB, le choisir en haut, ▶︎ : l’app s’installe (activer le mode développeur
     sur l’iPhone si demandé).
   - Envoi : Product › Archive › Distribute App › App Store Connect › Upload. La version apparaît dans
     **TestFlight** (test sur vos téléphones et ceux de vos testeurs, sans publication).

## 5. Google (Google Play)

1. **Compte** : play.google.com/console (25 $ une fois, vérification d’identité).
   ⚠️ Compte **personnel** récent : Google exige un **test fermé avec au moins 12 testeurs pendant
   14 jours** avant de pouvoir publier en production. Un compte société n’a pas cette obligation.
2. **Clé de signature** (sur le Mac, à garder précieusement avec ses mots de passe) :
   ```bash
   cd mobile/android
   keytool -genkey -v -keystore belote-upload.jks -alias belote -keyalg RSA -keysize 2048 -validity 10000
   ```
   puis créer `mobile/android/keystore.properties` (jamais publié, déjà exclu du dépôt) :
   ```
   storeFile=../belote-upload.jks
   storePassword=…
   keyAlias=belote
   keyPassword=…
   ```
3. **Android Studio** : `cd mobile && npx cap open android`
   - Test sur téléphone : activer le mode développeur et le débogage USB sur le téléphone, le brancher, ▶︎.
   - Version pour le store : Build › Generate Signed App Bundle › fichier `.aab`.
4. **Play Console** › Créer l’application « Belote Prestige » (jeu, gratuit) :
   - Tests › **Test interne** : envoyer le `.aab` (installation sur vos téléphones par lien, sans publication).
   - Monétiser › Produits › **Produits intégrés** : créer `credits_1000`, `credits_3000`, `credits_8000`,
     `credits_20000` (mêmes identifiants qu’Apple), actifs.
   - Paramètres › **Test de licence** : ajouter vos adresses Gmail de test (achats sans débit réel).
   - Configuration › Accès API : lier un projet Google Cloud, créer un **compte de service**, l’inviter dans
     la Play Console avec le droit « Gérer les commandes et abonnements » ; son fichier JSON va dans
     la variable Railway `GOOGLE_PLAY_SERVICE_ACCOUNT`.
   - Intégrité de l’app › **Signature d’application** : noter l’empreinte SHA-1 (pour la connexion Google).

## 6. Connexion Apple et Google

- **Google** (console.cloud.google.com › API et services › Identifiants, même projet que Firebase) :
  - client **Web** : son identifiant va dans `GOOGLE_CLIENT_ID` (déjà prévu pour le site) ;
  - client **iOS** (bundle `com.beloteprestige.app`) : identifiant dans `GOOGLE_IOS_CLIENT_ID`, et son
    « schéma d’URL iOS » (`com.googleusercontent.apps.…`) remplace `REMPLACER-ID-CLIENT-IOS` dans
    `ios/App/App/Info.plist` ;
  - client **Android** : package `com.beloteprestige.app` + empreintes SHA-1 (debug : `cd android && ./gradlew signingReport`,
    clé d’envoi, et clé de signature Play de l’étape 5.4). Rien à copier ailleurs.
- **Apple** : ajouter l’identifiant de l’app à `APPLE_CLIENT_ID` (séparé par une virgule du Service ID
  du site s’il existe), par exemple `com.beloteprestige.app`. Sur Android, le bouton Apple est masqué.

## 7. Variables à ajouter sur Railway (service « belote »)

| Variable | Valeur |
|---|---|
| `APPLE_IAP_BUNDLE_ID` | `com.beloteprestige.app` |
| `APPLE_IAP_SANDBOX` | `on` pendant les tests TestFlight (achats de test acceptés), à retirer ensuite |
| `GOOGLE_PLAY_PACKAGE` | `com.beloteprestige.app` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | contenu du JSON du compte de service Play |
| `FCM_SERVICE_ACCOUNT` | contenu du JSON du compte de service Firebase |
| `GOOGLE_CLIENT_ID` | client Web Google |
| `GOOGLE_IOS_CLIENT_ID` | client iOS Google |
| `APPLE_CLIENT_ID` | `com.beloteprestige.app` (+ Service ID web éventuel) |
| `BELOTE_PURCHASES` | `on` **seulement** après l’avis juridique et les tests en bac à sable |

Aucune de ces valeurs ne doit être écrite dans le dépôt.

Contrôle de la racine Apple (une ligne sur le Mac, le résultat doit être identique à l’empreinte écrite
dans `src/purchases.js`) :
```bash
curl -s https://www.apple.com/certificateauthority/AppleRootCA-G3.cer | openssl x509 -inform der -noout -fingerprint -sha256
```

## 8. Tests sur de vrais téléphones (avant toute publication)

Sur un iPhone (TestFlight) et un Android (test interne) :

- [ ] Ouverture, écran de démarrage, accueil identique au site ; portrait et paysage ; encoche.
- [ ] Mode avion : écran « Pas de connexion », puis « Réessayer ».
- [ ] Inscription e-mail, connexion, déconnexion ; connexion Apple (iPhone) et Google (les deux).
- [ ] Partie complète « Jouer maintenant », revanche ; app mise en arrière-plan puis reprise en partie.
- [ ] Notifications : accepter, s’inscrire à un tournoi, recevoir le rappel app fermée, toucher la
      notification → ouvre le tournoi.
- [ ] Achat de chaque pack avec le compte Sandbox / testeur de licence : crédits ajoutés une seule fois ;
      couper le réseau juste après avoir payé, relancer l’app : l’achat est crédité (« Achat précédent crédité »).
- [ ] Boutique : aucun lien vers un paiement web dans l’app.
- [ ] Compte › Supprimer mon compte : compte effacé, reconnexion impossible.

## 9. Fiches des stores

- Textes (titre, sous-titre, description), mots-clés, catégorie **Jeux › Cartes**.
- Captures : iPhone 6,9" (1320 × 2868) et 6,5", iPad 13" si iPad est conservé ; Android téléphone.
- URL de confidentialité : `https://appi-belote.up.railway.app/confidentialite.html`
- URL de suppression de compte (Google) : `https://appi-belote.up.railway.app/suppression-compte.html`
- Âge : questionnaires Apple et IARC (Google) — déclarer **jeu d’argent simulé** (mises en crédits
  sans valeur réelle) ; public cible **18 ans et plus**.
- Confidentialité Apple / Sécurité des données Google : e-mail, nom (pseudo), identifiant, photos (avatar
  facultatif), historique d’achats, contenu de jeu, identifiant d’appareil (notifications) ; aucune
  publicité, aucun suivi, aucune vente de données ; suppression possible.
- Compte de démonstration pour les vérificateurs Apple / Google (e-mail + mot de passe avec des crédits).

## Points de vigilance

1. **Application chargée depuis le serveur** : c’est ce qui garantit un graphisme identique et des mises à
   jour immédiates. Apple refuse les apps qui ne sont qu’un site « emballé » (règle 4.2) ; Belote Prestige
   apporte des fonctions natives (achat intégré, notifications, connexion Apple, mode hors ligne), ce qui
   est généralement accepté pour un jeu en ligne. En cas de refus, l’alternative est d’embarquer
   l’interface dans l’app (demande une adaptation des sessions côté serveur).
2. **Avis juridique** avant `BELOTE_PURCHASES=on` (crédits achetés misés sur des parties).
3. **Révocation Sign in with Apple** : Apple recommande de révoquer le jeton Apple à la suppression du
   compte (API REST d’Apple, clé `.p8`). Non indispensable pour la première soumission, prévu en amélioration.
4. Garder la clé `belote-upload.jks` et ses mots de passe en lieu sûr (sauvegarde).
