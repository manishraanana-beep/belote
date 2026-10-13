# Site, App Store et Google Play : un seul compte, un seul serveur

Ce document décrit ce qui est **en place** dans le dépôt et ce qui demande encore une
**configuration externe** (comptes développeur, clés, publication).

## Principe

```
 Site web (navigateur) ─┐
 App iOS  (Capacitor)  ─┼──►  Serveur Node (src/server.js)  ──►  .data/ (JSON + photos)
 App Android (Capacitor)┘       règles, cartes, scores,
                                comptes, sessions, WebSocket
```

- Le **serveur reste l’unique arbitre** : distribution, règles, scores, validation des actions.
- Les trois supports affichent la **même interface web** (`public/`), sans framework ni build.
- Un **compte** (e-mail ou Apple/Google) est rattaché à un **profil joueur** : pseudo, avatar,
  photo, statistiques, historique et tables VIP créées. Se connecter sur un autre appareil
  ouvre le même profil.

## Ce qui est implémenté

| Fonction | Où | État |
|---|---|---|
| Profil invité immédiat (cookie HttpOnly) | `/api/session` | ✅ |
| Inscription e-mail + mot de passe (scrypt) | `POST /api/auth/register` | ✅ |
| Vérification de l’adresse (lien 48 h) | `GET /api/auth/verify` | ✅ |
| Connexion e-mail | `POST /api/auth/login` | ✅ |
| Mot de passe oublié / réinitialisation (lien 1 h, sessions révoquées) | `forgot`, `reset` | ✅ |
| Changement de mot de passe, déconnexion | `password`, `logout` | ✅ |
| Suppression du compte et des données | `POST /api/auth/delete` | ✅ |
| Connexion Apple / Google (vérification du jeton OpenID, RS256 + JWKS) | `POST /api/auth/oidc` | ✅ code, ⚙️ clés à fournir |
| Fusion invité → compte (parties et place reprises) | `src/accounts.js` | ✅ |
| Avatars illustrés du graphiste (9, repris des maquettes) + robots (4) | `public/avatars/` | ✅ |
| Photo personnelle recadrée (JPEG 256 px, ≤ 400 Ko) | `POST /api/avatar`, servie sur `/u/…` | ✅ |
| Envoi des e-mails | Resend si configuré, sinon journal serveur | ⚙️ |

Les sessions sont stockées hachées (SHA-256) ; les jetons de vérification et de réinitialisation
aussi. Les routes d’authentification sont limitées à 20 requêtes par minute et par adresse IP,
et vérifient l’origine.

## Variables d’environnement

| Variable | Rôle |
|---|---|
| `BELOTE_PUBLIC_URL` | Adresse publique utilisée dans les e-mails (ex. `https://appi-belote.up.railway.app`) |
| `RESEND_API_KEY`, `BELOTE_MAIL_FROM` | Envoi réel des e-mails (vérification, mot de passe oublié) |
| `GOOGLE_CLIENT_ID` | Identifiant(s) OAuth Google, séparés par des virgules (web, iOS, Android) |
| `APPLE_CLIENT_ID` | Service ID (web) et/ou Bundle ID (iOS), séparés par des virgules |
| `BELOTE_FILL_SECONDS` | Délai avant l’ajout de robots dans « Jouer maintenant » (8 s par défaut) |
| `BELOTE_SECURE_COOKIE` | `true` derrière HTTPS (Railway) |

Sans `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID`, les boutons sont affichés « bientôt » et l’API
répond 501. La politique de sécurité (CSP) n’autorise les domaines Apple et Google que
lorsque la connexion correspondante est configurée.

## Configuration externe restante

1. **E-mails** : créer un compte Resend (ou équivalent), vérifier le domaine d’envoi,
   renseigner `RESEND_API_KEY` et `BELOTE_MAIL_FROM`.
2. **Google** : Google Cloud Console → identifiants OAuth « Application Web » (origine
   autorisée = domaine du site) + identifiants iOS et Android pour les applications.
3. **Apple** : Apple Developer (99 $/an) → App ID avec « Sign in with Apple », Service ID
   pour le web (domaine + URL de retour), clé. Apple impose Sign in with Apple dès qu’une
   connexion Google est proposée dans l’app iOS (règle 4.8).
4. **Applications mobiles** (non créées dans ce dépôt) : recommandation **Capacitor** :
   - `npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`, `npx cap init`,
     `webDir: "public"`, puis `npx cap add ios` / `android`.
   - L’interface est embarquée dans l’app ; le serveur reste celui de Railway
     (`connect-src` vers son domaine). Les cookies de session fonctionnent en origine
     identique ; pour une app embarquée, prévoir une variante de session par en-tête
     `Authorization: Bearer` (non implémentée à ce jour).
   - Connexion native : plugins `@capacitor-community/apple-sign-in` et Google ; le jeton
     d’identité obtenu est envoyé tel quel à `POST /api/auth/oidc`, déjà prêt.
   - Publication : comptes Apple Developer et Google Play Console, fiches, captures,
     politique de confidentialité, gestion de la suppression de compte (déjà fournie).
5. **Montée en charge** : une seule instance et un stockage JSON. Pour les stores, passer à
   une base (Postgres est déjà présent sur Railway) et à des sessions partagées si plusieurs
   instances.
