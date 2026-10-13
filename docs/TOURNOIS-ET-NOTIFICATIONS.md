# Tournois et notifications push

## Ce qui fonctionne (testé)

| Fonction | Où | Tests |
|---|---|---|
| Programmation (brouillon, publication, modification, report, annulation, duplication, calendrier) | Administration › Tournois, `src/tournaments.js` | unitaires + intégration |
| Dates saisies dans un **fuseau de référence**, contrôle de cohérence (ouverture < fermeture ≤ fin de présence ≤ départ), changements d'heure | `zonedToUtc` | 29 mars / 25 octobre, Paris, New York, Tokyo |
| Ouverture, fermeture, formation des équipes et **départ automatiques côté serveur**, sans administrateur connecté, sans double lancement | horloge du serveur (`tick`, chaque seconde) | unitaires + intégration + navigateur |
| Inscription seul ou avec un ami (proposition à accepter), liste d'attente, désinscription, promotion de la liste d'attente | commandes `tourRegister`, `tourPartner`, `tourUnregister` | inscriptions simultanées, limites de places |
| **Seuil d'accès** (50 000 jetons par défaut, réglable par tournoi), vérifié à l'inscription et à la confirmation, **sans prélèvement ni blocage** ; solde, manque et accès boutique affichés | serveur + fenêtre « Solde insuffisant » | unitaires + navigateur |
| Confirmation de présence (fenêtre de 15 min avant le départ, échéance affichée), remplacement des absents par la liste d'attente | `tourConfirm` | unitaires |
| Équipes insuffisantes : report (2 fois au plus) ou annulation selon le choix de l'administrateur, inscrits prévenus | `form()` | unitaires |
| Tableau à élimination directe 8/16/32 (réduit à la puissance de deux utile, exemptions), tirage au sort, équipes fixes, tour suivant automatique, finale | `launchRound`, `advance` | 8, 16 et 32 équipes jusqu'à la finale |
| Mêmes règles sur toutes les tables (score cible, temps par tour, contrée à la volée), **aucun robot**, aucune mise débitée | tables de rencontre | intégration + navigateur |
| Coupure : reprise pendant le délai annoncé ; absence prolongée ou abandon : **forfait** de l'équipe | serveur | intégration + navigateur |
| Récompenses (badges, cadre d'avatar, dos de cartes, tapis exclusifs) annoncées sur la fiche et **attribuées une seule fois** | `progression.award` | unitaires + intégration |
| Historique : journal des inscriptions, résultats, reports, forfaits et actions d'administration | Administration › Tournois › Détails | intégration |
| Notifications : confirmation d'inscription, rappel 1 h avant, invitation à confirmer 15 min avant, « Votre table est prête, rejoignez la partie ! », table suivante prête, report/annulation, forfait, fin | boîte de notifications + push | unitaires (dédoublonnage, inscriptions tardives, échec d'envoi non bloquant) |
| Web Push chiffré (RFC 8291) signé VAPID ; lien direct vers le tournoi (`/?tournoi=…`), après connexion si nécessaire | `src/push.js`, `public/sw.js` | chiffrement et signature vérifiés |
| Écrans Night VIP : liste, fiche, inscription, salon d'attente, tableau par tour, table, résultats, notifications | `public/app.js` | captures téléphone |

Les horaires sont affichés dans le fuseau de l'appareil du joueur ; le fuseau de référence
est rappelé sur la fiche. Les notifications envoyées par le serveur utilisent le fuseau
transmis par l'appareil du joueur.

## Configuration externe encore nécessaire

Sans configuration, tout fonctionne avec la **boîte de notifications intégrée**
(cloche de la page Tournois, et messages à l'écran) : aucun rappel n'est perdu.

### 1. Push navigateur (ordinateur, Android, iPhone/iPad)

1. `npm run vapid` génère une paire de clés.
2. Dans Railway › Variables : `BELOTE_VAPID_PUBLIC_KEY`, `BELOTE_VAPID_PRIVATE_KEY`,
   `BELOTE_VAPID_SUBJECT` (`mailto:` d'un contact). Ne jamais les écrire dans le dépôt.
3. Redéployer. L'administration indique « Push navigateur ✓ configuré ».

L'autorisation est demandée au moment de l'inscription à un tournoi. Sur **iPhone/iPad**,
Apple n'autorise le push web que pour un site **ajouté à l'écran d'accueil** (iOS 16.4+) :
le manifeste et les icônes sont fournis.

### 2. Push des applications iOS et Android (Capacitor)

1. Créer un projet **Firebase**, y ajouter les applications Android et iOS.
2. iOS : clé APNs (Apple Developer › Keys) téléversée dans Firebase, capacité
   « Push Notifications » activée dans Xcode.
3. Android : `google-services.json` dans le projet Android.
4. Installer `@capacitor/push-notifications` : l'application détecte le plugin, demande
   l'autorisation à l'inscription et envoie le jeton à `POST /api/push/subscribe`.
5. Dans Railway : `FCM_SERVICE_ACCOUNT` = JSON du compte de service Firebase
   (rôle « Firebase Cloud Messaging API Admin »).

Recommandation pour les applications : configurer Capacitor avec
`server: { url: "https://<votre-domaine>" }` afin que l'application charge le site
officiel : même compte, même portefeuille, mêmes cookies de session que le web.

### 3. Administration

Les tournois se gèrent dans Administration (clé `BELOTE_ADMIN_KEY`, variable d'environnement
uniquement). Réservée aux personnes qui détiennent cette clé ; des comptes administrateurs
nominatifs restent une évolution possible.

## Limites de cette première version

- Pas de frais d'inscription ni de mise : les récompenses sont des objets visuels.
- Une seule instance serveur (stockage JSON) : la programmation tourne dans ce processus et
  reprend après un redémarrage à partir des dates enregistrées.
- Temps de tour dépassé : passe ou première carte autorisée jouée automatiquement (règle
  annoncée), sans robot.
