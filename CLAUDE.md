# CLAUDE.md — Belote Prestige

Belote contrée et belote classique en ligne, **en français**.
Site : https://appi-belote.up.railway.app · version en ligne : `/api/health` (champ `version`) · back-office : `/admin`.
Documentation détaillée (à lire seulement si besoin) : `docs/DOCUMENTATION-COMPLETE.md` (le plan économie/monétisation est dans sa section 14).

## Économie de tokens — à appliquer à chaque tâche

- **Ne lire que les fichiers nécessaires.** Chercher avec `grep -n` / Grep, puis lire la plage utile (`sed -n 'a,bp'`, Read avec `offset`/`limit`). Jamais `app.js`, `server.js` ou `style.css` en entier.
- **Modifications ciblées** : Edit ou remplacement exact d'un passage. Ne pas réécrire un fichier, ne pas reformater, ne pas renommer sans raison.
- **Préserver l'existant** : aucune régression ; ne pas toucher à ce qui n'est pas demandé (moteur, comptes, jetons, serveur si la demande est visuelle).
- **Réponses concises**, en français simple : le résultat d'abord, puis l'essentiel.
- **Pas d'analyses répétées** : s'appuyer sur ce fichier et sur ce qui a déjà été lu dans la conversation ; ne pas relire un fichier déjà vu sans raison.
- Lancer seulement les tests utiles pendant le travail (ex. `node --test test/engine.test.js`), la suite complète avant la mise en ligne.

## Architecture

- **Node 22**, une seule dépendance (`ws`), **aucune étape de build**. Données : base **SQLite** `belote.db` sur le volume Railway (`src/storage.js`, `node:sqlite`), même objet `db` en mémoire ; ancien `state.json` importé puis conservé ; `BELOTE_STORAGE=json` = retour arrière.
- `src/server.js` : HTTP + WebSocket, tables, salons, robots, commandes des joueurs (`switch` sur `msg.type`), back-office `/api/admin`, minuteries (tours, tournois, nettoyages, sauvegarde).
- `src/engine.js` : moteur (donne, enchères, contre, jeu, score) et **robots** (`botBid`, `botPlay`, `botAction`).
- `src/economy.js` jetons · `src/accounts.js` comptes/sessions · `src/tournaments.js` tournois · `src/progression.js` niveaux/badges/défis · `src/shop.js` boutique · `src/purchases.js` vérification des achats (désactivés) · `src/registry.js` registre des achats · `src/push.js` notifications · `src/integrity.js` alertes anti-triche · `src/backup.js` sauvegarde R2.
- `public/app.js` : toute l'application (pages = fonctions `xxxPage()`, table = `gameView()`, actions = `switch` sur `data-action`, formulaires = `switch` sur l'id du formulaire). `public/style.css` : styles (thème Arcade en fin de fichier, sous `:root[data-skin="arcade"]`).
- Tests : `test/*.test.js` (`npm test`, ~96) ; `e2e/*.spec.js` (`npx playwright test`, 22 tests, ~7 min).
- Lancer en local : `PORT=3999 BELOTE_DATA_DIR=$(mktemp -d) node src/server.js`.

## Fonctionnalités principales

- **Contrée** (80→160, Capot, contre/surcontre à la volée, belote/rebelote) et **classique** (carte retournée, 750 pts).
- **JOUER** : partie rapide 750 pts (200 jetons si compte et solde suffisant). **Villes** en contrée 1 000 pts : Paris 500, Monaco 1 000, Dubaï 2 500, Las Vegas 10 000.
- Appel des joueurs en ligne puis **robots** (badge ROBOT) ; système d'annonces de la maison (100 maître, 90 cherche V/9, 80 deux As ; réponses, annonces collées/sauts, appels indirects) — détail dans la doc, section 5.
- **Tournois** (inscriptions, présence, élimination directe, pause 1 min entre tours, robots en complément, invitation WhatsApp).
- Comptes, amis, invitations, parrainage, roue du jour, défis, niveaux, boutique, classement, thème Arcade optionnel.
- **Back-office** : tableau de bord + sauvegarde, clients, tournois, modération, boutique, tables, réglages.

## Règles de développement

1. Une branche par sujet → PR GitHub → fusion **squash** ; Railway déploie `main` automatiquement.
2. Tests avant chaque mise en ligne ; 1–2 tests serveur parfois instables : relancer.
3. **Changement visuel : montrer une capture avant la mise en ligne.**
4. Textes de l'application et messages **en français**.
5. **CSP stricte** : aucun style en ligne ; styles dynamiques via `style.setProperty` ou classes.
6. **Aucun secret dans le dépôt** (variables Railway uniquement).
7. Les robots sont toujours présentés comme des robots.
8. **Ne jamais toucher** au dépôt `app-jardinage`, au service Postgres ni à l'environnement Railway `production` (application jardin).
9. **Rien sur l'App Store / Google Play sans accord explicite** (PR #64 en attente).
10. Jetons, achats, robots, offres : respecter la section 14 de la doc (lignes rouges 14.2). Achats désactivés (`BELOTE_PURCHASES`) sans accord explicite.
