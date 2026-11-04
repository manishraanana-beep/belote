# Règles pour l'intégration Figma (MCP)

Ce projet n'a **ni React, ni build, ni CSS-in-JS**. Toute génération Figma→code doit être adaptée à ces patterns, pas transposée depuis un stack moderne type Next.js/Tailwind.

## 1. Tokens de design

- Définis en **CSS custom properties** dans `public/style.css`, sous `:root { ... }` (ligne ~12) : couleurs (`--bg-1`, `--panel`, `--gold`, `--us`/`--them`, `--felt-1..3`, `--rim-1..2`, `--red-suit`...), polices (`--title`, `--logo`, `--ui`), sécurité d'écran (`--safe-t`/`--safe-b`).
- **Thèmes** = re-déclaration des mêmes variables sous un sélecteur de classe/attribut : `.theme-vip`, `body.night-vip`, `:root[data-skin="arcade"]` (ligne ~1926, préfixe `--a-*`). Aucune valeur en dur dans les composants : toujours une `var(--...)`.
- Pas de transformateur de tokens (pas de Style Dictionary/Tokens Studio). Un token Figma = une variable CSS ajoutée/modifiée à la main dans `:root`.
- Polices : `@font-face` en tête de fichier (`/fonts/*.woff2` — Cinzel, Alegreya, Fira Sans Condensed, Baloo 2 pour le thème arcade).

## 2. Composants UI

- **Pas de fichiers composants** ni de Storybook. Tout est dans `public/app.js` (4000+ lignes) :
  - une **page** = une fonction `xxxPage()` qui retourne une chaîne HTML (template literals) ;
  - des **helpers de rendu** réutilisables : `btn(label, action, cls, attrs)`, `icon(name, size)`, `coins(n)`, `fmt(n)`, `modal(...)`, `toast(...)`, `avatar(...)`, `logo(...)` ;
  - la **table de jeu** = `gameView()`.
- **Toujours réutiliser ces helpers** avant d'écrire du HTML brut pour un nouvel écran généré depuis Figma.
- Interactions : délégation d'événements, `switch` sur `data-action` (clics) ou sur l'`id` du `<form>` (formulaires) — pas de handlers inline, pas de composants avec state local à la React.

## 3. Frameworks & build

- **Vanilla JS (Node 22), zéro dépendance front, aucune étape de build.** `public/*.js` servi tel quel.
- Styling : **CSS global unique** `public/style.css` (2200+ lignes), pas de Tailwind, pas de CSS Modules, pas de styled-components.
- CSP stricte : **aucun style inline** (`style="..."` interdit). Tout changement dynamique passe par `element.style.setProperty(...)` ou l'ajout/retrait de classes CSS existantes.
- Un design importé de Figma doit donc être traduit en classes CSS ajoutées à `style.css` + template literal dans `app.js`, jamais en JSX/composants/styles inline.

## 4. Assets

- Images statiques dans `public/decor/` (illustrations, logos, tapis/dos de ville), `public/avatars/`, `public/shop/` (objets boutique : `shop/avatars`, `shop/emoji`), `public/cards/` (cartes à jouer), `public/icons/` (icônes PWA).
- Formats : `.webp` pour photos/illustrations (poids), `.svg` pour emblèmes/drapeaux/motifs vectoriels, `.png` uniquement pour les icônes d'app (`icon-192.png`, etc.).
- Référencées par chemin absolu direct dans les templates (`<img src="/decor/logo.webp">`), pas d'import de module ni de CDN externe.
- Pas d'optimisation automatique (pas de pipeline sharp/imagemin) : les fichiers sont déposés optimisés manuellement avant commit.

## 5. Icônes

- Fonction `icon(nom, taille)` dans `app.js`, rendue en **SVG inline** (pas de sprite externe, pas de bibliothèque comme lucide/heroicons chargée séparément).
- Nommage court en français/anglais fonctionnel (`"check"`, `"back"`, ...) correspondant à une définition SVG dans la fonction `icon()`.
- Toute icône Figma à intégrer doit être ajoutée comme un nouveau cas dans `icon()`, pas comme fichier `.svg` séparé sauf si c'est un asset de décor (drapeau, emblème).

## 6. Approche CSS

- Un seul fichier global, classes utilitaires + classes par composant (`.menu-card`, `.gold-btn`, `.seat`, `.bubble`...). Pas de méthodologie BEM stricte, pas de scoping automatique.
- **Thème Arcade** : second jeu de règles sous `:root[data-skin="arcade"]` en fin de fichier — code conservé mais inutilisé (tout le monde est en thème classique, décision de Jacques). Ne pas construire de nouveaux écrans sur ce thème.
- Responsive : media queries classiques + variables `--safe-t`/`--safe-b` (encoches mobiles) ; pas de framework responsive (pas de breakpoints Tailwind).

## 7. Structure du projet

```
public/
  app.js       → toute l'app client (pages, vues, actions)
  style.css    → tous les styles (thème arcade en fin de fichier)
  cards.js     → rendu des cartes
  tips.js      → astuces
  decor/ avatars/ shop/ cards/ icons/ fonts/ → assets statiques
src/
  server.js    → HTTP + WebSocket + back-office
  engine.js    → moteur de jeu + robots
  economy.js, accounts.js, tournaments.js, progression.js, shop.js, ... → logique métier
```

## Conséquences pour un import Figma→code

1. Ne jamais générer de composants React/JSX ni de fichiers `.module.css` : produire du HTML en template literal + classes dans `style.css`.
2. Extraire les couleurs du design comme variables `--xxx` ajoutées à `:root` (et dupliquées sous `.theme-vip`/`.theme-club` si le thème doit varier), jamais en valeurs codées en dur dans les règles.
3. Réutiliser `btn()`, `icon()`, `coins()`, `fmt()`, `modal()`, `toast()`, `avatar()` avant de créer un nouveau pattern.
4. Respecter la CSP : aucun `style="..."` généré.
5. Textes en français.
