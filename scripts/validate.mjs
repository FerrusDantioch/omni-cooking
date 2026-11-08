#!/usr/bin/env node
/* ============================================================
   Omni-Cooking — script de validation (utilisé par la CI)
   Vérifie, sans aucune dépendance externe :
   - la syntaxe de js/app.js et sw.js (node --check)
   - la validité du manifest et l'existence de ses icônes
   - l'existence de tous les fichiers mis en cache par sw.js
   - la cohérence des id HTML utilisés par js/app.js
   - les références locales de index.html (css, js, icônes…)
   - les règles de calcul des quantités (arrondi, fractions)
   - la présence de la LICENSE Omni-Système
   ============================================================ */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lire = (p) => readFileSync(join(racine, p), 'utf8');

let echecs = 0;
function verifier(condition, label) {
  console.log((condition ? 'OK    ' : 'ECHEC ') + label);
  if (!condition) echecs++;
}

/* 1. Syntaxe JavaScript. */
for (const f of ['js/app.js', 'sw.js']) {
  try {
    execFileSync(process.execPath, ['--check', join(racine, f)], { stdio: 'pipe' });
    verifier(true, 'syntaxe ' + f);
  } catch (e) {
    verifier(false, 'syntaxe ' + f + ' : ' + e.stderr?.toString().split('\n')[0]);
  }
}

/* 2. Manifest : JSON valide, nommage conforme, icônes présentes. */
let manifest = null;
try {
  manifest = JSON.parse(lire('manifest.webmanifest'));
  verifier(true, 'manifest.webmanifest : JSON valide');
} catch (e) {
  verifier(false, 'manifest.webmanifest : JSON invalide (' + e.message + ')');
}
if (manifest) {
  verifier(manifest.name === 'Omni-Cooking', 'manifest name = "Omni-Cooking"');
  verifier(manifest.short_name === 'OmniCooking', 'manifest short_name = "OmniCooking"');
  verifier(manifest.display === 'standalone', 'manifest display = standalone');
  verifier(existsSync(join(racine, manifest.start_url)), 'manifest start_url existe : ' + manifest.start_url);
  for (const icone of manifest.icons || []) {
    verifier(existsSync(join(racine, icone.src)), 'icône présente : ' + icone.src + ' (' + icone.sizes + ', ' + icone.purpose + ')');
  }
  const masquables = (manifest.icons || []).filter((i) => i.purpose === 'maskable');
  verifier(masquables.length > 0, 'au moins une icône maskable');
}

/* 3. Tous les fichiers du cache du service worker existent. */
const sw = lire('sw.js');
const bloc = sw.match(/const COQUILLE = \[([\s\S]*?)\];/);
verifier(!!bloc, 'sw.js : tableau COQUILLE trouvé');
if (bloc) {
  const fichiers = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const f of fichiers) {
    const chemin = f === './' ? 'index.html' : f.replace(/^\.\//, '');
    verifier(existsSync(join(racine, chemin)), 'fichier en cache par sw.js : ' + f);
  }
}

/* 4. Les id utilisés par js/app.js existent dans index.html. */
const app = lire('js/app.js');
const html = lire('index.html');
const idsHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsJs = new Set([...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]));
const manquants = [...idsJs].filter((id) => !idsHtml.has(id));
verifier(manquants.length === 0, 'id utilisés par app.js présents dans index.html' + (manquants.length ? ' — manquants : ' + manquants.join(', ') : ''));

/* 5. Références locales de index.html (src/href) : tout existe. */
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((r) => !r.startsWith('http') && !r.startsWith('#') && !r.startsWith('data:'));
for (const r of refs) verifier(existsSync(join(racine, r)), 'ressource référencée : ' + r);
verifier(html.includes('<title>Omni-Cooking</title>'), 'titre de l\'onglet = Omni-Cooking');
verifier(html.includes('manifest.webmanifest'), 'index.html référence le manifest');
verifier(html.includes('js/app.js'), 'index.html charge js/app.js');
verifier(html.includes('css/styles.css'), 'index.html charge css/styles.css');

/* 6. Règles de calcul des quantités (fonctions pures de app.js). */
const require = createRequire(import.meta.url);
const q = require('../js/app.js');
const f = (ing, parts, base) => {
  const r = q.quantiteMiseAJour(ing, parts, base);
  return q.formaterQuantite(r.q, r.unite);
};
const cas = [
  ['375 g', f({ quantite: 250, unite: 'g' }, 6, 4), '250 g x 6/4 (exemple du cahier)'],
  ['125 g', f({ quantite: 250, unite: 'g' }, 2, 4), '250 g x 2/4'],
  ['1,5 kg', f({ quantite: 1, unite: 'kg' }, 6, 4), '1 kg x 6/4'],
  ['1½ pièce', f({ quantite: 1, unite: 'pièce' }, 6, 4), '1 pièce x 6/4'],
  ['⅓ c.à.s', f({ quantite: 1, unite: 'c.à.s' }, 1, 3), '1 c.à.s x 1/3'],
  ['2 c.à.s', f({ quantite: 3, unite: 'c.à.s' }, 2, 3), '3 c.à.s x 2/3'],
  ['11,5 ml', f({ quantite: 15, unite: 'ml' }, 3, 4), '15 ml x 3/4'],
  ['1 l', f({ quantite: 500, unite: 'ml' }, 8, 4), '500 ml x 8/4'],
  ['¼ pincée', f({ quantite: 1, unite: 'pincée' }, 1, 4), '1 pincée x 1/4']
];
for (const [attendu, obtenu, label] of cas) verifier(obtenu === attendu, label + ' -> ' + JSON.stringify(obtenu));
verifier(q.UNITES.includes('c.à.s') && q.UNITES.includes('pièce'), 'unités conformes au cahier (g, kg, ml, l, c.à.s, c.à.c, pincée, pièce)');

/* 7. Licence Omni-Système. */
const licence = lire('LICENSE');
verifier(licence.includes('Attribution-NonCommercial-NoDerivatives 4.0'), 'LICENSE : CC BY-NC-ND 4.0 (texte officiel)');
verifier(licence.includes('Ferrus Dantioch'), 'LICENSE : mentionne Ferrus Dantioch');
verifier(html.includes('Ferrus Dantioch') && html.includes('aide de l\'IA'), 'écran À propos : auteur + aide de l\'IA');

console.log('---');
if (echecs > 0) {
  console.error(echecs + ' vérification(s) en échec');
  process.exit(1);
}
console.log('Toutes les vérifications passent.');
