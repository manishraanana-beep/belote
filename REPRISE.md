# Belote Prestige — reprise du projet (nouvelle session)

À coller en début de nouvelle tâche pour reprendre le travail sans perdre le contexte.

## Le projet
- Jeu de **belote contrée** (et **belote classique**) en ligne, en français : « Belote Prestige ».
- Dépôt GitHub : `manishraanana-beep/belote` — branche principale `main`.
- Site en ligne : https://appi-belote.up.railway.app (hébergé sur **Railway**, service `@belote/api`).
- Version en ligne : https://appi-belote.up.railway.app/api/health (champ `version` = début du commit de `main`).

## Technique
- Node 22 + `ws`, **sans étape de build**.
  - Serveur : `src/server.js` · moteur de jeu : `src/engine.js` · jetons : `src/economy.js` · comptes : `src/accounts.js` · tournois : `src/tournaments.js` · achats stores : `src/purchases.js` · notifications : `src/push.js`.
  - Application : `public/app.js` (page unique) et `public/style.css`.
- **CSP stricte** : aucun style en ligne ; styles dynamiques via `style.setProperty` (CSSOM).
- Le serveur ne sert que des fichiers autorisés ; `public/decor/*.webp|svg` sont autorisés automatiquement.
- Tests : `npm test` (~76 tests, 1 ou 2 tests serveur parfois instables : relancer) et `npx playwright test` (22 tests navigateur, ~7 min).
- Captures locales : `PORT=3999 BELOTE_DATA_DIR=$(mktemp -d) node src/server.js`, puis Playwright (le script doit être lancé depuis le dossier du dépôt pour trouver `@playwright/test`). Pour l'entraînement (retiré de l'accueil) : créer un bouton `data-action="practice"` par script.

## Méthode de travail
1. Branche `claude/<sujet>` depuis `origin/main`.
2. Tests, capture d'écran envoyée à l'utilisateur, commit, push.
3. PR GitHub puis fusion (squash). Railway déploie `main` automatiquement.
4. Si le site ne se met pas à jour : dans Railway, « Deploy latest commit » (⌘K).
- Messages et textes de l'application **en français**.

## Règles à respecter
- **Ne rien publier sur l'App Store / Google Play sans l'accord explicite de l'utilisateur.** La PR **#64** (applications iOS/Android avec Capacitor, dossier `mobile/`) attend son accord ; elle devra être mise à jour avec `main` avant fusion.
- Ne jamais toucher au dépôt `app-jardinage` ni au service **Postgres** sur Railway.
- Aucun secret dans le dépôt.
- Les robots sont toujours présentés comme des robots (badge « ROBOT ») : pas de faux joueurs.
- Toujours montrer une image (capture) **avant** de mettre en ligne un changement visuel demandé comme « à valider ».

## Ce qui existe (principales fonctions)
- **Contrée** : enchères 80–160/capot, contre/surcontre (à la volée), belote, robots avec le système de la maison (80 = deux As, 90 = cherche Valet/9, 100 = maître ; réponses +10 ; As défaussé = Dix gardé ; le partenaire du preneur rejoue atout à 90+ ; plus d'atout quand les adversaires n'en ont plus).
- **Belote classique** (variante `rules.variant = "classique"`) : 5 cartes + retourne, « Je prends / Je passe », 2e tour, 750 points, pas de contre.
- **Jouer maintenant** : contrée en **500 points**, mise 200 jetons. **Tables des villes** (Paris 500, Monaco 1 000, Dubaï 2 500, Las Vegas 10 000) en **1 000 points**.
- **Appel des joueurs en ligne** avant les robots (« Voulez-vous jouer avec … ? »), attente 45 s (`BELOTE_MATCH_WAIT_SECONDS`), bouton « Jouer avec des robots ».
- Mise : seule la mise est engagée et perdue (plus de double « Rubicon ») ; quitter une partie = mise perdue.
- **Roue du jour** + **série de jours** (×1 à ×4), bonus de base réglable dans le back-office.
- **Parrainage** : 1 000 jetons chacun à la 1re partie du filleul.
- **Sons, vibrations, voix** (« Belote, rebelote ! », « Contré ! », « Capot ! »), pluie de jetons, « CAPOT ! », partage de victoire en image.
- **Tournois** (back-office : jetons gagnés vainqueurs/finalistes), **classement** avec 🏆 pour les vainqueurs de tournoi.
- Boutique (avatars, cadres, dos, tapis), défis, amis, back-office `/admin` (clé `BELOTE_ADMIN_KEY`).

## Points ouverts / idées non faites
- Annonces tierce / cinquante / cent en belote classique.
- Vibrations sur iPhone dans l'application native (module Haptics à ajouter dans la PR #64).
- Idées proposées non réalisées : ligues mensuelles, tutoriel interactif, statistiques détaillées, événements, coffre de la semaine, clubs, revoir la dernière donne, réactions animées, partenaire fixe, défi en 1 clic, mode spectateur, album de collection, niveaux VIP, cadeaux entre amis.
- Railway : choisir une offre payante (fin de la période d'essai).

## Nouvelle tâche
> (Écrire ici la demande.)
