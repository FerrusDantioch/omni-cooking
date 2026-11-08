/* ============================================================
   Omni-Cooking — application (JavaScript vanilla, sans dépendance)
   Gestion de recettes : création / modification / suppression,
   ajustement des quantités selon le nombre de parts, liste de
   courses, recherche, mode cuisson avec minuteur, thèmes,
   luminosité, export/import JSON, mises à jour de la PWA.
   Stockage : localStorage (100 % local, aucun serveur).
   ============================================================ */
'use strict';

/* ------------------------------------------------------------
   1. Utilitaires
   ------------------------------------------------------------ */

/* Création d'un élément DOM : el('button', {class:'bouton', onclick:…}, 'Texte') */
function el(tag, attrs, ...enfants) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [cle, valeur] of Object.entries(attrs)) {
      if (cle === 'class') n.className = valeur;
      else if (cle === 'text') n.textContent = valeur;
      else if (cle.startsWith('on') && typeof valeur === 'function') n.addEventListener(cle.slice(2), valeur);
      else if (valeur !== null && valeur !== undefined && valeur !== false) n.setAttribute(cle, valeur === true ? '' : valeur);
    }
  }
  for (const enfant of enfants.flat(9)) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    n.append(enfant.nodeType ? enfant : document.createTextNode(String(enfant)));
  }
  return n;
}

/* Identifiant unique court. */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Normalisation pour la recherche : minuscules, sans accents. */
function normaliserTexte(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/* Formatage d'un nombre en français (virgule décimale). */
function formatNombre(q) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(q);
}

/* Températures : stockées en °C, affichées selon le réglage (°C ou °F). */
function cVersF(c) { return Math.round(c * 9 / 5 + 32); }
function fVersC(f) { return Math.round((f - 32) * 5 / 9); }
function uniteTemp() { return donnees.reglages.uniteTemp === 'F' ? 'F' : 'C'; }
function formaterTemperature(tC) {
  if (tC === null || tC === undefined) return '';
  if (uniteTemp() === 'F') return cVersF(tC) + ' °F';
  return tC + ' °C';
}
function temperatureSecondaire(tC) {
  if (tC === null || tC === undefined) return '';
  return uniteTemp() === 'F' ? ' (' + tC + ' °C)' : ' (' + cVersF(tC) + ' °F)';
}

/* ------------------------------------------------------------
   2. Quantités : unités, arrondi intelligent, fractions
   ------------------------------------------------------------ */

const UNITES = ['g', 'kg', 'ml', 'l', 'c.à.s', 'c.à.c', 'pincée', 'pièce'];
/* Unités « dénombrables » : on y affiche des fractions (½, ⅓, ¼…). */
const UNITES_DENOMBRABLES = ['pièce', 'pincée', 'c.à.s', 'c.à.c'];

/* Unité de base pour les conversions : kg -> g, l -> ml. */
function uniteBase(unite) {
  return unite === 'kg' ? 'g' : unite === 'l' ? 'ml' : unite;
}
function versBase(q, unite) {
  return unite === 'kg' ? q * 1000 : unite === 'l' ? q * 1000 : q;
}

/* Conversion inverse pour l'affichage : 1500 g -> 1,5 kg, 1200 ml -> 1,2 l. */
function normaliserAffichage(q, unite) {
  if (unite === 'g' && q >= 1000) return { q: q / 1000, unite: 'kg' };
  if (unite === 'ml' && q >= 1000) return { q: q / 1000, unite: 'l' };
  if (unite === 'kg' && q < 1) return { q: q * 1000, unite: 'g' };
  if (unite === 'l' && q < 1) return { q: q * 1000, unite: 'ml' };
  return { q, unite };
}

/* Arrondi « intelligent » selon la grandeur :
   >= 100 -> multiple de 5 ; >= 20 -> entier ; >= 10 -> demi ; sinon quart. */
function arrondirQuantite(q) {
  if (q >= 100) return Math.round(q / 5) * 5;
  if (q >= 20) return Math.round(q);
  if (q >= 10) return Math.round(q * 2) / 2;
  return Math.round(q * 4) / 4;
}

/* Arrondi adapté à l'unité : les unités dénombrables (pièce, pincée, c.à.s, c.à.c)
   sont arrondies au douzième pour préserver les fractions utiles (⅓, ⅔…). */
function arrondirSelonUnite(q, unite) {
  return UNITES_DENOMBRABLES.includes(unite) ? Math.round(q * 12) / 12 : arrondirQuantite(q);
}

/* Fractions utiles pour les unités dénombrables : 1,5 -> « 1½ », 0,33 -> « ⅓ ». */
const FRACTIONS = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
function formaterDenombrable(q) {
  const partie = Math.floor(q + 1e-9);
  const reste = q - partie;
  if (reste < 0.04) return String(partie);
  for (const [valeur, glyphe] of FRACTIONS) {
    if (Math.abs(reste - valeur) < 0.05) return (partie > 0 ? String(partie) : '') + glyphe;
  }
  return formatNombre(q);
}

/* Affichage d'une quantité avec son unité (ex. : « 375 g », « 1½ pièce »). */
function formaterQuantite(q, unite) {
  const n = normaliserAffichage(q, unite);
  if (UNITES_DENOMBRABLES.includes(n.unite)) return formaterDenombrable(n.q) + ' ' + n.unite;
  return formatNombre(n.q) + ' ' + n.unite;
}

/* Quantité d'un ingrédient recalculée pour `parts` parts
   (recette de base : `partsBase` parts), avec arrondi intelligent. */
function quantiteMiseAJour(ingredient, parts, partsBase) {
  /* Ingrédient à « quantité fixe » (sel, poivre, liant…) : jamais mis à l'échelle. */
  if (ingredient.fixe) return normaliserAffichage(ingredient.quantite, ingredient.unite);
  const facteur = parts / partsBase;
  const q = arrondirSelonUnite(ingredient.quantite * facteur, ingredient.unite);
  return normaliserAffichage(q, ingredient.unite);
}

/* ------------------------------------------------------------
   3. Stockage local (localStorage) et état de l'application
   ------------------------------------------------------------ */

const CLE_STOCKAGE = 'omni-cooking-v1';
const VERSION_DONNEES = 1;

/* Toutes les données de l'application. */
let donnees = {
  recettes: [],   // voir structure d'une recette ci-dessous
  courses: [],    // { id, nom, quantite, unite, coche, recurrente }
  reglages: { theme: 'nuit', luminosite: 100, tri: 'modifie', uniteTemp: 'C' }
};

/* Structure d'une recette :
   { id, nom, partsBase, partsActuelles, tempsPreparation, tempsCuisson,
     temperature (number ou null), modeFour ('traditionnel'|'tournante'),
     ingredients: [{ id, nom, quantite, unite }], instructions,
     creeLe, modifieLe } */

function sauvegarder() {
  try {
    localStorage.setItem(CLE_STOCKAGE, JSON.stringify(donnees));
  } catch (e) {
    console.error('Omni-Cooking : sauvegarde impossible', e);
    /* Quota dépassé ou stockage indisponible : prévenir l'utilisateur. */
    if (typeof document !== 'undefined') {
      toast('⚠ Stockage plein : exportez vos données en JSON depuis les Réglages pour ne rien perdre.');
    }
  }
}

/* Normalise une recette lue depuis le stockage ou un import. */
function normaliserRecette(r) {
  return {
    id: r.id || uid(),
    nom: String(r.nom || 'Sans titre'),
    partsBase: Math.max(1, parseInt(r.partsBase, 10) || 4),
    partsActuelles: Math.max(1, parseInt(r.partsActuelles, 10) || Math.max(1, parseInt(r.partsBase, 10) || 4)),
    tempsPreparation: Math.max(0, parseInt(r.tempsPreparation, 10) || 0),
    tempsCuisson: Math.max(0, parseInt(r.tempsCuisson, 10) || 0),
    temperature: (r.temperature === null || r.temperature === undefined || r.temperature === '') ? null : Math.round(Number(r.temperature)),
    modeFour: r.modeFour === 'tournante' ? 'tournante' : 'traditionnel',
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : [])
      .filter((i) => i && i.nom && Number(i.quantite) > 0)
      .map((i) => ({ id: i.id || uid(), nom: String(i.nom), quantite: Number(i.quantite), unite: UNITES.includes(i.unite) ? i.unite : 'pièce', fixe: !!i.fixe })),
    etiquettes: [...new Set((Array.isArray(r.etiquettes) ? r.etiquettes : []).map((e) => String(e).trim()).filter(Boolean))].slice(0, 12),
    photo: !!r.photo,
    instructions: String(r.instructions || ''),
    creeLe: r.creeLe || new Date().toISOString(),
    modifieLe: r.modifieLe || new Date().toISOString()
  };
}

/* Charge les données ; au tout premier lancement, propose une recette de démonstration. */
function chargerDonnees() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (brut === null) {
      donnees.recettes = [recetteDemo()];
      sauvegarder();
      return;
    }
    const lu = JSON.parse(brut);
    donnees = {
      recettes: (lu.recettes || []).map(normaliserRecette),
      courses: (lu.courses || [])
        .filter((c) => c && c.nom)
        .map((c) => ({ id: c.id || uid(), nom: String(c.nom), quantite: Number(c.quantite) || 0, unite: uniteBase(UNITES.includes(c.unite) ? c.unite : 'pièce'), coche: !!c.coche, recurrente: !!c.recurrente })),
      reglages: Object.assign({ theme: 'nuit', luminosite: 100, tri: 'modifie', uniteTemp: 'C' }, lu.reglages || {})
    };
  } catch (e) {
    console.error('Omni-Cooking : données illisibles, réinitialisation', e);
    donnees = { recettes: [recetteDemo()], courses: [], reglages: { theme: 'nuit', luminosite: 100, tri: 'modifie', uniteTemp: 'C' } };
  }
}

/* Recette de démonstration affichée au premier lancement (supprimable). */
function recetteDemo() {
  return {
    id: uid(),
    nom: 'Crêpes maison',
    partsBase: 4,
    partsActuelles: 4,
    tempsPreparation: 10,
    tempsCuisson: 20,
    temperature: null, // cuisson à la poêle, pas de four
    modeFour: 'traditionnel',
    etiquettes: ['petit-déjeuner', 'rapide'],
    photo: false,
    ingredients: [
      { id: uid(), nom: 'farine', quantite: 250, unite: 'g' },
      { id: uid(), nom: 'lait', quantite: 500, unite: 'ml' },
      { id: uid(), nom: 'œufs', quantite: 3, unite: 'pièce' },
      { id: uid(), nom: 'sucre', quantite: 2, unite: 'c.à.s' },
      { id: uid(), nom: 'sel', quantite: 1, unite: 'pincée', fixe: true }
    ],
    instructions: 'Mélanger la farine, le sucre et le sel dans un saladier.\nCreuser un puits, casser les œufs au centre et mélanger.\nVerser le lait progressivement en fouettant pour éviter les grumeaux.\nLaisser reposer 30 minutes si possible.\nCuire les crêpes à feu moyen, 1 à 2 minutes par face.',
    creeLe: new Date().toISOString(),
    modifieLe: new Date().toISOString()
  };
}

/* ------------------------------------------------------------
   4. Recherche et filtres
   ------------------------------------------------------------ */

let rechercheTexte = '';
let filtreTemps = 'tous';
let etiquetteActive = null; // filtre par étiquette (une seule active à la fois)

function recettesFiltrees() {
  const recherche = normaliserTexte(rechercheTexte);
  const max = filtreTemps === 'tous' ? Infinity : parseInt(filtreTemps, 10);
  const tri = donnees.reglages.tri || 'modifie';
  const liste = donnees.recettes.filter((r) => {
    const total = r.tempsPreparation + r.tempsCuisson;
    if (total > max) return false;
    if (etiquetteActive && !r.etiquettes.some((e) => normaliserTexte(e) === normaliserTexte(etiquetteActive))) return false;
    if (!recherche) return true;
    if (normaliserTexte(r.nom).includes(recherche)) return true;
    if (normaliserTexte(r.instructions).includes(recherche)) return true;
    if (r.etiquettes.some((e) => normaliserTexte(e).includes(recherche))) return true;
    return r.ingredients.some((i) => normaliserTexte(i.nom).includes(recherche));
  });
  const cmp = {
    nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
    temps: (a, b) => (a.tempsPreparation + a.tempsCuisson) - (b.tempsPreparation + b.tempsCuisson),
    modifie: (a, b) => String(b.modifieLe).localeCompare(String(a.modifieLe))
  }[tri] || ((a, b) => String(b.modifieLe).localeCompare(String(a.modifieLe)));
  return liste.sort(cmp);
}

/* Toutes les étiquettes utilisées, triées pour les puces de filtre. */
function toutesEtiquettes() {
  const set = new Set();
  for (const r of donnees.recettes) for (const e of r.etiquettes) set.add(e);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* ------------------------------------------------------------
   5. Liste de courses
   ------------------------------------------------------------ */

function cleCourse(nom, unite) {
  return normaliserTexte(nom) + '|' + uniteBase(unite);
}

/* Rayons de magasin : le premier motif trouvé dans le nom de l'article gagne. */
const RAYONS = [
  ['Fruits et légumes', /pomme|poire|banane|orange|citron|fraise|framboise|myrtille|raisin|pêche|abricot|prune|cerise|melon|pastèque|carotte|oignon|ail|échalote|tomate|salade|laitue|épinard|poireau|courgette|poivron|aubergine|concombre|champignon|avocat|haricot|petit pois|maïs|céleri|navet|radis|betterave|chou|fenouil|potiron|courge|patate|pomme de terre|asperge|artichaut|fruit|légume|herbe|persil|basilic|menthe|coriandre|ciboulette/i],
  ['Boulangerie et céréales', /farine|pain|baguette|pâte|pâtes|riz|semoule|quinoa|avoine|céréale|levure|couscous|polenta|nouille|spaghetti|penne|macaroni|lasagne|tagliatelle|brioche|croissant|blé|sarrasin|millet/i],
  ['Crèmerie et œufs', /lait|crème|beurre|fromage|yaourt|yogourt|œuf|oeuf|mascarpone|mozzarella|parmesan|gruyère|emmental|chèvre|chantilly/i],
  ['Viandes et poissons', /poulet|bœuf|boeuf|porc|veau|agneau|mouton|jambon|lardon|saucisse|steak|haché|escalope|dinde|canard|thon|saumon|cabillaud|merlu|maquereau|sardine|anchois|crevette|moule|poisson|viande|magret|rillettes/i],
  ['Épicerie salée', /huile|vinaigre|sel|poivre|moutarde|ketchup|mayonnaise|sauce|épice|curry|paprika|cannelle|thym|laurier|romarin|concentré|cube|conserve|lentille|pois chiche|olive|câpre|cornichon|soja|nuoc mam/i],
  ['Épicerie sucrée', /sucre|miel|confiture|chocolat|vanille|cacao|pâte à tartiner|sirop|mélasse|cassonade|glace en poudre/i],
  ['Boissons', /eau|jus|vin|bière|cidre|soda|café|thé|tisane|limonade|boisson/i],
  ['Surgelés', /surgelé|sorbet/i],
  ['Hygiène et entretien', /sopalin|papier toilette|essuie-tout|éponge|lessive|savon|shampoing|dentifrice|sac poubelle|aluminium|film étirable|papier cuisson|bicarbonate/i]
];
function rayonDe(nom) {
  for (const [label, motif] of RAYONS) if (motif.test(nom)) return label;
  return 'Autres';
}

/* Ajoute une quantité à la liste de courses (fusion si l'ingrédient existe déjà). */
function ajouterAListe(nom, quantite, unite) {
  const baseU = uniteBase(unite);
  const qBase = versBase(quantite, unite);
  const cle = cleCourse(nom, baseU);
  const existant = donnees.courses.find((c) => cleCourse(c.nom, c.unite) === cle && !c.coche);
  if (existant) {
    const total = arrondirSelonUnite(existant.quantite + qBase, existant.unite);
    const n = normaliserAffichage(total, existant.unite);
    existant.quantite = n.q;
    existant.unite = n.unite;
  } else {
    donnees.courses.push({ id: uid(), nom: nom.trim(), quantite: qBase, unite: baseU, coche: false, recurrente: false });
  }
  sauvegarder();
}

/* Ajoute un article manuel (sans quantité) à la liste de courses. */
function ajouterArticleManuel(nom) {
  nom = String(nom || '').trim();
  if (!nom) return;
  donnees.courses.push({ id: uid(), nom, quantite: 0, unite: 'pièce', coche: false, recurrente: false });
  sauvegarder();
  toast('« ' + nom + ' » ajouté à la liste');
}

/* Ajoute tous les ingrédients d'une recette (quantités ajustées aux parts affichées). */
function ajouterRecetteAuxCourses(recette) {
  for (const ing of recette.ingredients) {
    const q = quantiteMiseAJour(ing, recette.partsActuelles, recette.partsBase);
    ajouterAListe(ing.nom, q.q, q.unite);
  }
  sauvegarder();
}

/* Regroupe la liste par ingrédient (nom + unité) pour l'affichage. */
function coursesAgregees() {
  const groupes = new Map();
  for (const item of donnees.courses) {
    const cle = cleCourse(item.nom, item.unite);
    if (!groupes.has(cle)) groupes.set(cle, { nom: item.nom, unite: uniteBase(item.unite), quantite: 0, coche: true, recurrente: false, ids: [] });
    const g = groupes.get(cle);
    g.quantite = arrondirSelonUnite(g.quantite + versBase(item.quantite, item.unite), g.unite);
    g.coche = g.coche && item.coche;
    g.recurrente = g.recurrente || !!item.recurrente;
    g.ids.push(item.id);
  }
  for (const g of groupes.values()) g.rayon = rayonDe(g.nom);
  /* Tri par rayon (ordre du magasin), puis par nom. */
  const ordre = RAYONS.map(([label]) => label);
  ordre.push('Autres');
  return [...groupes.values()].sort((a, b) => {
    const ra = ordre.indexOf(a.rayon), rb = ordre.indexOf(b.rayon);
    if (ra !== rb) return ra - rb;
    return a.nom.localeCompare(b.nom, 'fr');
  });
}

/* ------------------------------------------------------------
   6. Vues : accueil, fiche recette, formulaire, courses
   ------------------------------------------------------------ */

const VUES = ['accueil', 'fiche', 'formulaire', 'courses', 'reglages', 'apropos'];

function afficherVue(nom) {
  for (const v of VUES) {
    document.getElementById('vue-' + v).hidden = v !== nom;
  }
  document.querySelectorAll('.nav a').forEach((a) => {
    const cible = a.getAttribute('href');
    const actif = (nom === 'accueil' && cible === '#/') ||
      (nom !== 'accueil' && cible === '#/' + nom) ||
      (nom === 'fiche' && cible === '#/') ||
      (nom === 'formulaire' && cible === '#/') ||
      (cible === '#/' + nom);
    if (actif) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
}

function tempsTotal(r) {
  return r.tempsPreparation + r.tempsCuisson;
}

function puceTexte(icone, texte) {
  return el('li', { class: 'puce' }, icone + ' ', el('b', { text: texte }));
}

/* ---------- Accueil : cartes des recettes filtrées ---------- */
function rendreAccueil() {
  const liste = document.getElementById('liste-recettes');
  liste.textContent = '';
  const recettes = recettesFiltrees();
  document.getElementById('aucune-recette').hidden = recettes.length > 0;

  /* Puces de filtre par étiquette. */
  const barreEtiquettes = document.getElementById('filtres-etiquettes');
  barreEtiquettes.textContent = '';
  const etiquettes = toutesEtiquettes();
  barreEtiquettes.hidden = etiquettes.length === 0;
  if (etiquettes.length > 0) {
    barreEtiquettes.append(el('button', {
      class: 'puce-filtre' + (etiquetteActive === null ? ' active' : ''), type: 'button',
      'aria-pressed': etiquetteActive === null ? 'true' : 'false',
      onclick: () => { etiquetteActive = null; rendreAccueil(); }
    }, 'Toutes'));
    for (const e of etiquettes) {
      const active = normaliserTexte(e) === normaliserTexte(etiquetteActive || '');
      barreEtiquettes.append(el('button', {
        class: 'puce-filtre' + (active ? ' active' : ''), type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => { etiquetteActive = active ? null : e; rendreAccueil(); }
      }, e));
    }
  }

  for (const r of recettes) {
    const puces = el('ul', { class: 'puces' },
      puceTexte('⏱', tempsTotal(r) + ' min'),
      puceTexte('👥', r.partsBase + (r.partsBase > 1 ? ' parts' : ' part')),
      puceTexte('🧺', r.ingredients.length + (r.ingredients.length > 1 ? ' ingrédients' : ' ingrédient'))
    );
    if (r.temperature) puces.append(puceTexte('🌡', formaterTemperature(r.temperature) + temperatureSecondaire(r.temperature)));
    if (r.etiquettes.length > 0) puces.append(el('li', { class: 'puce' }, '🏷 ', el('b', { text: r.etiquettes.join(', ') })));
    liste.append(el('article', { class: 'carte-recette' },
      el('h2', {}, el('a', { href: '#/recette/' + r.id, text: r.nom })),
      puces,
      el('div', { class: 'actions' },
        el('a', { class: 'bouton-secondaire', href: '#/recette/' + r.id }, 'Ouvrir'),
        el('a', { class: 'bouton-secondaire', href: '#/recette/' + r.id + '/modifier' }, 'Modifier'),
        el('button', { class: 'bouton-secondaire', type: 'button', onclick: () => dupliquerRecette(r.id) }, 'Dupliquer'),
        el('button', { class: 'bouton-danger', type: 'button', onclick: () => supprimerRecette(r.id) }, 'Supprimer')
      )
    ));
  }
  document.getElementById('recherche').value = rechercheTexte;
  document.getElementById('filtre-temps').value = filtreTemps;
  document.getElementById('tri').value = donnees.reglages.tri || 'modifie';
}

/* Texte complet d'une recette (pour partage / copie / impression). */
function recetteEnTexte(r) {
  const lignes = [r.nom];
  const infos = ['Parts : ' + r.partsBase];
  if (r.tempsPreparation) infos.push('prépa ' + r.tempsPreparation + ' min');
  if (r.tempsCuisson) infos.push('cuisson ' + r.tempsCuisson + ' min');
  lignes.push(infos.join(' — '));
  if (r.temperature) {
    lignes.push('Four : ' + formaterTemperature(r.temperature) + temperatureSecondaire(r.temperature) +
      ' (' + (r.modeFour === 'tournante' ? 'chaleur tournante' : 'traditionnel') + ')');
  }
  if (r.etiquettes.length > 0) lignes.push('Étiquettes : ' + r.etiquettes.join(', '));
  lignes.push('', 'Ingrédients (pour ' + r.partsBase + (r.partsBase > 1 ? ' parts' : ' part') + ') :');
  for (const ing of r.ingredients) {
    lignes.push('• ' + formaterQuantite(ing.quantite, ing.unite) + ' ' + ing.nom + (ing.fixe ? ' (qte fixe)' : ''));
  }
  const etapes = r.instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (etapes.length > 0) {
    lignes.push('', 'Instructions :');
    etapes.forEach((e, i) => lignes.push((i + 1) + '. ' + e));
  }
  return lignes.join('\n');
}

/* Partage natif si disponible, sinon copie dans le presse-papiers. */
async function partagerRecette(r) {
  const texte = recetteEnTexte(r);
  if (navigator.share) {
    try {
      await navigator.share({ title: r.nom + ' — Omni-Cooking', text: texte });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // partage annulé par l'utilisateur
    }
  }
  try {
    await navigator.clipboard.writeText(texte);
    toast('Recette copiée dans le presse-papiers');
  } catch (e) {
    toast('Partage indisponible : ouvrez la recette et copiez son texte.');
  }
}

/* Duplique une recette (nouveaux identifiants, nom suffixé « (copie) »). */
function dupliquerRecette(id) {
  const r = donnees.recettes.find((x) => x.id === id);
  if (!r) return;
  const copie = normaliserRecette(JSON.parse(JSON.stringify({
    ...r,
    id: uid(),
    nom: r.nom + ' (copie)',
    creeLe: new Date().toISOString(),
    modifieLe: new Date().toISOString()
  })));
  copie.ingredients = copie.ingredients.map((i) => ({ ...i, id: uid() }));
  donnees.recettes.push(copie);
  sauvegarder();
  toast('Recette dupliquée : « ' + copie.nom + ' »');
  location.hash = '#/recette/' + copie.id;
}

/* Suppression avec annulation possible pendant 6 secondes. */
let derniereSuppression = null; // { recette, index, timer }

function supprimerRecette(id) {
  const index = donnees.recettes.findIndex((x) => x.id === id);
  if (index === -1) return;
  const r = donnees.recettes[index];
  donnees.recettes.splice(index, 1);
  sauvegarder();
  if (derniereSuppression) clearTimeout(derniereSuppression.timer);
  derniereSuppression = { recette: r, index, timer: null };
  toast('Recette « ' + r.nom + ' » supprimée', { label: 'Annuler', action: annulerSuppression });
  derniereSuppression.timer = setTimeout(() => { derniereSuppression = null; }, 6000);
  if (location.hash.indexOf('#/recette/' + id) === 0) location.hash = '#/';
  else router();
}

function annulerSuppression() {
  if (!derniereSuppression) return;
  clearTimeout(derniereSuppression.timer);
  const { recette, index } = derniereSuppression;
  donnees.recettes.splice(Math.min(index, donnees.recettes.length), 0, recette);
  derniereSuppression = null;
  sauvegarder();
  toast('Suppression annulée : « ' + recette.nom + ' » restaurée');
  router();
}

/* ---------- Fiche d'une recette ---------- */
function rendreFiche(id) {
  const r = donnees.recettes.find((x) => x.id === id);
  const conteneur = document.getElementById('fiche-contenu');
  conteneur.textContent = '';
  if (!r) {
    conteneur.append(el('p', { class: 'discret' }, 'Recette introuvable. ', el('a', { href: '#/', text: 'Retour à l\'accueil' })));
    return;
  }

  const puces = el('ul', { class: 'puces-fiche' });
  puces.append(puceTexte('👥', r.partsActuelles + ' / ' + r.partsBase + (r.partsBase > 1 ? ' parts' : ' part')));
  if (r.tempsPreparation) puces.append(puceTexte('⏱', 'prépa ' + r.tempsPreparation + ' min'));
  if (r.tempsCuisson) puces.append(puceTexte('🔥', 'cuisson ' + r.tempsCuisson + ' min'));
  if (r.temperature) puces.append(puceTexte('🌡', formaterTemperature(r.temperature) + temperatureSecondaire(r.temperature) + ' — ' + (r.modeFour === 'tournante' ? 'chaleur tournante' : 'four traditionnel')));
  if (r.etiquettes.length > 0) puces.append(el('li', { class: 'puce' }, '🏷 ', el('b', { text: r.etiquettes.join(', ') })));

  /* Sélecteur de parts : les quantités se recalculent automatiquement. */
  const champParts = el('input', {
    type: 'number', min: '1', max: '999', step: '1', value: r.partsActuelles,
    'aria-label': 'Nombre de parts',
    onchange: (e) => {
      r.partsActuelles = Math.min(999, Math.max(1, parseInt(e.target.value, 10) || r.partsBase));
      e.target.value = r.partsActuelles;
      sauvegarder();
      rendreFiche(id);
    }
  });

  /* Liste des ingrédients avec quantités ajustées. */
  const listeIng = el('ul', { class: 'liste-ingredients' });
  for (const ing of r.ingredients) {
    const q = quantiteMiseAJour(ing, r.partsActuelles, r.partsBase);
    listeIng.append(el('li', {},
      el('span', { class: 'nom' }, ing.nom, ing.fixe ? el('span', { class: 'badge-fixe', text: 'qte fixe' }) : null),
      el('span', { class: 'qte', text: formaterQuantite(q.q, q.unite) }),
      el('button', {
        class: 'bouton-secondaire ajouter-courses', type: 'button',
        'aria-label': 'Ajouter ' + ing.nom + ' à la liste de courses',
        onclick: () => { ajouterAListe(ing.nom, q.q, q.unite); toast(ing.nom + ' ajouté à la liste de courses'); }
      }, '＋ Courses')
    ));
  }

  /* Étapes des instructions (une ligne = une étape). */
  const etapes = r.instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  conteneur.append(el('div', { class: 'fiche' },
    el('a', { href: '#/', class: 'discret' }, '← Toutes les recettes'),
    el('div', { class: 'fiche-entete' },
      el('h1', { id: 'titre-fiche', text: r.nom }),
      puces
    ),
    el('div', { class: 'selecteur-parts' },
      el('strong', { text: 'Parts :' }),
      el('div', { class: 'groupe-boutons' },
        el('button', {
          class: 'bouton-rond', type: 'button', 'aria-label': 'Une part de moins',
          onclick: () => { r.partsActuelles = Math.max(1, r.partsActuelles - 1); sauvegarder(); rendreFiche(id); }
        }, '−'),
        champParts,
        el('button', {
          class: 'bouton-rond', type: 'button', 'aria-label': 'Une part de plus',
          onclick: () => { r.partsActuelles = Math.min(999, r.partsActuelles + 1); sauvegarder(); rendreFiche(id); }
        }, '+')
      ),
      el('span', { class: 'discret', text: '(les quantités se recalculent automatiquement)' })
    ),
    el('section', { class: 'groupe', 'aria-labelledby': 'titre-ingredients' },
      el('h2', { id: 'titre-ingredients', text: 'Ingrédients pour ' + r.partsActuelles + (r.partsActuelles > 1 ? ' parts' : ' part') }),
      listeIng,
      r.ingredients.length === 0 ? el('p', { class: 'discret', text: 'Aucun ingrédient.' }) : null,
      el('button', {
        class: 'bouton-secondaire', type: 'button',
        onclick: () => { ajouterRecetteAuxCourses(r); toast('Tous les ingrédients ajoutés à la liste de courses'); }
      }, '🧺 Tout ajouter à la liste de courses')
    ),
    etapes.length > 0 ? el('section', { class: 'groupe', 'aria-labelledby': 'titre-instructions' },
      el('h2', { id: 'titre-instructions', text: 'Instructions' }),
      el('ol', { class: 'etapes' }, etapes.map((e) => el('li', { text: e })))
    ) : null,
    el('div', { class: 'actions-ligne' },
      el('a', { class: 'bouton', href: '#/recette/' + r.id + '/modifier' }, 'Modifier'),
      el('button', { class: 'bouton-secondaire', type: 'button', onclick: () => dupliquerRecette(r.id) }, 'Dupliquer'),
      el('button', { class: 'bouton-secondaire', type: 'button', onclick: () => partagerRecette(r) }, '↗ Partager'),
      el('button', { class: 'bouton-secondaire', type: 'button', onclick: () => window.print() }, '🖨 Imprimer'),
      el('button', { class: 'bouton', type: 'button', onclick: () => ouvrirModeCuisson(r.id) }, '🔥 Mode cuisson'),
      el('button', { class: 'bouton-danger', type: 'button', onclick: () => supprimerRecette(r.id) }, 'Supprimer')
    )
  ));
}

/* ---------- Formulaire de création / modification ---------- */
function rendreFormulaire(id) {
  const existant = id ? donnees.recettes.find((x) => x.id === id) : null;
  const titre = document.getElementById('titre-formulaire');
  titre.textContent = existant ? 'Modifier « ' + existant.nom + ' »' : 'Nouvelle recette';
  const conteneur = document.getElementById('form-contenu');
  conteneur.textContent = '';

  /* Champs principaux. */
  const champNom = el('input', { type: 'text', id: 'f-nom', required: 'true', maxlength: '120', placeholder: 'Ex. : Tarte aux pommes', value: existant ? existant.nom : '' });
  const champEtiquettes = el('input', { type: 'text', id: 'f-etiquettes', maxlength: '200', placeholder: 'Ex. : dessert, rapide, végétarien', value: existant ? existant.etiquettes.join(', ') : '' });
  const champParts = el('input', { type: 'number', id: 'f-parts', min: '1', max: '999', step: '1', required: 'true', value: existant ? existant.partsBase : 4 });
  const champPrepa = el('input', { type: 'number', id: 'f-prepa', min: '0', max: '9999', step: '1', value: existant ? existant.tempsPreparation : 0 });
  const champCuisson = el('input', { type: 'number', id: 'f-cuisson', min: '0', max: '9999', step: '1', value: existant ? existant.tempsCuisson : 0 });
  const champTemp = el('input', {
    type: 'number', id: 'f-temp',
    min: uniteTemp() === 'F' ? '32' : '0', max: uniteTemp() === 'F' ? '600' : '300', step: uniteTemp() === 'F' ? '10' : '5',
    placeholder: uniteTemp() === 'F' ? 'ex. : 350' : 'ex. : 180',
    value: existant && existant.temperature !== null ? (uniteTemp() === 'F' ? cVersF(existant.temperature) : existant.temperature) : ''
  });
  const champMode = el('select', { id: 'f-mode' },
    el('option', { value: 'traditionnel', selected: !existant || existant.modeFour !== 'tournante' ? 'true' : null }, 'Four traditionnel'),
    el('option', { value: 'tournante', selected: existant && existant.modeFour === 'tournante' ? 'true' : null }, 'Chaleur tournante')
  );
  const champInstructions = el('textarea', { id: 'f-instructions', placeholder: 'Une étape par ligne…' }, existant ? existant.instructions : '');

  /* Lignes d'ingrédients dynamiques. */
  const blocLignes = el('div', { class: 'ingredients-form', id: 'f-ingredients' });
  function ligneIngredient(ing) {
    const champIngNom = el('input', { type: 'text', placeholder: 'Ingrédient', 'aria-label': 'Nom de l\'ingrédient', value: ing ? ing.nom : '', maxlength: '80' });
    const champQte = el('input', { type: 'number', min: '0', step: 'any', placeholder: 'Qté', 'aria-label': 'Quantité', value: ing ? ing.quantite : '' });
    const champUnite = el('select', { class: 'unite', 'aria-label': 'Unité' },
      UNITES.map((u) => el('option', { value: u, selected: ing && ing.unite === u ? 'true' : null }, u))
    );
    const caseFixe = el('input', {
      type: 'checkbox', class: 'case-fixe',
      'aria-label': 'Quantité fixe (non mise à l\'échelle avec les parts)', title: 'Quantité fixe : non mise à l\'échelle avec les parts',
      checked: ing && ing.fixe ? 'true' : null
    });
    const boutonSuppr = el('button', {
      class: 'bouton-icone', type: 'button', 'aria-label': 'Retirer cet ingrédient', title: 'Retirer',
      onclick: () => ligne.remove()
    }, '✕');
    const ligne = el('div', { class: 'ligne-ingredient' }, champIngNom, champQte, champUnite, caseFixe, boutonSuppr);
    ligne._champs = { nom: champIngNom, qte: champQte, unite: champUnite, fixe: caseFixe };
    return ligne;
  }
  (existant ? existant.ingredients : [{ nom: '', quantite: '', unite: 'g' }]).forEach((ing) => blocLignes.append(ligneIngredient(ing)));

  const formulaire = el('form', {
    class: 'formulaire', novalidate: 'true',
    onsubmit: (e) => {
      e.preventDefault();
      enregistrerRecette(e.target, existant);
    }
  },
    el('div', { class: 'champ' }, el('label', { for: 'f-nom', text: 'Nom de la recette *' }), champNom),
    el('div', { class: 'champ' }, el('label', { for: 'f-etiquettes', text: 'Étiquettes (séparées par des virgules)' }), champEtiquettes),
    el('div', { class: 'ligne-champs' },
      el('div', { class: 'champ' }, el('label', { for: 'f-parts', text: 'Parts de base *' }), champParts),
      el('div', { class: 'champ' }, el('label', { for: 'f-prepa', text: 'Préparation (min)' }), champPrepa),
      el('div', { class: 'champ' }, el('label', { for: 'f-cuisson', text: 'Cuisson (min)' }), champCuisson)
    ),
    el('div', { class: 'ligne-champs' },
      el('div', { class: 'champ' }, el('label', { for: 'f-temp', id: 'label-temp', text: 'Température du four (' + (uniteTemp() === 'F' ? '°F' : '°C') + ')' }), champTemp),
      el('div', { class: 'champ' },
        el('label', { for: 'f-mode', text: 'Mode du four' }), champMode,
        el('p', { class: 'indice', text: 'En chaleur tournante, réglez en général 20 °C de moins qu\'en traditionnel.' })
      )
    ),
    el('fieldset', { class: 'groupe' },
      el('legend', { text: 'Ingrédients' }),
      blocLignes,
      el('button', {
        class: 'bouton-secondaire', type: 'button',
        onclick: () => blocLignes.append(ligneIngredient(null))
      }, '+ Ajouter un ingrédient')
    ),
    el('div', { class: 'champ' },
      el('label', { for: 'f-instructions', text: 'Instructions / notes (une étape par ligne)' }), champInstructions
    ),
    el('div', { class: 'form-actions' },
      el('button', { class: 'bouton', type: 'submit', text: existant ? 'Enregistrer les modifications' : 'Créer la recette' }),
      el('a', { class: 'bouton-secondaire', href: existant ? '#/recette/' + existant.id : '#/', text: 'Annuler' })
    )
  );
  formulaire._blocLignes = blocLignes;
  conteneur.append(formulaire);
  champNom.focus();
}

/* Enregistrement du formulaire (création ou modification). */
function enregistrerRecette(form, existant) {
  const nom = form.querySelector('#f-nom').value.trim();
  if (!nom) { toast(' Donnez un nom à la recette.'); form.querySelector('#f-nom').focus(); return; }
  const partsBase = Math.max(1, parseInt(form.querySelector('#f-parts').value, 10) || 1);
  const ingredients = [...form._blocLignes.children].map((ligne) => ({
    nom: ligne._champs.nom.value.trim(),
    quantite: parseFloat(String(ligne._champs.qte.value).replace(',', '.')) || 0,
    unite: ligne._champs.unite.value,
    fixe: ligne._champs.fixe.checked
  })).filter((i) => i.nom && i.quantite > 0);
  const etiquettes = [...new Set(
    form.querySelector('#f-etiquettes').value.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  )].slice(0, 12);
  const tempBrute = form.querySelector('#f-temp').value;
  const recette = {
    id: existant ? existant.id : uid(),
    nom,
    partsBase,
    partsActuelles: existant ? existant.partsActuelles : partsBase,
    tempsPreparation: Math.max(0, parseInt(form.querySelector('#f-prepa').value, 10) || 0),
    tempsCuisson: Math.max(0, parseInt(form.querySelector('#f-cuisson').value, 10) || 0),
    /* La température est toujours stockée en °C, même si le formulaire affiche des °F. */
    temperature: tempBrute === '' ? null : (uniteTemp() === 'F' ? fVersC(Number(tempBrute)) : Math.round(Number(tempBrute))),
    modeFour: form.querySelector('#f-mode').value,
    etiquettes,
    photo: existant ? !!existant.photo : false,
    ingredients: ingredients.map((i) => ({ id: uid(), ...i })),
    instructions: form.querySelector('#f-instructions').value.trim(),
    creeLe: existant ? existant.creeLe : new Date().toISOString(),
    modifieLe: new Date().toISOString()
  };
  if (existant) {
    donnees.recettes = donnees.recettes.map((r) => (r.id === recette.id ? recette : r));
  } else {
    donnees.recettes.push(recette);
  }
  sauvegarder();
  toast(existant ? 'Modifications enregistrées' : 'Recette « ' + nom + ' » créée');
  location.hash = '#/recette/' + recette.id;
}

/* ---------- Liste de courses (vue) ---------- */
function rendreCourses() {
  const conteneur = document.getElementById('courses-contenu');
  conteneur.textContent = '';
  const groupes = coursesAgregees();
  if (groupes.length === 0) {
    conteneur.append(el('p', { class: 'discret', text: 'La liste est vide. Ouvrez une recette et touchez « ＋ Courses » à côté d\'un ingrédient, « Tout ajouter », ou ajoutez un article ci-dessus.' }));
    return;
  }
  /* Regroupement par rayon de magasin. */
  const parRayon = new Map();
  for (const g of groupes) {
    if (!parRayon.has(g.rayon)) parRayon.set(g.rayon, []);
    parRayon.get(g.rayon).push(g);
  }
  for (const [rayon, listeG] of parRayon) {
    const liste = el('ul', { class: 'liste-courses', 'aria-label': rayon });
    for (const g of listeG) {
      const q = normaliserAffichage(g.quantite, g.unite);
      const coche = el('input', {
        type: 'checkbox', checked: g.coche ? 'true' : null,
        'aria-label': 'Cocher ' + g.nom,
        onchange: (e) => {
          for (const id of g.ids) {
            const item = donnees.courses.find((c) => c.id === id);
            if (item) item.coche = e.target.checked;
          }
          sauvegarder();
          rendreCourses();
        }
      });
      liste.append(el('li', { class: g.coche ? 'coche' : '' },
        coche,
        el('span', { class: 'article' },
          g.quantite > 0 ? el('span', { class: 'qte', text: formaterQuantite(q.q, q.unite) }) : null,
          g.nom
        ),
        el('button', {
          class: 'bouton-petit bouton-etoile', type: 'button',
          'aria-pressed': g.recurrente ? 'true' : 'false',
          'aria-label': (g.recurrente ? 'Retirer ' : 'Marquer ') + g.nom + (g.recurrente ? '' : ' comme article récurrent (toujours à acheter)'),
          title: 'Article récurrent (toujours à acheter)',
          onclick: () => {
            for (const id of g.ids) {
              const item = donnees.courses.find((c) => c.id === id);
              if (item) item.recurrente = !g.recurrente;
            }
            sauvegarder(); rendreCourses();
            toast(g.recurrente ? '« ' + g.nom + ' » n\'est plus récurrent' : '« ' + g.nom + ' » sera toujours proposé');
          }
        }, g.recurrente ? '★' : '☆'),
        el('button', {
          class: 'bouton-petit', type: 'button', 'aria-label': 'Retirer ' + g.nom + ' de la liste', title: 'Retirer',
          onclick: () => {
            donnees.courses = donnees.courses.filter((c) => !g.ids.includes(c.id));
            sauvegarder(); rendreCourses(); toast(g.nom + ' retiré de la liste');
          }
        }, '✕')
      ));
    }
    conteneur.append(el('section', { class: 'rayon', 'aria-labelledby': 'rayon-' + normaliserTexte(rayon) },
      el('h2', { class: 'rayon-titre', id: 'rayon-' + normaliserTexte(rayon), text: rayon }),
      liste
    ));
  }
}

/* ------------------------------------------------------------
   7. Mode cuisson plein écran + minuteurs (plusieurs simultanés,
      dont un minuteur facultatif par étape)
   ------------------------------------------------------------ */

let recetteEnCuisson = null;
let wakeLock = null;

/* Moteur de minuteurs : plusieurs minuteurs peuvent tourner en même temps. */
const minuteurs = new Map(); // id -> { id, label, dureeMs, finAt, restantMs, actif, affichage, ligne, bouton }
let tickGlobal = null;

function assurerTick() {
  if (!tickGlobal) tickGlobal = setInterval(tickMinuteurs, 200);
}

function tickMinuteurs() {
  let encoreActif = false;
  for (const m of minuteurs.values()) {
    if (!m.actif) continue;
    const restant = m.finAt - Date.now();
    if (restant <= 0) {
      m.restantMs = 0;
      m.actif = false;
      if (m.affichage) { m.affichage.textContent = '00:00'; m.affichage.classList.add('termine'); }
      if (m.ligne) m.ligne.classList.add('termine');
      if (m.bouton) m.bouton.textContent = m.ligne ? '⏱' : '▶ Démarrer';
      signalerFin();
    } else {
      encoreActif = true;
      if (m.affichage) m.affichage.textContent = formaterDuree(restant);
    }
  }
  if (!encoreActif) { clearInterval(tickGlobal); tickGlobal = null; }
}

function ajouterMinuteur(label, dureeMs) {
  const id = uid();
  minuteurs.set(id, { id, label, dureeMs, finAt: 0, restantMs: dureeMs, actif: false, affichage: null, ligne: null, bouton: null });
  return id;
}

function basculerMinuteur(id) {
  const m = minuteurs.get(id);
  if (!m) return;
  if (m.actif) {
    m.restantMs = Math.max(0, m.finAt - Date.now());
    m.actif = false;
  } else {
    const duree = m.restantMs > 0 ? m.restantMs : m.dureeMs;
    m.finAt = Date.now() + duree;
    m.restantMs = duree;
    m.actif = true;
    assurerTick();
  }
  if (recetteEnCuisson) rendreMinuteursCuisson();
}

function reinitialiserMinuteur(id) {
  const m = minuteurs.get(id);
  if (!m) return;
  m.actif = false;
  m.restantMs = m.dureeMs;
  m.finAt = 0;
  if (recetteEnCuisson) rendreMinuteursCuisson();
}

function supprimerMinuteur(id) {
  minuteurs.delete(id);
  if (recetteEnCuisson) rendreMinuteursCuisson();
}

function arreterTousLesMinuteurs() {
  for (const m of minuteurs.values()) m.actif = false;
  minuteurs.clear();
  if (tickGlobal) { clearInterval(tickGlobal); tickGlobal = null; }
}

function ouvrirModeCuisson(id) {
  const r = donnees.recettes.find((x) => x.id === id);
  if (!r) return;
  recetteEnCuisson = r;
  arreterTousLesMinuteurs();
  /* Minuteur principal pré-rempli avec le temps de cuisson de la recette. */
  ajouterMinuteur('Cuisson', (r.tempsCuisson || 30) * 60000);
  rendreModeCuisson();
  const overlay = document.getElementById('mode-cuisson');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  const p = overlay.requestFullscreen ? overlay.requestFullscreen() : null;
  if (p && p.catch) p.catch(() => {}); // plein écran refusé : l'overlay reste plein écran via CSS
  demanderVigilance();
}

function fermerModeCuisson() {
  arreterTousLesMinuteurs();
  recetteEnCuisson = null;
  document.getElementById('mode-cuisson').hidden = true;
  document.body.style.overflow = '';
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

/* Écran toujours allumé pendant la cuisson (si le navigateur le permet). */
async function demanderVigilance() {
  try {
    if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* non bloquant */ }
}

function rendreModeCuisson() {
  const r = recetteEnCuisson;
  const conteneur = document.getElementById('cuisson-contenu');
  conteneur.textContent = '';
  if (!r) return;

  const thermo = r.temperature
    ? el('div', { class: 'thermo' },
        formaterTemperature(r.temperature) + temperatureSecondaire(r.temperature),
        el('small', { text: r.modeFour === 'tournante' ? 'chaleur tournante' : 'four traditionnel' }))
    : el('div', { class: 'thermo' }, '—', el('small', { text: 'cuisson à la poêle / sans four' }));

  const etapes = r.instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  conteneur.append(el('div', { class: 'cuisson' },
    el('div', { class: 'entete-cuisson' },
      el('h2', { id: 'cuisson-titre', text: r.nom }),
      el('button', { class: 'bouton-secondaire bouton-quitter', type: 'button', onclick: fermerModeCuisson }, '✕ Quitter le mode cuisson')
    ),
    el('div', { class: 'cuisson-visuel' },
      thermo,
      el('div', { class: 'minuteurs-groupe' },
        el('div', { class: 'bloc-minuteurs', id: 'cuisson-minuteurs' }),
        el('button', {
          class: 'bouton-secondaire', type: 'button',
          onclick: () => { ajouterMinuteur('Minuteur ' + (minuteurs.size + 1), 5 * 60000); rendreMinuteursCuisson(); }
        }, '＋ Ajouter un minuteur')
      )
    ),
    etapes.length > 0 ? el('section', { 'aria-labelledby': 'cuisson-etapes-titre' },
      el('h2', { id: 'cuisson-etapes-titre', text: 'Étapes (touchez une étape pour la valider ; ⏱ lance un minuteur sur l\'étape)' }),
      el('ol', { class: 'etapes-cuisson', id: 'cuisson-etapes' }, etapes.map((texteEtape, i) => rendreEtapeCuisson(texteEtape, i)))
    ) : null
  ));
  rendreMinuteursCuisson();
}

/* Liste des minuteurs globaux (un par ligne, gérable individuellement). */
function rendreMinuteursCuisson() {
  const bloc = document.getElementById('cuisson-minuteurs');
  if (!bloc) return;
  bloc.textContent = '';
  for (const m of minuteurs.values()) {
    const champLabel = el('input', {
      type: 'text', class: 'min-label', value: m.label, maxlength: '40', 'aria-label': 'Nom du minuteur',
      onchange: (e) => { m.label = e.target.value.trim() || m.label; }
    });
    const champMin = el('input', {
      type: 'number', min: '1', max: '999', step: '1', class: 'min-duree',
      value: Math.round(m.dureeMs / 60000), 'aria-label': 'Durée du minuteur en minutes',
      onchange: (e) => {
        m.dureeMs = Math.max(1, parseInt(e.target.value, 10) || 1) * 60000;
        if (!m.actif) {
          m.restantMs = m.dureeMs;
          if (m.affichage) m.affichage.textContent = formaterDuree(m.restantMs);
        }
      }
    });
    const affichage = el('span', { class: 'temps' + (m.restantMs === 0 && !m.actif ? ' termine' : ''), text: formaterDuree(m.restantMs) });
    const bouton = el('button', {
      class: 'bouton', type: 'button',
      text: m.actif ? '⏸ Pause' : (m.restantMs > 0 && m.restantMs < m.dureeMs ? '▶ Reprendre' : '▶ Démarrer'),
      onclick: () => basculerMinuteur(m.id)
    });
    m.affichage = affichage;
    m.bouton = bouton;
    bloc.append(el('div', { class: 'minuteur-ligne' + (m.restantMs === 0 && !m.actif ? ' termine' : '') },
      champLabel,
      champMin,
      el('span', { class: 'min-unite', text: 'min' }),
      affichage,
      bouton,
      el('button', { class: 'bouton-secondaire', type: 'button', onclick: () => reinitialiserMinuteur(m.id) }, 'Réinitialiser'),
      el('button', { class: 'bouton-petit', type: 'button', 'aria-label': 'Supprimer ce minuteur', title: 'Supprimer', onclick: () => supprimerMinuteur(m.id) }, '✕')
    ));
  }
}

/* Une étape de la recette, avec son propre minuteur facultatif. */
function rendreEtapeCuisson(texteEtape, index) {
  const li = el('li', {
    tabindex: '0',
    onclick: (ev) => { if (ev.target.closest && ev.target.closest('.controles-etape')) return; ev.currentTarget.classList.toggle('faite'); },
    onkeydown: (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && !(ev.target.closest && ev.target.closest('.controles-etape'))) {
        ev.preventDefault();
        ev.currentTarget.classList.toggle('faite');
      }
    }
  }, texteEtape);

  const champMin = el('input', {
    type: 'number', min: '1', max: '999', step: '1', value: '5', class: 'min-etape',
    'aria-label': 'Minutes du minuteur de cette étape'
  });
  const affichage = el('span', { class: 'temps-etape', text: formaterDuree(5 * 60000) });
  const bouton = el('button', {
    class: 'bouton-petit', type: 'button', 'aria-label': 'Démarrer / mettre en pause le minuteur de cette étape', text: '⏱',
    onclick: (ev) => {
      ev.stopPropagation();
      let id = li._minuteurId;
      if (!id) {
        id = ajouterMinuteur('Étape ' + (index + 1), Math.max(1, parseInt(champMin.value, 10) || 5) * 60000);
        li._minuteurId = id;
        const m = minuteurs.get(id);
        m.ligne = li;
        m.affichage = affichage;
        m.bouton = bouton;
      }
      basculerMinuteur(id);
      const m = minuteurs.get(id);
      bouton.textContent = m.actif ? '⏸' : '⏱';
    }
  });
  champMin.addEventListener('click', (ev) => ev.stopPropagation());
  champMin.addEventListener('change', () => {
    const duree = Math.max(1, parseInt(champMin.value, 10) || 5) * 60000;
    const m = li._minuteurId ? minuteurs.get(li._minuteurId) : null;
    if (m) {
      m.dureeMs = duree;
      if (!m.actif) { m.restantMs = duree; affichage.textContent = formaterDuree(duree); }
    } else {
      affichage.textContent = formaterDuree(duree);
    }
  });
  affichage.addEventListener('click', (ev) => ev.stopPropagation());

  li.append(el('span', { class: 'controles-etape' }, champMin, el('span', { class: 'min-unite', text: 'min' }), bouton, affichage));
  return li;
}

function formaterDuree(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const deux = (n) => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + deux(m) + ':' + deux(s) : deux(m) + ':' + deux(s);
}

/* Son + vibration à la fin d'un minuteur. */
function signalerFin() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
  try {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.25;
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 500);
      }, i * 700);
    }
  } catch (e) { /* audio indisponible : la vibration suffit */ }
}

/* ------------------------------------------------------------
   8. Thème, luminosité, export / import
   ------------------------------------------------------------ */

const THEMES = { nuit: '#14111d', sombre: '#161616', clair: '#f6f4fb' };

function appliquerTheme(theme) {
  donnees.reglages.theme = THEMES[theme] ? theme : 'nuit';
  document.documentElement.dataset.theme = donnees.reglages.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEMES[donnees.reglages.theme]);
  document.querySelectorAll('input[name="theme"]').forEach((r) => { r.checked = r.value === donnees.reglages.theme; });
  sauvegarder();
}

/* Unité d'affichage des températures (°C par défaut, °F possible). */
function appliquerUniteTemp(unite) {
  donnees.reglages.uniteTemp = unite === 'F' ? 'F' : 'C';
  const select = document.getElementById('unite-temp');
  if (select) select.value = donnees.reglages.uniteTemp;
  const labelTemp = document.getElementById('label-temp');
  if (labelTemp) labelTemp.textContent = 'Température du four (' + (uniteTemp() === 'F' ? '°F' : '°C') + ')';
  sauvegarder();
}

function appliquerLuminosite(valeur) {
  const v = Math.min(100, Math.max(30, parseInt(valeur, 10) || 100));
  donnees.reglages.luminosite = v;
  /* Superposition assombrie : 100 % -> aucune, 30 % -> voile à 80 %. */
  document.getElementById('voile').style.opacity = (((100 - v) / 100) * 0.8).toFixed(2);
  const sortie = document.getElementById('luminosite-valeur');
  if (sortie) sortie.textContent = v + ' %';
  const champ = document.getElementById('luminosite');
  if (champ) champ.value = v;
  sauvegarder();
}

/* Export des données en fichier JSON (sauvegarde / migration). */
function exporterDonnees(suffixe) {
  const exportation = {
    application: 'Omni-Cooking',
    version: VERSION_DONNEES,
    exporteLe: new Date().toISOString(),
    recettes: donnees.recettes,
    courses: donnees.courses,
    reglages: donnees.reglages
  };
  const blob = new Blob([JSON.stringify(exportation, null, 2)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: URL.createObjectURL(blob), download: 'omni-cooking-' + (suffixe ? suffixe + '-' : '') + date + '.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Données exportées en JSON');
}

/* Import d'un fichier JSON précédemment exporté. */
function importerDonnees(fichier) {
  const lecteur = new FileReader();
  lecteur.onload = () => {
    try {
      const lu = JSON.parse(lecteur.result);
      if (!lu || !Array.isArray(lu.recettes)) throw new Error('format invalide');
      /* Sauvegarde automatique de l'état actuel avant tout remplacement. */
      exporterDonnees('sauvegarde-avant-import');
      if (!window.confirm('Remplacer toutes les recettes et la liste de courses actuelles par celles du fichier « ' + fichier.name + ' » ?\n(Une sauvegarde de l\'état actuel vient d\'être téléchargée.)')) return;
      donnees.recettes = lu.recettes.map(normaliserRecette);
      donnees.courses = (lu.courses || [])
        .filter((c) => c && c.nom)
        .map((c) => ({ id: c.id || uid(), nom: String(c.nom), quantite: Number(c.quantite) || 0, unite: uniteBase(UNITES.includes(c.unite) ? c.unite : 'pièce'), coche: !!c.coche, recurrente: !!c.recurrente }));
      if (lu.reglages) donnees.reglages = Object.assign(donnees.reglages, lu.reglages);
      sauvegarder();
      appliquerTheme(donnees.reglages.theme);
      appliquerLuminosite(donnees.reglages.luminosite);
      location.hash = '#/';
      toast('Données importées : ' + donnees.recettes.length + ' recette(s)');
    } catch (e) {
      console.error(e);
      toast('Import impossible : fichier JSON invalide.');
    }
  };
  lecteur.readAsText(fichier);
}

/* ------------------------------------------------------------
   9. Toast (messages transitoires)
   ------------------------------------------------------------ */

let toastMinuteur = null;
/* Toast, éventuellement avec un bouton d'action (ex. « Annuler »). */
function toast(message, action) {
  const zone = document.getElementById('toast');
  zone.textContent = '';
  zone.append(message);
  if (action && action.label) {
    zone.append(el('button', {
      class: 'toast-action', type: 'button',
      onclick: () => { zone.classList.remove('visible'); action.action(); }
    }, action.label));
  }
  zone.classList.add('visible');
  if (toastMinuteur) clearTimeout(toastMinuteur);
  toastMinuteur = setTimeout(() => zone.classList.remove('visible'), action ? 6000 : 2600);
}

/* ------------------------------------------------------------
   9b. Installation de la PWA (bouton « Installer » quand le
       navigateur le propose ; indice manuel pour iOS/Safari)
   ------------------------------------------------------------ */

let inviteInstallation = null;

function configurerInstallation() {
  const bouton = document.getElementById('bouton-installer');
  const indice = document.getElementById('indice-installation');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    inviteInstallation = e;
    bouton.hidden = false;
  });
  bouton.addEventListener('click', async () => {
    if (!inviteInstallation) return;
    inviteInstallation.prompt();
    const choix = await inviteInstallation.userChoice;
    if (choix && choix.outcome === 'accepted') toast('✔ Application installée');
    inviteInstallation = null;
    bouton.hidden = true;
  });
  /* iOS/Safari ne déclenche pas beforeinstallprompt : expliquer la manip. */
  const estIOS = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const estStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (!estStandalone && (estIOS || !('BeforeInstallPromptEvent' in window))) {
    indice.textContent = 'Pour installer : sur iPhone/iPad, touchez « Partager » puis « Sur l\'écran d\'accueil » ; sur ordinateur, utilisez l\'icône « Installer » de la barre d\'adresse du navigateur.';
  }
}

/* ------------------------------------------------------------
   10. Service worker : enregistrement et bouton de mise à jour
   ------------------------------------------------------------ */

let travailleurEnAttente = null;

/* Le bouton « Mise à jour » n'apparaît (dans tous les onglets et dans les
   réglages) que quand une nouvelle version du service worker est prête. */
function afficherMiseAJourDisponible() {
  document.getElementById('bouton-maj').hidden = false;
  document.getElementById('bouton-maj-reglages').hidden = false;
  document.getElementById('statut-maj').textContent = 'Une mise à jour d\'Omni-Cooking est disponible : elle s\'appliquera au prochain rechargement.';
}

function appliquerMiseAJour() {
  if (travailleurEnAttente) travailleurEnAttente.postMessage({ type: 'SKIP_WAITING' });
}

function surveillerMisesAJour() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((enregistrement) => {
    const verifier = (sw) => {
      if (sw && sw.state === 'installed' && navigator.serviceWorker.controller) {
        travailleurEnAttente = sw;
        afficherMiseAJourDisponible();
      }
    };
    if (enregistrement.waiting) verifier(enregistrement.waiting);
    enregistrement.addEventListener('updatefound', () => {
      const sw = enregistrement.installing;
      sw.addEventListener('statechange', () => verifier(sw));
    });
  }).catch((e) => console.error('Omni-Cooking : service worker non enregistré', e));
  /* Quand la nouvelle version prend le contrôle, on recharge la page. */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try { sessionStorage.setItem('omni-cooking-maj', '1'); } catch (e) { /* stockage indisponible */ }
    window.location.reload();
  });
}

/* ------------------------------------------------------------
   11. Routeur (navigation par ancre : #/…)
   ------------------------------------------------------------ */

function router() {
  const parties = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [vue, arg, sous] = parties;
  /* Annonce du changement de vue aux lecteurs d'écran. */
  const annonce = document.getElementById('annonce');
  if (annonce) {
    const titres = { accueil: 'Mes recettes', recette: 'Fiche de la recette', nouvelle: 'Formulaire de recette', formulaire: 'Formulaire de recette', courses: 'Liste de courses', reglages: 'Réglages', apropos: 'À propos' };
    let texte = 'Vue : ' + (titres[vue || 'accueil'] || vue || 'accueil');
    const r = arg ? donnees.recettes.find((x) => x.id === arg) : null;
    if (r) texte += ' — ' + r.nom;
    annonce.textContent = texte;
  }
  switch (vue || 'accueil') {
    case 'recette':
      if (sous === 'modifier' && arg) { afficherVue('formulaire'); rendreFormulaire(arg); }
      else { afficherVue('fiche'); rendreFiche(arg); }
      break;
    case 'nouvelle':
      afficherVue('formulaire'); rendreFormulaire(null);
      break;
    case 'courses':
      afficherVue('courses'); rendreCourses();
      break;
    case 'reglages':
      afficherVue('reglages');
      break;
    case 'apropos':
      afficherVue('apropos');
      break;
    default:
      afficherVue('accueil'); rendreAccueil();
  }
}

/* ------------------------------------------------------------
   12. Initialisation
   ------------------------------------------------------------ */

function init() {
  chargerDonnees();

  /* Toast de confirmation après une mise à jour appliquée (rechargement). */
  try {
    if (sessionStorage.getItem('omni-cooking-maj')) {
      sessionStorage.removeItem('omni-cooking-maj');
      setTimeout(() => toast('✔ Mise à jour appliquée'), 400);
    }
  } catch (e) { /* sessionStorage indisponible */ }

  configurerInstallation();

  /* Réglages persistants. */
  appliquerTheme(donnees.reglages.theme);
  appliquerLuminosite(donnees.reglages.luminosite);
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.addEventListener('change', () => appliquerTheme(r.value));
  });
  document.getElementById('luminosite').addEventListener('input', (e) => appliquerLuminosite(e.target.value));
  appliquerUniteTemp(donnees.reglages.uniteTemp);
  document.getElementById('unite-temp').addEventListener('change', (e) => { appliquerUniteTemp(e.target.value); router(); });

  /* Recherche et filtres. */
  document.getElementById('recherche').addEventListener('input', (e) => { rechercheTexte = e.target.value; rendreAccueil(); });
  document.getElementById('filtre-temps').addEventListener('change', (e) => { filtreTemps = e.target.value; rendreAccueil(); });
  document.getElementById('tri').addEventListener('change', (e) => {
    donnees.reglages.tri = e.target.value;
    sauvegarder();
    rendreAccueil();
  });

  /* Liste de courses. */
  document.getElementById('vider-cochees').addEventListener('click', () => {
    /* Les articles récurrents sont conservés. */
    const avant = donnees.courses.length;
    donnees.courses = donnees.courses.filter((c) => !c.coche || c.recurrente);
    sauvegarder(); rendreCourses();
    toast(avant - donnees.courses.length + ' article(s) coché(s) retiré(s) (récurrents conservés)');
  });
  document.getElementById('ajouter-article').addEventListener('submit', (e) => {
    e.preventDefault();
    const champ = document.getElementById('nouvel-article');
    ajouterArticleManuel(champ.value);
    champ.value = '';
    rendreCourses();
  });
  document.getElementById('vider-tout').addEventListener('click', () => {
    if (donnees.courses.length === 0 || window.confirm('Vider toute la liste de courses ?')) {
      donnees.courses = [];
      sauvegarder(); rendreCourses(); toast('Liste de courses vidée');
    }
  });
  document.getElementById('copier-courses').addEventListener('click', () => {
    const lignes = coursesAgregees().filter((g) => !g.coche).map((g) => {
      const q = normaliserAffichage(g.quantite, g.unite);
      return '☐ ' + formaterQuantite(q.q, q.unite) + ' ' + g.nom;
    });
    const texte = 'Liste de courses — Omni-Cooking\n' + (lignes.join('\n') || '(tout est coché)');
    const copier = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(texte)
      : Promise.reject();
    copier.then(() => toast('Liste copiée dans le presse-papiers'))
      .catch(() => {
        const zone = el('textarea', {}); zone.value = texte;
        document.body.append(zone); zone.select();
        try { document.execCommand('copy'); toast('Liste copiée'); } catch (e) { toast('Copie impossible'); }
        zone.remove();
      });
  });

  /* Export / import. */
  document.getElementById('exporter').addEventListener('click', exporterDonnees);
  document.getElementById('importer').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importerDonnees(e.target.files[0]);
    e.target.value = '';
  });

  /* Boutons de mise à jour (menu réglages + pastille dans la navigation). */
  document.getElementById('bouton-maj').addEventListener('click', appliquerMiseAJour);
  document.getElementById('bouton-maj-reglages').addEventListener('click', appliquerMiseAJour);

  /* Échap ferme le mode cuisson si le plein écran natif n'est pas actif. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('mode-cuisson').hidden && !document.fullscreenElement) fermerModeCuisson();
  });

  /* Raccourcis clavier : « / » recherche, « n » nouvelle recette. */
  document.addEventListener('keydown', (e) => {
    const dansChamp = e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]');
    if (dansChamp || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      location.hash = '#/';
      setTimeout(() => { const champ = document.getElementById('recherche'); if (champ) champ.focus(); }, 0);
    } else if (e.key === 'n') {
      e.preventDefault();
      location.hash = '#/nouvelle';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && recetteEnCuisson) demanderVigilance();
  });

  window.addEventListener('hashchange', router);
  surveillerMisesAJour();
  router();
}

/* Lancement uniquement dans un navigateur. */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

/* Export des fonctions pures pour les tests (Node). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UNITES, uniteBase, versBase, normaliserAffichage, arrondirQuantite,
    formaterDenombrable, formaterQuantite, quantiteMiseAJour, normaliserTexte, normaliserRecette,
    cVersF, fVersC, rayonDe, RAYONS
  };
}
