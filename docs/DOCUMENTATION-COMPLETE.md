# Belote Prestige — documentation complète de l'application

> **À quoi sert ce fichier ?** Il décrit toute l'application : le jeu, les écrans, le code, l'hébergement, les règles de travail et l'historique des décisions. Joignez-le au début d'une conversation avec Claude (Claude Chat, un Projet Claude ou Claude Code) pour qu'il comprenne le projet sans tout redécouvrir.
>
> État décrit : fin octobre 2026, version de `main` après la PR #123.

---

## 1. Le projet en bref

| | |
|---|---|
| Nom | **Belote Prestige** — belote contrée et belote classique en ligne, en français |
| Site | https://appi-belote.up.railway.app |
| Version en ligne | https://appi-belote.up.railway.app/api/health (champ `version` = début du commit de `main`) |
| Back-office | https://appi-belote.up.railway.app/admin (clé `BELOTE_ADMIN_KEY`) |
| Dépôt GitHub | `manishraanana-beep/belote`, branche principale `main` |
| Hébergement | **Railway**, projet « fearless-adaptation », environnement **belote**, service **@belote/api** (offre Hobby) |
| Données | un seul fichier `state.json` sur le volume Railway (`@belote/api-volume`) |
| Sauvegardes | chaque nuit vers **Cloudflare R2** (bucket `belote-sauvegardes`) + bouton de téléchargement dans le back-office |
| Langue | toute l'interface et les messages sont **en français** |

---

## 2. Règles de travail (à respecter dans toute modification)

1. **Une branche par sujet**, puis PR GitHub et fusion en **squash**. Railway déploie automatiquement `main`.
2. **Tests avant chaque mise en ligne** : `npm test` (≈ 79 tests) et `npx playwright test` (22 tests navigateur, ≈ 7 min). Un ou deux tests serveur sont parfois instables : on les relance.
3. **Changement visuel = capture d'écran montrée à l'utilisateur avant la mise en ligne.**
4. **Ne rien publier sur l'App Store / Google Play sans accord explicite.** La PR #64 (applications iOS/Android avec Capacitor, dossier `mobile/`) attend cet accord et devra être mise à jour avec `main`.
5. **Ne jamais toucher** au dépôt `app-jardinage`, ni au service **Postgres**, ni à l'environnement **production** de Railway (c'est l'application « jardin »).
6. **Aucun secret dans le dépôt.** Les secrets vivent uniquement dans les variables Railway.
7. **Les robots sont toujours présentés comme des robots** (badge « ROBOT ») : jamais de faux joueurs.
8. **CSP stricte** : aucun style en ligne dans le HTML ; les styles dynamiques passent par `element.style.setProperty` (CSSOM) ou par des classes.
9. Ne pas changer le moteur de jeu, les comptes ou l'économie quand on ne demande qu'un changement de design.

---

## 3. Technique

- **Node 22**, une seule dépendance : `ws` (WebSocket). **Aucune étape de build.**
- Serveur HTTP + WebSocket maison dans `src/server.js` ; le client est une page unique en JavaScript pur (`public/app.js`, rendu par template strings) + `public/style.css`.
- Le serveur ne sert que des fichiers autorisés (liste blanche). Sont autorisés automatiquement : `public/decor/*.webp|svg`, `public/fonts/*.woff2`, les cartes.
- Lancement local : `PORT=3999 BELOTE_DATA_DIR=$(mktemp -d) node src/server.js`.
- Scripts : `npm start`, `npm run dev` (rechargement auto), `npm test`, `npm run test:ui` (Playwright), `npm run vapid` (clés de notifications).

### 3.1 Fichiers du serveur (`src/`)

| Fichier | Rôle |
|---|---|
| `server.js` (~2 400 lignes) | HTTP, WebSocket, tables, salons, robots, commandes des joueurs, back-office `/api/admin`, minuteries (tours de jeu, tournois, nettoyages, sauvegarde) |
| `engine.js` | **Moteur de jeu** : donne, enchères, contre/surcontre, jeu de la carte, belote/rebelote, score ; **robots** (`botAction`) |
| `economy.js` | Jetons (crédits) : portefeuille, journal, réservations de mise, règlement des parties, bonus |
| `accounts.js` | Comptes : inscription e-mail/mot de passe, connexion Google/Apple, sessions, vérification d'e-mail, mots de passe oubliés |
| `tournaments.js` | Tournois : inscriptions, partenaires, confirmations de présence, formation des équipes, tableau à élimination directe, récompenses |
| `progression.js` | Niveaux, XP, badges, défis du jour |
| `shop.js` | Boutique d'objets (avatars, cadres, dos de cartes, tapis, emojis) |
| `purchases.js` | Achats de jetons (Stripe, Apple, Google) — **désactivés par défaut** |
| `push.js` | Notifications (navigateur VAPID, natif FCM) |
| `integrity.js` | Alertes anti-triche (indices combinés, jamais de sanction automatique) |
| `backup.js` | Envoi de la sauvegarde vers un stockage S3 (R2), signature AWS v4 faite à la main |

### 3.2 Fichiers du client (`public/`)

| Fichier | Rôle |
|---|---|
| `app.js` (~3 700 lignes) | Toute l'application : pages, table de jeu, fenêtres, sons, voix, back-office |
| `style.css` (~2 100 lignes) | Styles ; le thème Arcade est en fin de fichier, sous `:root[data-skin="arcade"]` |
| `tips.js` | Astuces affichées pendant les attentes |
| `sw.js`, `manifest.webmanifest` | Application installable (PWA) |
| `cards/`, `decor/`, `avatars/`, `shop/`, `fonts/`, `icons/` | Images, cartes SVG, polices (Cinzel, Alegreya, Fira Sans, Baloo 2) |

### 3.3 Autres dossiers

- `test/` : tests Node (`*.test.js`) — moteur, économie, serveur, tournois, progression, notifications, cartes.
- `e2e/` : tests navigateur Playwright (parcours complets, boutique, crédits, tournois, fluidité, plis).
- `docs/` : `ARCHITECTURE-APPLIS.md`, `CREDITS-ET-STORES.md`, `TOURNOIS-ET-NOTIFICATIONS.md` et ce fichier.
- `scripts/` : génération des cartes, clés VAPID.
- `mobile/` (PR #64, non fusionnée) : applications natives Capacitor.

---

## 4. Le jeu

### 4.1 Belote contrée (règles par défaut, `DEFAULT_RULES`)
- Objectif **1 000 points** par défaut ; tour de **20 s** ; reconnexion **90 s** ; surcontre possible pendant **8 s**.
- Enchères de **80 à 160** par 10, puis **Capot (250)**. Contre ×2, surcontre ×4, **contre « à la volée »** (les deux adversaires peuvent contrer à tout moment).
- Belote/rebelote = 20 points, jamais multipliée, perdue à la chute, et elle compte pour le contrat.
- Ordre des cartes : atout V 9 A 10 R D 8 7 ; hors atout A 10 R D V 9 8 7 ; dix de der.
- Fournir, couper, surcouper, monter à l'atout ; partenaire maître = défausse libre.
- Tout le monde passe : nouvelle donne, le donneur suivant distribue.

### 4.2 Belote classique (`rules.variant = "classique"`)
- 5 cartes + **carte retournée**, « Je prends / Je passe », 2ᵉ tour pour une autre couleur, puis distribution du reste.
- Objectif **750 points**, pas de contre.

### 4.3 Formats de partie
| Format | Points | Mise |
|---|---|---|
| **JOUER** (partie rapide, contrée ou classique) | **750** | **200 jetons** si le joueur a un compte et assez de jetons, sinon gratuite |
| **Tables des villes** (contrée) | **1 000** | Paris 500 · Monaco 1 000 · Dubaï 2 500 · Las Vegas 10 000 |
| **Tables privées VIP** | réglables | réglable par l'hôte |
| **Tournois** | réglables (ex. 1 000 / 1 500) | aucune mise ; gains offerts par la Maison |
| **Entraînement** (contre robots) | 1 000 | gratuit (retiré de l'accueil, accessible par script de test) |

### 4.4 Déroulement d'une partie
- **Appel des joueurs en ligne** avant les robots (« Voulez-vous jouer avec … ? »), attente **45 s** (`BELOTE_MATCH_WAIT_SECONDS`), bouton « Jouer avec des robots ».
- Les places vides sont complétées par des **robots** (badge ROBOT).
- Un joueur absent est remplacé par un robot « en relais » jusqu'à son retour.
- **Quitter une partie = mise perdue.** Seule la mise est engagée (pas de double « Rubicon »).
- Fin de partie : écran Victoire/Défaite, règlement des jetons, XP, badges, **revanche** (chaque joueur vote).

### 4.5 Ambiance et retours
- Sons, vibrations, **voix** (« Belote ! », « Rebelote ! », « Contré ! », « Surcontré ! », « Capot ! ») ; sur iPhone la voix se débloque au premier toucher.
- Bandeau « BELOTE ! / REBELOTE ! » avec le nom du joueur ; « CAPOT ! » en grand ; pluie de jetons à la victoire ; **partage de victoire en image**.
- **Anneau de compte à rebours** autour de l'avatar du joueur dont c'est le tour (vert → orange → rouge) ; le jeton « D » du donneur reste au-dessus.
- Badge du contrat sous le preneur (« 110 ♠ »), lisible à la verticale comme à l'horizontale.
- Cartes en main agrandies quand le téléphone est à la verticale.
- Bouton « Dernier pli », réactions et emojis, discussion de table.

---

## 5. Les robots (système d'annonces « de la maison »)

Tous les robots utilisent le même système, qu'ils soient partenaires ou adversaires. Ils ne voient que ce qu'un humain voit (jamais les cartes cachées).

### 5.1 Ouverture
1. **100 = maître à l'atout** : Valet + 9, avec 4 atouts (ou 3 avec l'As).
2. **90 = cherche le Valet ou le 9** : il a l'un des deux, avec 4 atouts (ou 3 avec l'As).
3. **80 = deux As** (atout = couleur la plus longue).
4. Sinon : passe.

### 5.2 Réponse au partenaire (une seule fois)
- **Partenaire à 90** : **+10** s'il a le Valet ou le 9 **ou** 3 atouts (non cumulés) ; **+10 de plus avec un As**.
- **Partenaire à 100** : +10 par As extérieur (maximum +30).
- **Partenaire à 80** : +10 avec 3 atouts.

### 5.3 Contrat adverse
- Par-dessus l'adversaire, **80/90/100 gardent leur sens** (jamais dans l'atout adverse).
- Au-delà de 100 : surenchère seulement avec une vraie main ; sinon **contre** (contrat ≥ 100 avec 2 des 3 cartes Valet/9/As d'atout, ou ≥ 120 avec une maîtresse et 2 As).

### 5.4 Jeu de la carte
- Le partenaire du preneur rejoue atout au 1er/2e pli si le contrat est à 90+.
- Le preneur fait tomber les atouts tant que les adversaires en ont ; plus d'atout quand ils n'en ont plus.
- Sur le pli sûr du partenaire : il défausse l'As s'il garde le Dix, sinon le Dix ; jamais un As seul.

### 5.5 Belote classique
Points de main (Valet 4, 9 = 3, As d'atout 1,5, Dix d'atout 1, chaque atout 1,2, chaque As extérieur 1,2) ; prise à partir de **8,5**.

---

## 6. Les écrans

### 6.1 Accueil (thème classique, celui de tous les joueurs)
- Logo, solde de jetons avec « + », avatar et niveau, rappel de la **roue du jour**.
- **Carte JOUER** : image, étiquette « PARTIE RAPIDE », sélecteur **Contrée / Classique** (mémorisé sur l'appareil), bouton jaune **JOUER** avec « Partie rapide en 750 points · 200 jetons ».
- **« Tables contrée en 1000 points »** : Paris, Monaco, Dubaï, Las Vegas (photo, drapeau, jeton de casino, joueurs en attente).
- Cartes **Tables VIP** et **Tournois**.
- Raccourcis : Parrainer, Roue, Amis, Classement ; statistiques (victoires, parties).
- **Barre du bas** : Boutique ♣ · Tournois ♦ · **Jouer ♠** (gros bouton doré central) · Amis ♥ · Profil.
- La page « Tables publiques » n'est plus liée depuis l'accueil (décision de l'utilisateur) ; **la création de table se fait uniquement par le Club VIP** (« Créer une table privée », « Rejoindre avec un code »).

### 6.2 Thème « Arcade » (optionnel)
- Activable dans **Compte → Réglages → « Thème Arcade (nouveau look) »**, mémorisé sur l'appareil (`localStorage.beloteSkin`), réversible en décochant.
- Police **Baloo 2**, boutons « en relief », accueil réorganisé, table avec pastille de scores NOUS/EUX, barre des points de la donne, enchères avec − / +, résultat de donne façon jeu mobile.
- Référence : `design_handoff_belote_arcade_lagon/README.md` (fourni par l'utilisateur).
- Choix de l'utilisateur : garder l'**ancien style** par défaut ; seuls la carte JOUER, les tables des villes et la barre du bas ont été repris dans le thème classique.

### 6.3 Autres pages
Bienvenue, inscription, connexion, mot de passe oublié/réinitialisation, vérification d'e-mail, profil (photo, pseudo, avatar, statistiques), historique, réglages (sons, animations, emojis, notifications, thème), règles, conditions/confidentialité, **Club VIP** (tables privées), **Tournois** (liste et fiche), **Boutique**, **Classement** (🏆 pour les vainqueurs de tournoi), salle d'attente d'une table.

### 6.4 Fenêtres
Amis (amis, demandes, recherche, réglages d'invitation), invitations reçues (grande fenêtre « … vous invite ! » avec Refuser/Rejoindre), parrainage, roue du jour, défis, niveau et badges, portefeuille, signalement, règles de la table.

---

## 7. Comptes, social, invitations

- Inscription par e-mail/mot de passe ou Google/Apple ; un même e-mail ne peut servir qu'une fois (insensible à la casse). Gmail : les points et « + » donnent des adresses différentes pour le jeu.
- **Visiteurs sans compte** (« Joueur xxxx », 0 jeton) : supprimés automatiquement après **24 h** d'absence s'ils n'ont ni partie, ni ami, ni tournoi.
- **Amis** : demandes, favoris, blocage, masquage du statut, « Qui peut m'inviter ? ».
- **Invitations à une table** : la fenêtre Amis se ferme à l'envoi ; l'invité s'assoit sur **la place choisie** par l'hôte ; l'invité reçoit une grande fenêtre et entre directement (sans récapitulatif des règles).
- **Parrainage** : 1 000 jetons chacun à la 1re partie du filleul (`BELOTE_REFERRAL_CREDITS`).

---

## 8. Jetons (économie)

- Les jetons (« crédits ») sont **virtuels** : ni retirables, ni transférables, ni convertibles en argent. Stockés en demi-unités (1 jeton = 2 unités).
- **Bonus d'inscription 2 000** (`BELOTE_SIGNUP_BONUS`).
- **Roue du jour** : un tour toutes les 24 h, bonus de base réglable dans le back-office (défaut 200, `BELOTE_LOGIN_BONUS`), multiplié par la **série de jours** (×1 à ×4).
- Mise réservée au départ ; gagnant = mise × 2 récupérée (bénéfice = mise) ; perdant = mise perdue ; quitter = mise perdue.
- Packs d'achat prévus (0,99 € à 9,99 €) mais **achats désactivés** (`BELOTE_PURCHASES` ≠ `on`). **Pas de Stripe configuré.**

---

## 9. Tournois

- Créés dans le back-office : nom, fuseau, **8/16/32 équipes**, solde minimum, règles (points, temps par tour, contre à la volée), dates (ouverture/fermeture des inscriptions, confirmation de présence, départ), récompenses (objets) et **gains en jetons** (vainqueurs/finalistes), rappels.
- Inscription seul ou avec un ami ; liste d'attente ; **confirmation de présence obligatoire** avant l'heure limite.
- Formation des équipes au moment de la confirmation ; tirage au sort ; exemptions ; élimination directe jusqu'à la finale.
- **« Équipes insuffisantes »** : Reporter, Annuler, ou **Compléter avec des robots** (un inscrit seul reçoit un partenaire robot ; des équipes « Robots 1, 2… » complètent jusqu'au minimum ; robots contre robots = tirage au sort ; jamais de tournoi 100 % robots).
- Absence prolongée = forfait de l'équipe (les robots ne déclenchent jamais de forfait).
- **Bouton « Inviter par WhatsApp »** sur la fiche du tournoi (message prêt avec le lien `/?tournoi=<id>`).
- Notifications : ouverture, rappels, « table prête », résultats.

---

## 10. Back-office (`/admin`)

Onglets :
- **Tableau de bord** : clients, en ligne, tables, tournois à venir, jetons en circulation/engagés, état des achats et notifications, **carte « 💾 Sauvegarde des données »** (Télécharger une sauvegarde / Sauvegarder maintenant / état de la copie de la nuit).
- **Clients** : recherche, fiche (journal des jetons, crédit manuel, modification, suspension, suppression).
- **Tournois** : création, modification, publication, report, annulation, duplication, inscriptions.
- **Modération** : alertes anti-triche à examiner, signalements des joueurs.
- **Boutique** : nom, prix, ordre, visibilité des objets.
- **Tables** : toutes les tables du serveur (villes, parties rapides, VIP, entraînement, tournois) ; « Supprimer » ou « Annuler (incident) » (rembourse les mises). Les tables vides et inactives sont supprimées automatiquement après **24 h**.
- **Réglages** : suspendre les nouvelles entrées (maintenance), bonus de connexion.

---

## 11. Hébergement, variables et sécurité

### 11.1 Railway
- Projet **fearless-adaptation**. Environnement **belote** = le jeu (service **@belote/api** + volume). Environnement **production** = l'application jardin (ne pas toucher). Un service **Postgres** existe (non utilisé par le jeu ; ne pas toucher).
- Déploiement automatique à chaque fusion dans `main`. Si rien ne bouge : **⌘K → « Deploy latest commit »**.
- Vérifier : `/api/health` → `version`.

### 11.2 Variables utilisées par le jeu
| Variable | Rôle |
|---|---|
| `BELOTE_ADMIN_KEY` | mot de passe du back-office (**secret**) |
| `BELOTE_BACKUP_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_REGION` | sauvegarde nocturne vers Cloudflare R2 (**secrets**) |
| `RESEND_API_KEY`, `BELOTE_MAIL_FROM` | e-mails (si configurés) |
| `BELOTE_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT`, `FCM_SERVICE_ACCOUNT` | notifications |
| `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID` | connexion Google/Apple |
| `BELOTE_LOBBY_STAKES` (500,1000,2500,10000), `BELOTE_QUICK_STAKE` (200), `BELOTE_MATCH_WAIT_SECONDS` (45), `BELOTE_SIGNUP_BONUS`, `BELOTE_LOGIN_BONUS`, `BELOTE_REFERRAL_CREDITS`, `BELOTE_PURCHASES`, `BELOTE_PACKS`, `BELOTE_CHALLENGES` | réglages du jeu |
| `BELOTE_DATA_DIR` / `RAILWAY_VOLUME_MOUNT_PATH` | dossier des données |

### 11.3 Incident Railway (22–23 octobre 2026)
- Panne générale + fuite possible des variables d'environnement chez Railway.
- Actions faites : nouveau `BELOTE_ADMIN_KEY`, passage en offre Hobby, mise en place des sauvegardes R2.
- À faire côté jardin : renouveler ses clés (S3, Postgres, `APP_SECRET`, `RECOVERY_CODE`…), retirer les variables du jardin copiées par erreur dans l'environnement belote.

---

## 12. Historique récent des changements (PR GitHub)

| PR | Changement |
|---|---|
| #105 | Annonces « Belote ! » puis « Rebelote ! » (voix + bandeau) |
| #106 | Invitations (fenêtre, place choisie, grande fenêtre invité), icônes de l'accueil, réponse des robots sur 90 |
| #107 | Partie rapide en 750 points |
| #108 | Invitation acceptée sans récapitulatif des règles |
| #109 | Nettoyage des visiteurs sans compte (7 j, puis 24 h en #115) |
| #110 | Surenchères des robots conformes au système |
| #111 | Sauvegarde (téléchargement + copie nocturne R2) |
| #112, #113, #114 | Partie à la verticale : cartes plus grandes, badge du contrat, anneau de compte à rebours, jeton « D » au-dessus |
| #116 | Thème Arcade optionnel |
| #117–#120 | Accueil : carte JOUER, tables des villes, barre du bas 5 onglets, textes |
| #121 | Tables privées vides supprimées après 24 h |
| #122 | Tournois : compléter avec des robots |
| #123 | Tournois : inviter par WhatsApp |

---

## 13. Idées et points ouverts

- Annonces tierce / cinquante / cent en belote classique.
- Vibrations iPhone dans l'application native (module Haptics, PR #64).
- Nom de domaine propre (ex. belote-prestige.fr) pour ne pas dépendre de l'adresse Railway ; plan de secours chez un autre hébergeur (Render, Fly.io, OVH/Scaleway).
- Journal des actions d'administration + alerte e-mail à chaque connexion au back-office.
- Bloquer les doublons d'adresses Gmail (points et « + »).
- Idées non réalisées : ligues mensuelles, tutoriel interactif, statistiques détaillées, événements, coffre de la semaine, clubs, revoir la dernière donne, réactions animées, partenaire fixe, défi en 1 clic, mode spectateur, album de collection, niveaux VIP, cadeaux entre amis.

---

## 14. Comment demander une modification à Claude

1. Décrire ce qu'on veut voir changer, si possible avec une capture d'écran.
2. Claude crée une branche, code, lance les tests, montre une capture si c'est visuel.
3. Après accord, Claude crée la PR et la fusionne ; Railway déploie.
4. Vérifier `/api/health` (version) puis l'application sur téléphone.
