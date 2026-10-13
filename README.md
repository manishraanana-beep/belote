# Maison Belote — Belote contrée

Application française jouable à quatre en temps réel ou contre trois robots, sur ordinateur, tablette et mobile. Serveur autoritaire, moteur indépendant, interface colorée à tapis turquoise. Aucun service tiers ni secret n’est nécessaire pour jouer.

## Lancement

Prérequis : Node.js 22 ou supérieur.

```sh
cd /workspace/belote
npm ci --cache /workspace/.npm-cache
npm test
npm start
```

Le serveur écoute sur le port **3000**, sur toutes les interfaces. Ouvrez l’application avec l’accès fourni par votre hébergement. Pour jouer à quatre sur le même ordinateur, utilisez quatre profils de navigateur ou contextes privés distincts : deux onglets du même profil représentent le même joueur. Pour plusieurs appareils, utilisez la même adresse de serveur accessible sur votre réseau.

En développement : `npm run dev`. Aucun build ni base de données externe n’est requis. `PORT` permet de choisir un autre port.

## Parcours jouables

- **Entraînement** : acceptez les règles et jouez contre trois robots.
- **Public** : rejoignez une table après lecture de ses règles. Le premier joueur devient créateur et peut compléter les places avec des robots puis lancer la partie.
- **VIP** : créez votre table, choisissez ses règles et son éventuel mot de passe, copiez le lien privé. L’invité ouvre le lien, lit les règles et demande une place. Le créateur accepte ou refuse, peut retirer un participant et organiser les équipes avant lancement. VIP ne nécessite aucun paiement.
- Cliquez sur votre avatar pour changer pseudo/avatar, consulter vos statistiques et activer les sons. Chat, réactions, historique des annonces, dernier pli illustré au-dessus des annonces, résumé des donnes et revanche sont disponibles à la table. Les cartes traditionnelles affichent leur nombre de symboles et sont regroupées dans l’ordre pique, cœur, trèfle, carreau. Toute la main s’illumine à votre tour d’enchérir. Au jeu, aucune carte n’est recommandée ou mise en avant : vous choisissez, et le serveur refuse les coups illégaux. Les quatre cartes du pli sont ramassées avec une animation.

## Règles retenues et variantes

32 cartes, huit par joueur ; places 1 et 3 contre 2 et 4. Distribution aléatoire avec `crypto.randomInt`. Enchères de 80 à 160 par 10, capot, passe, contre et surcontre.

- Fournir la couleur ; à l’atout, monter si possible même si le partenaire est maître.
- Sans la couleur, couper et surcouper si possible lorsque l’adversaire est maître. Si aucune surcoupe n’est possible, sous-couper. Si le partenaire est maître, défausse libre.
- Atout : V, 9, A, 10, R, D, 8, 7 ; valeurs 20, 14, 11, 10, 4, 3, 0, 0. Hors atout : A, 10, R, D, V, 9, 8, 7 ; valeurs 11, 10, 4, 3, 2, 0, 0, 0. Dix de der : 10 ; total des points de cartes : 162.
- Belote puis rebelote automatiquement à la pose du roi et de la dame d’atout ; 20 points attribués après les deux cartes.
- Par défaut, réussite : `(points preneur + contrat) × multiplicateur + belote` ; défense : points défense + belote. Chute : `(162 + contrat) × multiplicateur + belote défense` ; belote preneur conservée. La belote compte par défaut pour atteindre le contrat ; elle n’est jamais multipliée.
- Variante **contrat seul** : remplace les bases précédentes du bénéficiaire du contrat par sa valeur seule ; en réussite, les défenseurs gardent leurs points. Les options permettent aussi de perdre la belote à la chute, ou de l’exclure de la vérification du contrat.
- Capot : le preneur doit gagner les huit plis. Valeur configurable (250 par défaut), utilisée comme base de contrat dans les formules ci-dessus. En mode points + contrat, un capot réussi sans belote et non contré rapporte donc 162 + 250 = 412.
- Trois passes après une enchère commencent le jeu. Quatre passes sans enchère redistribuent avec le même donneur, ou le suivant selon l’option. Le donneur tourne après chaque donne terminée. L’entame appartient au joueur après le donneur.
- Objectif configurable, 1000 par défaut. Si les deux équipes dépassent l’objectif, le plus grand score gagne. En cas d’égalité, une autre donne départage.

Les règles sont affichées avant l’entrée et figées pendant toute la partie, une restriction volontairement plus forte que le gel pendant la donne.

### Contre à la volée

Le bouton est disponible aux **deux adversaires du dernier enchérisseur**, hors de leur tour, tant que les enchères sont ouvertes. Une nouvelle enchère remplace le contrat contrable. La contre ferme immédiatement les enchères ; les deux membres de l’équipe preneuse peuvent surcontrer pendant huit secondes par défaut. La surcontre ou l’expiration commence le jeu. Multiplicateurs : contre ×2, surcontre ×4. `flyingCounter` isole cette convention ; sa désactivation impose le tour d’enchères pour contrer. Le délai est configurable.

Le serveur traite les messages dans l’ordre unique de sa boucle Node.js. Chaque action porte un UUID et la version du jeu ; la première action valide avance la version, les concurrentes périmées sont refusées. Un UUID déjà accepté est acquitté sans rejouer l’action. Le client affiche CONTRÉ / SURCONTRÉ et un son désactivable.

## Déconnexion et persistance

Tour de 30 secondes par défaut : expiration → passe aux enchères, première carte autorisée au jeu. Un joueur absent garde sa place pendant toute la partie. Après 90 secondes d’absence, un robot joue depuis sa vue privée jusqu’à son retour ; les tours expirés restent appliqués pendant le délai. Avant le lancement, une place déconnectée est libérée à l’expiration du délai. Un heartbeat WebSocket détecte les connexions silencieuses, ce qui peut retarder le début du délai jusqu’à environ 30 secondes.

La session anonyme repose sur un cookie HttpOnly, SameSite Strict, aléatoire. Gardez ce cookie : c’est la clé de votre profil invité et de votre place. Reconnexion automatique, restauration de la main, des scores et du contrat. Pas encore de compte récupérable par courriel ni de synchronisation du profil entre appareils.

Les sessions, tables, jeux et statistiques sont sauvegardés après chaque mutation dans `.data/state.json`, par écriture temporaire puis renommage. Ce dossier contient les cartes cachées et les sessions : il reste privé, ignoré par Git et n’est jamais servi en HTTP. `BELOTE_DATA_DIR` permet de choisir son emplacement. Conservez-le sur un disque persistant et sauvegardez-le. Un redémarrage restitue les jeux ; les processus et connexions ne survivent pas. Les délais déjà expirés sont traités au redémarrage ; la réservation de reconnexion repart à zéro.

## Architecture et sécurité

- `src/engine.js` : distribution, enchères, règles des plis, belote, scores et projections privées, sans interface ni WebSocket.
- `src/server.js` : sessions, tables, invitations, droits, ordonnancement, timers, bots, sauvegarde et API d’administration.
- `public/` : interface responsive en HTML/CSS/JavaScript natif, cartes dessinées en CSS, animations respectant la réduction de mouvement. Pas de ressources externes.
- `test/` : tests Node du moteur et intégration avec plusieurs connexions WebSocket réelles.
- `e2e/` : parcours Chromium sur ordinateur et mobile.

Node.js et WebSocket offrent un ordre d’exécution unique sur une instance, avec peu de dépendances. Aucun client ne contrôle la distribution ni les scores. Les robots reçoivent le même objet filtré que les humains : main propre, plis publics et cartes autorisées, sans autres mains. Les invités en attente ne reçoivent pas l’état privé de la table. Les invitations ont 192 bits aléatoires, sont contrôlées côté serveur et ne figurent pas dans le lobby public. Les mots de passe sont dérivés avec scrypt et un sel aléatoire.

Vérification de session et de place serveur, versions, dédoublonnage des 200 dernières commandes acceptées par joueur, limite de 25 commandes/seconde/joueur, messages WebSocket limités à 8 Ko, contrôle d’origine, échappement du texte et CSP. La limite de doublons est bornée ; les anciennes actions de jeu restent protégées par leur version.

## Administration

Configurez **BELOTE_ADMIN_KEY** comme variable secrète du processus serveur, puis ouvrez Administration et saisissez la clé. Ne la stockez pas dans le code. Sans clé, l’API est fermée. Elle permet de consulter joueurs et tables, traiter les signalements, suspendre/réactiver un profil, supprimer une table inactive et suspendre les nouvelles entrées/créations. Les parties actives ne peuvent pas être supprimées.

L’API utilise `Authorization: Bearer …`, jamais un secret dans l’URL. La clé reste en mémoire de la page ; elle n’est pas sauvegardée dans le navigateur. Le déploiement public doit utiliser HTTPS/WSS ; derrière un proxy TLS, configurez `BELOTE_SECURE_COOKIE=true` et transmettez correctement Host et Origin ainsi que les upgrades WebSocket.

## Vérifications

```sh
npm test
npm audit
# Chromium système, comme dans cet environnement cloud :
BELOTE_CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
# Sinon, installer le navigateur Playwright puis lancer :
npx playwright install chromium
npm run test:ui
```

Les tests couvrent les obligations de jeu, scores, capot, belote, redistributions, 20 parties du moteur contre des robots, confidentialité des mains, invitations/mots de passe/admission, deux contres simultanées, enchère contre contre concurrente, surcontre/expiration, doublons, requêtes de place falsifiées, tours expirés, remplacement et reconnexion, restauration après redémarrage, administration et une partie complète depuis l’interface. Les tests de délais simulent les échéances serveur plutôt que d’attendre 90 secondes. Les tests UI créent une instance isolée sur le port 3100 avec ses données temporaires, produisent des captures dans `test-results/` et testent un affichage mobile de 390 px.

## Limites de cette première version

Version jouable sur **une instance serveur** ; pas encore de déploiement public effectué. La persistance JSON convient à un prototype à petit volume : PostgreSQL, journal d’événements, coordination multi-instance, quotas globaux et tests de charge restent à prévoir pour une exploitation à grande échelle. Les bots respectent les cartes cachées mais leur stratégie est volontairement simple. L’administration utilise une clé commune ; comptes administrateurs, rôles et audit complet restent à ajouter. Les profils sont invités et identifiés par navigateur. Paiement/abonnement premium, classement compétitif et modération avancée restent à réaliser. Le drapeau VIP et les règles par table fournissent le point d’extension pour un futur contrôle d’abonnement.

## Illustrations des cartes

Les cartes utilisent le jeu classique **SVG-cards** (David Bellot, Huub de Beer et contributeurs, licence LGPL) :
figures françaises détaillées, index français agrandis. Les 32 fichiers `public/cards/*.svg` sont générés par
`python3 scripts/build-cards.py` à partir de `assets/cards-source.svg` ; voir `assets/cards-NOTICE.md` et `/cards-LICENSE.txt`.
