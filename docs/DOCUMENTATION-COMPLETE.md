# Belote Prestige — documentation complète de l'application

> **À quoi sert ce fichier ?** Il décrit toute l'application : le jeu, les écrans, le code, l'hébergement, les règles de travail et l'historique des décisions. Joignez-le au début d'une conversation avec Claude (Claude Chat, un Projet Claude ou Claude Code) pour qu'il comprenne le projet sans tout redécouvrir.
>
> État décrit : fin octobre 2026, version de `main` après la PR #130. Section 14 (économie et monétisation : plan retenu) ajoutée le 27 octobre 2026.

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
2. **Tests avant chaque mise en ligne** : `npm test` (≈ 81 tests) et `npx playwright test` (22 tests navigateur, ≈ 7 min). Un ou deux tests serveur sont parfois instables : on les relance.
3. **Changement visuel = capture d'écran montrée à l'utilisateur avant la mise en ligne.**
4. **Ne rien publier sur l'App Store / Google Play sans accord explicite.** La PR #64 (applications iOS/Android avec Capacitor, dossier `mobile/`) attend cet accord et devra être mise à jour avec `main`.
5. **Ne jamais toucher** au dépôt `app-jardinage`, ni au service **Postgres**, ni à l'environnement **production** de Railway (c'est l'application « jardin »).
6. **Aucun secret dans le dépôt.** Les secrets vivent uniquement dans les variables Railway.
7. **Les robots sont toujours présentés comme des robots** (badge « ROBOT ») : jamais de faux joueurs.
8. **CSP stricte** : aucun style en ligne dans le HTML ; les styles dynamiques passent par `element.style.setProperty` (CSSOM) ou par des classes.
9. Ne pas changer le moteur de jeu, les comptes ou l'économie quand on ne demande qu'un changement de design.
10. **Jetons, achats et robots** : respecter le plan de la section 14 (lignes rouges en 14.2). Les achats restent désactivés (`BELOTE_PURCHASES`) tant que la liste 14.6 n'est pas complète, et ne s'activent qu'avec un accord explicite.

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
- **Annonce « collée »** juste au-dessus de l'adversaire (80 → 90, 90 → 100, 100 → 110…) : c'est une **recherche**, le partenaire répond comme sur un 90 (Valet, 9 ou 3 atouts, +10 avec un As).
- **Saut** par-dessus l'adversaire (80 → 100) : **maître**, le partenaire annonce ses As (+10 par As).

### 5.3 Contrat adverse
- Par-dessus l'adversaire, **80/90/100 gardent leur sens** (jamais dans l'atout adverse).
- Au-delà de 100 : surenchère seulement avec une vraie main ; sinon **contre** (contrat ≥ 100 avec 2 des 3 cartes Valet/9/As d'atout, ou ≥ 120 avec une maîtresse et 2 As).

### 5.4 Jeu de la carte
- Le partenaire du preneur rejoue atout au 1er/2e pli si le contrat est à 90+.
- Le preneur fait tomber les atouts tant que les adversaires en ont ; plus d'atout quand ils n'en ont plus.
- Sur le pli sûr du partenaire : il défausse l'As s'il garde le Dix, sinon le Dix ; jamais un As seul.
- **Garder le 9** : sur l'entame atout du partenaire (Valet), il fournit son plus petit atout et garde le 9 maître (dès 2 atouts).
- **Cartes maîtresses gardées** pour faire le maximum de plis (jamais jetées sur un pli déjà gagné).
- **Appels indirects** : quand il ne peut pas fournir, il défausse une petite carte de la couleur sœur d'un As qu'il tient (carreau ↔ cœur, pique ↔ trèfle), jamais vers l'atout ; à la main, il rejoue la couleur appelée par son partenaire.

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
- **Évolutions décidées** (droit de table, parrainage après 10 parties, nouvelle grille de packs, abonnement) : voir la section 14.

---

## 9. Tournois

- Créés dans le back-office : nom, fuseau, **8/16/32 équipes**, solde minimum, règles (points, temps par tour, contre à la volée), dates (ouverture/fermeture des inscriptions, confirmation de présence, départ), récompenses (objets) et **gains en jetons** (vainqueurs/finalistes), rappels.
- Inscription seul ou avec un ami ; liste d'attente ; **confirmation de présence obligatoire** avant l'heure limite.
- Formation des équipes au moment de la confirmation ; tirage au sort ; exemptions ; élimination directe jusqu'à la finale.
- **« Équipes insuffisantes »** : Reporter, Annuler, ou **Compléter avec des robots** (un inscrit seul reçoit un partenaire robot ; des équipes « Robots 1, 2… » complètent jusqu'au minimum ; robots contre robots = tirage au sort ; jamais de tournoi 100 % robots).
- Absence prolongée = forfait de l'équipe (les robots ne déclenchent jamais de forfait).
- **Pause d'une minute entre deux tours** (`BELOTE_ROUND_BREAK_SECONDS`, défaut 60), qui démarre quand toutes les tables du tour ont fini ; notification « Finale dans 1 minute » et compte à rebours sur la fiche.
- **Nom du tour visible** à la table (pastille « 🏆 Quart de finale / Demi-finales / Finale ») et dans le message de fin de partie.
- **Bouton « Inviter par WhatsApp »** sur la fiche du tournoi (message prêt avec le lien `/?tournoi=<id>`).
- Notifications : ouverture, rappels, « table prête », résultats.

---

## 10. Back-office (`/admin`)

Onglets :
- **Tableau de bord** : clients, en ligne, tables, tournois à venir, jetons en circulation/engagés, état des achats et notifications, **carte « 💾 Sauvegarde des données »** (Télécharger une sauvegarde / Sauvegarder maintenant / état de la copie de la nuit).
- **Clients** : recherche, fiche (journal des jetons, crédit manuel, modification, suspension, suppression).
- **Tournois** : création, modification, publication, report, annulation, duplication, inscriptions, **suppression des anciens tournois** (terminés, annulés, brouillons ; les 🏆 du classement sont conservés dans `db.tourCups`).
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
| `BELOTE_VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT`, `FCM_SERVICE_ACCOUNT` | notifications (sans clés VAPID, le serveur crée et garde sa propre paire) |
| `BELOTE_ROUND_BREAK_SECONDS` (60) | pause entre deux tours de tournoi |
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
| #124 | Cette documentation |
| #125, #126 | Tournois : pause entre les tours (1 min), nom du tour visible, notifications sans réglage |
| #127 | Robots : annonces collées / sauts, appels indirects, garder le 9 et les cartes maîtresses |
| #128 | Profil : la fenêtre « Modifier mon pseudo » se ferme après l'enregistrement |
| #129 | Parrainage : lien en double dans le message partagé |
| #130 | Back-office : supprimer les anciens tournois |

---

## 13. Idées et points ouverts

Les points repris dans la section 14 (jetons, achats, fidélisation) y sont désormais décidés et ordonnés ; cette liste garde le reste des idées.

- Annonces tierce / cinquante / cent en belote classique.
- Vibrations iPhone dans l'application native (module Haptics, PR #64).
- Nom de domaine propre (ex. belote-prestige.fr) pour ne pas dépendre de l'adresse Railway ; plan de secours chez un autre hébergeur (Render, Fly.io, OVH/Scaleway).
- Journal des actions d'administration + alerte e-mail à chaque connexion au back-office.
- Bloquer les doublons d'adresses Gmail (points et « + »).
- Idées non réalisées : ligues mensuelles, tutoriel interactif, statistiques détaillées, événements, coffre de la semaine, clubs, revoir la dernière donne, réactions animées, partenaire fixe, défi en 1 clic, mode spectateur, album de collection, niveaux VIP, cadeaux entre amis.

---

## 14. Économie et monétisation : plan retenu (27 octobre 2026)

> Synthèse de deux analyses faites « dans la peau d'un joueur » (conversations Claude du 27 octobre 2026), avec leurs contradictions tranchées. Ce qui est écrit ici est **décidé** : toute modification qui touche aux jetons, aux achats, aux robots ou aux offres doit le respecter. Les montants sont des **valeurs de départ**, à ajuster avec les chiffres réels ; chaque nouveau réglage passe par une variable ou par le back-office, et se documente en 11.2.

### 14.1 Constats

- **Économie trop généreuse.** La roue donne jusqu'à 800 jetons par jour (200 × 4), les parties entre humains sont à somme nulle, les tournois et le parrainage créent des jetons, et presque rien n'en retire. Les soldes ne font que monter : personne n'a besoin d'acheter.
- **Fuites de jetons gratuits.** Doublons Gmail (points, « + ») qui touchent chacun le bonus d'inscription ; parrainage versé après une seule partie contre des robots ; table privée à grosse mise où un compte perd exprès pour « donner » ses jetons à un autre. Résultat : des jetons gratuits à l'infini, et une revente possible.
- **Confiance.** Adresse en `up.railway.app` ; un seul `state.json` (restaurer la copie de la nuit effacerait les achats du jour, avec des oppositions bancaires à la clé) ; soupçon de robots « réglés pour faire perdre ».
- **Premières minutes.** Jusqu'à 45 s d'attente ; annonces du robot partenaire incomprises (« 90 » = Valet ou 9 d'atout) ; compte pas proposé au meilleur moment ; villes uniquement en contrée ; « 0 en attente » partout, qui donne l'impression d'une appli vide ; « Club VIP » qui laisse croire que c'est payant.
- **Ce qui fait payer un joueur de belote** : jouer avec ses potes, montrer qu'il est bon, et ne jamais avoir l'impression qu'on l'arnaque.

### 14.2 Lignes rouges

1. **Hasard intouchable.** Jamais de réglage des robots, des donnes ou des offres selon le solde, les pertes ou les achats d'un joueur. Mélange par `crypto.randomInt`, expliqué sur une page « Jeu équitable » qui rappelle aussi que les robots ne voient que ce qu'un humain voit.
2. **Jetons sans valeur hors du jeu.** Ni transfert, ni cadeau de jetons, ni revente, ni lot réel (tournois compris). Les cadeaux entre amis sont des objets ou un mois Membre Prestige.
3. **Prix clairs.** Prix en euros partout (packs, bouton « + » du solde), équivalent en euros à côté des prix en jetons dans la boutique, une seule monnaie, et jamais d'achat forcé au-delà du besoin.
4. **Pas de pression.** Ni faux compte à rebours, ni promo permanente, ni relance après une défaite (« rejoue pour te refaire »). « Meilleure valeur » seulement sur le pack objectivement le plus avantageux, « Le plus populaire » seulement si c'est mesuré.
5. **Pas de coffre payant à contenu aléatoire.** Le futur coffre de la semaine reste gratuit ou à contenu fixe.
6. **Protection du joueur.** Droit de rétractation de 14 jours pour les jetons achetés non utilisés (dans les CGV), résiliation de l'abonnement « en trois clics » sur le web, plafond de dépenses réglable par le joueur, historique des achats dans le portefeuille.
7. **Public adulte.** Classement App Store attendu : 18+. Aucune communication visant les mineurs.

Contexte (ce n'est pas un avis juridique ; CGV et rétractation à faire relire par un avocat spécialisé avant d'activer les achats) :
- principes européens sur les monnaies virtuelles dans les jeux (réseau CPC, mars 2025) : prix en vraie monnaie, droit de rétractation, pas d'achat forcé ; non contraignants, mais ils annoncent les contrôles ;
- Digital Fairness Act : proposition de la Commission attendue le 11 novembre 2026 (date provisoire), qui vise notamment le design addictif et les monnaies virtuelles ;
- droit français : un jeu d'argent réunit offre au public, hasard, sacrifice financier et espérance de gain ; c'est l'absence de toute valeur des jetons hors du jeu qui tient Belote Prestige à l'écart ;
- App Store : des paris simulés fréquents entraînent un classement 18+ (à prévoir pour la PR #64).

### 14.3 Économie cible

| Élément | Décision (valeur de départ) |
|---|---|
| Roue du jour | inchangée pour l'instant, à réévaluer avec la courbe « jetons créés / détruits » |
| Droit de table | 10 % de la mise, payé à l'entrée par chaque joueur, affiché avant de s'asseoir (« Mise 1 000 + droit de table 100 ») et retiré de la circulation ; sur toutes les parties avec mise, pas en partie gratuite ni en tournoi |
| Villes | accès par solde seulement, comme aujourd'hui (pas de niveau requis) ; badge « Vainqueur à Las Vegas » visible par tous |
| Tournois payants | droit d'entrée en jetons ; cagnotte = inscriptions moins 10 à 20 % pour la Maison ; bonus de la Maison réservé aux événements (lancement, Noël) ; lots uniquement virtuels |
| Parrainage | versé quand le filleul a terminé 10 parties, avec un e-mail vérifié et un appareil différent de celui du parrain (quand l'identifiant d'appareil est disponible) |
| Comptes | adresses Gmail normalisées (points et « + ») : une seule inscription par boîte |
| Anti-fraude | `integrity.js` signale les parties répétées entre les mêmes comptes ou depuis le même appareil, avec des gains à sens unique (alerte, jamais de sanction automatique) |
| Robots | viser environ 50 % de victoires humaines contre eux ; si leur niveau change selon la table, l'annoncer |
| Indicateurs (tableau de bord) | jetons créés / détruits par jour et par source, retour à J1 et J7, départs pendant l'attente, durée moyenne d'une partie, part de joueurs payants |

### 14.4 Offres et prix

| Pack | Prix | Jetons | Remarque |
|---|---|---|---|
| Fondateur | 1,99 € | 10 000 + cadre « Fondateur » | une fois par compte, proposé après 3 à 5 parties, pendant la période de lancement (avec une vraie date de fin) ; le cadre ne sera plus jamais vendu |
| Relance | 0,99 € | 2 000 | appli native uniquement : sur le web, les frais fixes de Stripe (environ 0,25 €) en mangent un quart |
| Petit | 1,99 € | 4 000 | |
| Moyen | 4,99 € | 11 000 (+10 %) | |
| Grand | 9,99 € | 24 000 (+20 %) | |
| Prestige | 19,99 € | 52 000 (+30 %) | « Meilleure valeur » |

Grille à recalibrer après le lot Économie : aujourd'hui, le petit pack vaut cinq jours de roue pour un joueur fidèle, ce qui ne fait envie à personne.

- **Offres au bon moment.** « Il te manque X jetons pour Dubaï » avec le plus petit pack qui couvre le manque ; écran « Plus de jetons » qui montre d'abord le gratuit (prochaine roue dans X h, parties rapides gratuites, vidéo récompensée dans l'appli native), puis les packs.
- **Abonnement « Membre Prestige »** (environ 4,99 €/mois) : jetons chaque jour, deuxième tour de roue, cadre et badge visibles à la table, statistiques détaillées, options avancées des tables privées, sans pub.
- **Objets visibles par la table** : cadres animés, titres (« Roi du Capot », « Roi de Monaco de la semaine »), effets de victoire, emotes animées, **voix d'annonce** au choix (commentateur sportif, voix du Sud…) entendues par toute la table quand on crie « Belote ! » ; séries limitées pour Noël, la Fête des pères et les grands événements sportifs.
- **Vidéo récompensée** (appli native) : volontaire, 200 à 300 jetons, 5 par jour au maximum, jamais pendant une partie.
- **Plus tard** : pass de saison (4 à 6 semaines, piste gratuite et piste premium) ; tirelire (une part des gains s'y accumule, on la casse pour 2,99 €) ; offrir un mois Membre Prestige à un ami ; « Conseil de la Maison » (après la partie, montrer où les annonces du joueur s'écartent du système des robots ; une analyse gratuite par jour, illimitée pour les membres).

### 14.5 Expérience joueur

- **Attente** : 15 s par défaut (`BELOTE_MATCH_WAIT_SECONDS`), avec un compteur visible ; mesurer les départs.
- **Bulle d'explication** à chaque annonce de robot, tirée du système de la section 5 (« 90 : j'ai le Valet ou le 9 d'atout »), et le même système expliqué dans les règles.
- **Compte proposé après la première partie** d'un visiteur, surtout après une victoire : « Garde ta victoire : 2 000 jetons offerts + les 200 de cette partie ».
- **À la table** : carte jouée automatiquement quand une seule est possible ; présélection de sa carte avant son tour.
- **Jouer entre amis** : « Club VIP » renommé « Jouer entre amis » ; lien WhatsApp « Rejoins ma table », comme pour les tournois.
- **Accueil** : vrai nombre de joueurs en ligne affiché, « 0 en attente » masqué par table ; amis en ligne visibles avec un défi en un clic.
- **Classique** : sélecteur Contrée / Classique sur les tables des villes.
- **Fin de partie** : après une défaite, montrer un progrès (XP, défi, saison) et la revanche en un clic ; après une victoire, le prochain objectif (« Plus que 1 300 jetons pour Dubaï ») ; lien de parrainage dans l'image de victoire partagée.
- **Accessibilité**, gratuite : taille du texte, jeu « 4 couleurs ».
- **Fidélité** : tournoi quotidien à heure fixe (ex. 21 h, créé automatiquement) ; ligues hebdomadaires fondées sur le niveau de jeu, jamais sur les jetons ; notifications utiles, sans spam.
- **Plus tard** : partenaire fixe et classement par équipe, revoir la dernière donne, statistiques détaillées, robot partenaire plus fin au jeu de la carte (compte les atouts tombés, retient qui coupe). Les annonces tierce / cinquante / cent restent dans la section 13.

### 14.6 Avant d'activer les achats (`BELOTE_PURCHASES=on`)

À faire par Jacques : nom de domaine (ex. belote-prestige.fr) branché sur Railway ; comptes Stripe, Apple et Google prêts ; CGV et rétractation relues par un avocat ; **accord explicite** pour activer.

À faire dans le code :
- [ ] Base de données dédiée au jeu, transactionnelle (pas le Postgres existant, qui appartient au jardin), avec la sauvegarde nocturne vers R2 conservée.
- [ ] Registre des achats rapproché des paiements : validation côté serveur, pas de double crédit, achats ré-importables depuis Stripe, Apple et Google après une restauration, jetons repris en cas de remboursement.
- [ ] Pages CGV, confidentialité, rétractation et « Jeu équitable » ; mélange par `crypto.randomInt`.
- [ ] Suppression du compte par le joueur lui-même, depuis l'appli.
- [ ] Chat : filtre de mots en plus du signalement et du blocage ; phrases rapides.
- [ ] Prix en euros partout, plafond de dépenses réglable, historique des achats dans le portefeuille.
- [ ] Indicateurs de la section 14.3 dans le tableau de bord.

### 14.7 Lots, dans l'ordre

Un lot à la fois. Un lot peut donner plusieurs PR (une branche par sujet). Après chaque lot : vérification sur téléphone, puis mise à jour de la colonne Statut.

| Lot | Contenu | Statut |
|---|---|---|
| 1 | **Données** : base dédiée, migration de `state.json` sans perte, registre des achats (plan proposé et validé avant de coder) | à faire |
| 2 | **Conformité** : pages légales et « Jeu équitable », mélange `crypto.randomInt`, suppression de compte, filtre du chat, prix en euros, plafond et historique des achats | à faire |
| 3 | **Fuites** : Gmail normalisé, parrainage après 10 parties, alertes `integrity.js` | à faire |
| 4 | **Économie** : droit de table, tournois payants en jetons, indicateurs | à faire |
| 5 | **Premières minutes** : attente 15 s, bulle des annonces, compte après la 1re partie, carte automatique et présélection, « Jouer entre amis » + WhatsApp, accueil, Classique dans les villes, fins de partie, accessibilité | à faire |
| 6 | **Offres** : Pack Fondateur, grille de packs, « Il te manque X jetons », écran « Plus de jetons » (achats toujours désactivés) | à faire |
| 7 | **Fidélité et revenus récurrents** : tournoi quotidien, ligues par niveau de jeu, Membre Prestige, objets visibles, badge « Vainqueur à Las Vegas » et voix d'annonce | à faire |
| — | **Plus tard** : pass de saison, Conseil de la Maison, tirelire, vidéo récompensée (appli native, PR #64), partenaire fixe, statistiques détaillées, dernière donne, robot plus fin | — |

---

## 15. Comment demander une modification à Claude

1. Décrire ce qu'on veut voir changer, si possible avec une capture d'écran.
2. Claude crée une branche, code, lance les tests, montre une capture si c'est visuel.
3. Après accord, Claude crée la PR et la fusionne ; Railway déploie.
4. Vérifier `/api/health` (version) puis l'application sur téléphone.
