# CLAUDE.md — Belote Prestige

Belote contrée et belote classique en ligne, **en français**.
Site : https://www.beloteprestige.com (ancienne adresse https://appi-belote.up.railway.app toujours active) · version en ligne : `/api/health` (champ `version`) · back-office : `/admin`.
Documentation détaillée (à lire seulement si besoin) : `docs/DOCUMENTATION-COMPLETE.md` (le plan économie/monétisation est dans sa section 14).

## Économie de tokens — règles obligatoires

1. **Lire uniquement les fichiers nécessaires** à la tâche : chercher d'abord (`grep -n` / Grep), puis lire la plage utile (`sed -n 'a,bp'`, Read avec `offset`/`limit`). Jamais `app.js`, `server.js` ou `style.css` en entier. Ne pas relire un fichier déjà vu sans raison.
2. **Jamais de réécriture complète** si une modification ciblée suffit : Edit ou remplacement exact d'un passage ; pas de reformatage, pas de renommage gratuit.
3. **Ne pas modifier l'existant sans nécessité** : aucune régression ; ne pas toucher à ce qui n'est pas demandé (moteur, comptes, jetons, serveur si la demande est visuelle).
4. **Réutiliser les composants existants** : `btn()`, `icon()`, `coins()`, `fmt()`, `modal()`, `toast()`, `ask()`/`cmd()`, `feeOf()`, `stakeLevels()`, `economy.post()`, `progression.grant()`/`award()`, `registry.record()`, `check()` ; classes CSS existantes avant d'en créer.
5. **Réponses courtes**, en français simple : le résultat d'abord, puis l'essentiel. Pas de répétition ni d'analyse déjà faite ; s'appuyer sur ce fichier.
6. **Ne pas afficher de code** dans les réponses sauf demande explicite.
7. **Conserver les décisions techniques** (section ci-dessous) ; les mettre à jour ici quand une nouvelle décision importante est prise.
8. **Vérifier après chaque modification** : `node --check public/app.js` pour le client ; test ciblé (ex. `node --test test/engine.test.js`) ; suite complète (`npm test` + `npx playwright test`) avant la mise en ligne ; capture si changement visuel.
9. **Jamais modifier ce qui fonctionne déjà sans l'accord de Jacques** : proposer d'abord, attendre son « oui » avant de changer un comportement existant.
10. **Pas d'analyse répétée ou inutile** : ne pas réexaminer ce qui est déjà établi dans ce fichier ou dans la conversation ; aller droit à la cause.
11. **Documentation courte et à jour** : après chaque décision ou règle importante, mettre à jour ce fichier en une ligne (pas de long texte) ; la doc détaillée reste dans `docs/`.

## Architecture

- **Node 22**, une seule dépendance (`ws`), **aucune étape de build**. Données : base **SQLite** `belote.db` sur le volume Railway (`src/storage.js`, `node:sqlite`), même objet `db` en mémoire ; ancien `state.json` importé puis conservé ; `BELOTE_STORAGE=json` = retour arrière.
- `src/server.js` : HTTP + WebSocket, tables, salons, robots, commandes des joueurs (`switch` sur `msg.type`), back-office `/api/admin`, minuteries (tours, tournois, nettoyages, sauvegarde).
- `src/engine.js` : moteur (donne, enchères, contre, jeu, score) et **robots** (`botBid`, `botPlay`, `botAction`).
- `src/economy.js` jetons · `src/accounts.js` comptes/sessions · `src/tournaments.js` tournois · `src/progression.js` niveaux/badges/défis · `src/shop.js` boutique · `src/purchases.js` vérification des achats (désactivés) · `src/registry.js` registre des achats · `src/push.js` notifications · `src/integrity.js` alertes anti-triche · `src/backup.js` sauvegarde R2.
- `public/app.js` : toute l'application (pages = fonctions `xxxPage()`, table = `gameView()`, actions = `switch` sur `data-action`, formulaires = `switch` sur l'id du formulaire). `public/style.css` : styles (thème Arcade en fin de fichier, sous `:root[data-skin="arcade"]`).
- Tests : `test/*.test.js` (`npm test`, ~99) ; `e2e/*.spec.js` (`npx playwright test`, 22 tests, ~7 min).
- Lancer en local : `PORT=3999 BELOTE_DATA_DIR=$(mktemp -d) node src/server.js`.

## Fonctionnalités principales

- **Contrée** (80→160, Capot, contre/surcontre à la volée, belote/rebelote) et **classique** (carte retournée, 750 pts).
- **JOUER** : partie rapide 750 pts (200 jetons si compte et solde suffisant). **Villes** en contrée 1 000 pts : Paris 500, Monaco 1 000, Dubaï 2 500, Las Vegas 10 000.
- Appel des joueurs en ligne puis **robots** (badge ROBOT) ; système d'annonces de la maison (100 maître, 90 cherche V/9, 80 deux As ; réponses, annonces collées/sauts, appels indirects) — détail dans la doc, section 5.
- **Tournois** (inscriptions, présence, élimination directe, pause 1 min entre tours, robots en complément, invitation WhatsApp).
- Comptes, amis, invitations, parrainage, roue du jour, défis, niveaux, boutique, classement, thème Arcade retiré des réglages (code conservé, tout le monde en classique).
- **Back-office** : tableau de bord + sauvegarde, clients, tournois, modération, boutique, tables, réglages.

## Décisions techniques à conserver

- Montants internes en **demi-crédits** (`toUnits`/`toCredits`) ; tout mouvement passe par `economy.post` (clé unique, jamais deux fois).
- **Droit de table supprimé** (0 % par défaut, décision de Jacques) ; réactivable avec `BELOTE_TABLE_FEE_PCT`.
- **Lot 1 (29/10) villes/jetons** : Paris 500, Cannes 1 500 (nouvelle, image provisoire), Monaco 5 000, Dubaï 15 000, Las Vegas 50 000 ; **commission** de 10 % sur le gain (`BELOTE_COMMISSION_PCT`) versée dans la **tirelire** du joueur (`wallet.piggy`), plafonnée à 20 000 (`BELOTE_PIGGY_CAP`), l'excédent reste sur le solde ; « Casser la tirelire » prêt mais inactif (achats fermés).
- **Lot 2 (30/10) packs** : Petit 10 000/1,99 €, Moyen 30 000/4,99 €, Grand 65 000/9,99 €, Prestige 140 000/19,99 €, **Royal** (nouveau) 400 000/49,99 € ; Fondateur relevé à 30 000. Étiquette « +N % » et « Meilleure valeur » **calculées** (`economy.packBonuses`, jamais écrites à la main). Écran « Plus de jetons » réordonné : gratuit, Fondateur, packs, **Membre Prestige tout en bas**. Texte légal : rétractation 14 jours (plus « non remboursables en argent »).
- **Tournois payants** : droit d'entrée prélevé au départ sur les seuls joueurs présents ; cagnotte = entrées − part Maison (10–20 %), 70 / 30.
- **Parrainage** versé après 10 parties et e-mail vérifié ; **Gmail normalisé** (points et « + ») ; connexion d'abord à l'adresse exacte.
- **Achats fermés** ; registre `db.purchases` (clé `provider:ref`), reprise des jetons si remboursement/opposition ; plafond mensuel ; **Pack Fondateur** une fois, après 3 parties, jusqu'à `BELOTE_FOUNDER_UNTIL`.
- **Membre Prestige** attribué depuis le back-office (`p.prestige.until`) : jetons du jour avec la roue, cadre/étoile, voix d'annonce ; objets Prestige invalides à la fin de l'abonnement (`progression.shown`).
- Attente avant robots **15 s** ; « en ligne » = autres joueurs connectés, masqué à 0.
- Écartés par Jacques (ne pas refaire) : explication des annonces des robots, Classique sur les villes, accessibilité (taille du texte, 4 couleurs), tournoi quotidien, ligues, classement par équipe.

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
