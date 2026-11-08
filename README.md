# Omni-Cooking

Application web progressive (PWA) de gestion de recettes de cuisine, faisant partie de l'écosystème **Omni-Système** de Ferrus Dantioch. Développée par Ferrus Dantioch avec l'aide de l'IA.

- **100 % hors ligne** : aucun serveur, aucune IA intégrée ; les données sont stockées localement (localStorage).
- **Vanilla HTML/CSS/JS** : aucune dépendance lourde.
- **Charte Omni-Système** : violet nuit `#14111d`, accent `#a777ff`, polices Oxanium / Literata / JetBrains Mono.

## Fonctionnalités

- Créer, modifier, **dupliquer**, supprimer des recettes (avec annulation possible) : nom, **étiquettes**, **photo du plat** (compressée localement), ingrédients avec quantités et unités (g, kg, ml, l, c.à.s, c.à.c, pincée, pièce, **quantité fixe** non mise à l'échelle), temps de préparation et de cuisson, température (affichage **°C ou °F**, mode four traditionnel ou chaleur tournante), parts de base, instructions.
- Ajustement automatique des quantités selon le nombre de parts, avec arrondi intelligent et fractions utiles (½, ⅓, ¼).
- **Recherche** par nom, ingrédient, étiquette ou instruction ; **filtres** par temps total et par étiquette ; **tri** (récent, A→Z, temps).
- Liste de courses : ajout ingrédient par ingrédient, en bloc ou manuel, **regroupée par rayon de magasin**, cases à cocher, **articles récurrents** toujours proposés, copie presse-papiers, vidage.
- Mode « cuisson » plein écran : température, étapes en gros caractères cochables, **plusieurs minuteurs simultanés** + **minuteur par étape**, écran maintenu allumé.
- **Partage** d'une recette (texte complet) et **impression**.
- Thèmes clair, sombre et sombre/violet, réglage de luminosité, **bouton Installer** quand le navigateur le propose.
- Raccourcis clavier (« / » recherche, « n » nouvelle recette), annonces lecteur d'écran, contrastes conformes.
- Stockage **IndexedDB** (migration automatique depuis localStorage), export / import JSON (sauvegarde automatique avant import + migration entre appareils).
- Bouton de mise à jour quand une nouvelle version est disponible (cache du service worker nommé par empreinte du contenu).

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique de l'application (toutes les vues) |
| `css/styles.css` | Charte graphique Omni-Système, 3 thèmes, responsive tablette d'abord, impression |
| `js/app.js` | Logique complète (recettes, quantités, courses, mode cuisson, stockage IndexedDB, photos, mises à jour) |
| `scripts/validate.mjs` | Script de validation utilisé par la CI |
| `manifest.webmanifest` | Manifeste PWA (installation) |
| `sw.js` | Service worker (hors ligne ; nom de cache = empreinte SHA-256 du contenu) |
| `.github/workflows/validate.yml` | CI de validation à chaque pull request |
| `icons/` | Icônes adaptatives (d20 violet nuit : SVG, PNG 192/512, maskable) |
| `LICENSE` | Licence Omni-Système du code (CC BY-NC-ND 4.0, © 2026 Ferrus Dantioch) |

## Mode d'emploi

### Installer Omni-Cooking (PWA)

1. Ouvrez l'adresse de l'application dans un navigateur récent (Chrome, Edge, Firefox, Safari…).
2. **Ordinateur (Chrome/Edge)** : cliquez sur l'icône « Installer » dans la barre d'adresse, ou menu ⋮ → « Installer Omni-Cooking ».
3. **iPhone / iPad (Safari)** : touchez le bouton Partager, puis « Sur l'écran d'accueil ».
4. **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil » ou « Installer l'application ».

Une fois installée, l'application se lance depuis son icône et fonctionne **même sans connexion**.

### Sauvegarder ses données (export)

Réglages → « Exporter en JSON » : un fichier `omni-cooking-AAAA-MM-JJ.json` est téléchargé. Conservez-le (clé USB, cloud, e-mail à vous-même…).

### Restaurer ses données (import)

Sur l'appareil de destination, ouvrez Omni-Cooking, puis Réglages → « Importer un JSON » et choisissez le fichier exporté. Les recettes et la liste de courses actuelles sont remplacées (confirmation demandée).

### Mettre à jour l'application

Quand une nouvelle version est disponible, un bouton « Mise à jour disponible » apparaît dans la barre de navigation (tous onglets) et dans Réglages. Touchez-le, puis laissez la page se recharger : la nouvelle version est active.

## Licence

Code distribué sous **CC BY-NC-ND 4.0** (© 2026 Ferrus Dantioch) — voir le fichier [LICENSE](LICENSE) (texte officiel anglais suivi de la traduction française officielle). Partage autorisé en citant l'auteur ; usage commercial, modification et œuvres dérivées interdits.
