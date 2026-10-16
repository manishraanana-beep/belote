# Crédits virtuels, achats et exigences des stores

## Fonctionnement (implémenté)

- **Unité** : les montants sont stockés en demi-crédits entiers (`src/economy.js`), pour partager exactement une somme impaire.
- **Portefeuille** : solde, crédits engagés, disponible = solde − engagés. Commun au site et aux applications (il suit le compte).
- **Bonus** : crédits de bienvenue à la création du compte (une fois par adresse e-mail, même après suppression) et **bonus de connexion** (ci-dessous). Montants configurables.

### Bonus de connexion (remplace l'ancien bonus quotidien)

- **Montant** : 200 crédits par défaut (`BELOTE_LOGIN_BONUS`), modifiable à tout moment dans l'administration (« Bonus de connexion »). `0` le désactive.
- **Attribution** : immédiate à la première connexion d'un compte, puis à la première ouverture ou connexion survenant **au moins 24 h après la dernière attribution**. Aucun cumul des jours d'absence.
- **Un seul par compte et par période**, que le joueur utilise le site, l'iPhone ou Android, même connecté sur plusieurs appareils en même temps : le serveur vérifie et inscrit le bonus dans la même opération (pas de double attribution possible), avec **l'heure du serveur** (UTC), jamais celle du téléphone.
- **Joueur resté connecté** : l'application renvoie un « retour » au serveur quand elle redevient visible (changement d'onglet, appli réactivée) et quand le compte à rebours de l'accueil arrive à zéro ; l'éligibilité est revérifiée sans déconnexion.
- **Journal** : chaque bonus est une écriture « Bonus de connexion » de l'historique du portefeuille.
- **Partie en cours** : seul le solde augmente ; les crédits déjà engagés ne bougent pas, le bonus sert aux parties suivantes.
- **Affichage** : pluie de pièces « Bonus de connexion : +200 crédits ! », nouveau solde, compte à rebours avant le prochain bonus sur l'accueil et dans le portefeuille.
- Distinct du cadeau de bienvenue et des récompenses de défis.
- **Mises** : 100, 200, 500 ou 1 000 crédits par joueur, ou partie gratuite. Il faut au moins la mise *disponible* pour entrer.
- **Réservation au lancement** : `min(disponible, 3 × mise)` par joueur, figée pour la partie. Un achat ou un bonus reçu ensuite ne change rien.
- **Règlement** (une seule fois, clé `settle:<partie>:<joueur>`) :
  - rubicon si le score gagnant est **strictement** supérieur au double du score perdant ;
  - chaque perdant perd `min(mise, engagé)` ou, en rubicon, `min(2 × mise, engagé)` ;
  - le total réellement prélevé est partagé à parts égales entre les deux gagnants ;
  - si le total en demi-crédits est impair, le demi-crédit indivisible n'est pas prélevé : rien n'est créé, aucun solde ne devient négatif ;
  - prélevé = distribué, vérifié avant écriture.
- **Départ en cours de partie** : un robot joue, le joueur reste engagé jusqu'au résultat (il le reçoit à son retour). Une déconnexion n'évite aucune perte.
- **Annulation technique** (administration) : réservations libérées, ni gain ni perte, inscrite au journal.
- **Robots** : complètent uniquement les parties gratuites ; les parties avec crédits commencent avec quatre humains ayant un compte.
- **Journal** : chaque mouvement a un identifiant et une clé unique (achat, bonus, défi, règlement) ; il n'est jamais réécrit.
- **Achats** : désactivés par défaut (`BELOTE_PURCHASES=on` pour ouvrir). Chaque transaction de plateforme n'est créditée qu'une fois.

## Vérification des paiements

| Plateforme | Mécanisme | Vérification serveur | Variables |
|---|---|---|---|
| Site web | Stripe Checkout | webhook signé (HMAC, horodatage) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY` |
| iOS | StoreKit 2 (achat intégré obligatoire) | JWS : chaîne x5c jusqu'à Apple Root CA G3, signature ES256, bundle, remboursement | `APPLE_IAP_BUNDLE_ID`, `APPLE_IAP_SANDBOX`, `APPLE_ROOT_CA_SHA256` |
| Android | Google Play Billing | API Google Play Developer, état d'achat, consommation | `GOOGLE_PLAY_PACKAGE`, `GOOGLE_PLAY_SERVICE_ACCOUNT` |
| Développement | paiement fictif | refusé si `NODE_ENV=production` ou sur Railway | `BELOTE_TEST_SHOP=on` |

Les packs se configurent avec `BELOTE_PACKS` (JSON : `id`, `credits`, `price`, `priceCents`, `bonus`). Les identifiants doivent
correspondre aux produits créés dans App Store Connect et Google Play Console. Le code Apple et Google n'a pas encore été testé contre les
vrais services (aucun compte développeur disponible ici) : à valider en bac à sable avant ouverture.

## Exigences des stores et points bloquants à traiter avant d'ouvrir les achats

1. **iOS – achat intégré obligatoire** (règle 3.1.1) : sur iPhone, les crédits doivent être achetés via l'achat intégré d'Apple ; ils
   **ne doivent pas expirer**. L'app iOS ne doit pas renvoyer vers le paiement web. Le portefeuille partagé entre plateformes est
   admis (règle 3.1.3(b), services multiplateformes) si les crédits sont aussi proposés en achat intégré.
2. **Jeu d'argent simulé** : miser des crédits achetés sur le résultat d'une partie relève du *simulated gambling* (crédits non
   convertibles en argent). Classification d'âge élevée sur l'App Store (questionnaire « Simulated Gambling ») et sur Google Play (IARC),
   mention de l'âge minimum dans l'app (déjà affichée : « réservé aux joueurs majeurs »). **Ne jamais** proposer de retrait, d'échange
   ou de prix réels : l'app basculerait dans le jeu d'argent réel (licences, géolocalisation, règle 5.3.4).
3. **Google Play** : Google Play Billing obligatoire pour les achats dans l'app Android ; respecter la politique « Real-Money Gambling,
   Games, and Contests » (pas de valeur réelle), et la politique publicitaire si l'app fait de la publicité (les jeux de casino social
   suivent des règles spécifiques).
4. **Droit local (France / UE)** : faire valider par un juriste le modèle « crédits achetés + mises sur une partie » au regard de la
   réglementation des jeux d'argent (ANJ) et des règles de protection des consommateurs et des mineurs. C'est le **principal point
   bloquant** avant ouverture des achats.
5. **Suppression du compte** dans l'app (règle 5.1.1(v)) : déjà fournie. **Sign in with Apple** à proposer si Google est proposé sur iOS
   (règle 4.8).

Tant que ces points ne sont pas validés, laissez `BELOTE_PURCHASES` vide : les crédits de bienvenue, le bonus de connexion et les défis
permettent de jouer.

Sources consultées : [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[App Store Connect – classifications d'âge](https://developer.apple.com/help/app-store-connect/reference/age-ratings),
[Google Play – jeux d'argent et jeux](https://support.google.com/googleplay/android-developer/answer/9877032).

## Configuration

| Variable | Défaut |
|---|---|
| `BELOTE_SIGNUP_BONUS` | 2000 |
| `BELOTE_LOGIN_BONUS` | 200 (bonus de connexion toutes les 24 h, modifiable dans l'administration) |
| `BELOTE_DAY_START_UTC` | 3 (renouvellement quotidien des défis) |
| `BELOTE_CHALLENGES` | défis par défaut (JSON : `id`, `label`, `goal`, `reward.credits/xp/cosmetic`) |
| `BELOTE_ALERT_*` | seuils de détection (voir `src/integrity.js`) |

## Boutique Prestige (goodies)

- Articles vendus à l’unité, payés en jetons (crédits) : 10 avatars classiques (1 000), 5 avatars cadre doré (2 500), 5 avatars couronnés (5 000), 5 dos de cartes (1 500), 5 couleurs de table (3 000), 20 emojis (300). Aucun pack.
- Catalogue : `src/shop.js` ; visuels découpés dans `public/shop/` (avatars, emoji, backs, felts, frames).
- Achat (`shopBuy`) : vérifie le solde disponible (hors jetons engagés), débite et attribue dans la même opération ; clé de journal `shop:<joueur>:<article>` = jamais de double débit. Chaque achat apparaît dans l’historique du portefeuille.
- Purement cosmétique. Dos de cartes et couleur de table : visibles seulement chez le joueur. Emojis : 8 favoris au plus, une réaction toutes les 4 s, masquables dans les réglages.
- Administration (`/admin`, onglet Boutique) : nom, prix, ordre, visibilité. Masquer un article ne le retire pas à ses possesseurs.
