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
  courses: [],    // { id, nom, quantite, unite, coche }
  reglages: { theme: 'nuit', luminosite: 100 }
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
      .map((i) => ({ id: i.id || uid(), nom: String(i.nom), quantite: Number(i.quantite), unite: UNITES.includes(i.unite) ? i.unite : 'pièce' })),
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
        .map((c) => ({ id: c.id || uid(), nom: String(c.nom), quantite: Number(c.quantite) || 0, unite: uniteBase(UNITES.includes(c.unite) ? c.unite : 'pièce'), coche: !!c.coche })),
      reglages: Object.assign({ theme: 'nuit', luminosite: 100 }, lu.reglages || {})
    };
  } catch (e) {
    console.error('Omni-Cooking : données illisibles, réinitialisation', e);
    donnees = { recettes: [recetteDemo()], courses: [], reglages: { theme: 'nuit', luminosite: 100 } };
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
    ingredients: [
      { id: uid(), nom: 'farine', quantite: 250, unite: 'g' },
      { id: uid(), nom: 'lait', quantite: 500, unite: 'ml' },
      { id: uid(), nom: 'œufs', quantite: 3, unite: 'pièce' },
      { id: uid(), nom: 'sucre', quantite: 2, unite: 'c.à.s' },
      { id: uid(), nom: 'sel', quantite: 1, unite: 'pincée' }
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

function recettesFiltrees() {
  const recherche = normaliserTexte(rechercheTexte);
  const max = filtreTemps === 'tous' ? Infinity : parseInt(filtreTemps, 10);
  return donnees.recettes.filter((r) => {
    const total = r.tempsPreparation + r.tempsCuisson;
    if (total > max) return false;
    if (!recherche) return true;
    if (normaliserTexte(r.nom).includes(recherche)) return true;
    return r.ingredients.some((i) => normaliserTexte(i.nom).includes(recherche));
  });
}

/* ------------------------------------------------------------
   5. Liste de courses
   ------------------------------------------------------------ */

function cleCourse(nom, unite) {
  return normaliserTexte(nom) + '|' + uniteBase(unite);
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
    donnees.courses.push({ id: uid(), nom: nom.trim(), quantite: qBase, unite: baseU, coche: false });
  }
  sauvegarder();
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
    if (!groupes.has(cle)) groupes.set(cle, { nom: item.nom, unite: uniteBase(item.unite), quantite: 0, coche: true, ids: [] });
    const g = groupes.get(cle);
    g.quantite = arrondirSelonUnite(g.quantite + versBase(item.quantite, item.unite), g.unite);
    g.coche = g.coche && item.coche;
    g.ids.push(item.id);
  }
  return [...groupes.values()];
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
  for (const r of recettes) {
    const puces = el('ul', { class: 'puces' },
      puceTexte('⏱', tempsTotal(r) + ' min'),
      puceTexte('👥', r.partsBase + (r.partsBase > 1 ? ' parts' : ' part')),
      puceTexte('🧺', r.ingredients.length + (r.ingredients.length > 1 ? ' ingrédients' : ' ingrédient'))
    );
    if (r.temperature) puces.append(puceTexte('🌡', r.temperature + ' °C'));
    liste.append(el('article', { class: 'carte-recette' },
      el('h2', {}, el('a', { href: '#/recette/' + r.id, text: r.nom })),
      puces,
      el('div', { class: 'actions' },
        el('a', { class: 'bouton-secondaire', href: '#/recette/' + r.id }, 'Ouvrir'),
        el('a', { class: 'bouton-secondaire', href: '#/recette/' + r.id + '/modifier' }, 'Modifier'),
        el('button', { class: 'bouton-danger', type: 'button', onclick: () => supprimerRecette(r.id) }, 'Supprimer')
      )
    ));
  }
  document.getElementById('recherche').value = rechercheTexte;
  document.getElementById('filtre-temps').value = filtreTemps;
}

function supprimerRecette(id) {
  const r = donnees.recettes.find((x) => x.id === id);
  if (!r) return;
  if (!window.confirm('Supprimer définitivement la recette « ' + r.nom + ' » ?')) return;
  donnees.recettes = donnees.recettes.filter((x) => x.id !== id);
  sauvegarder();
  toast('Recette « ' + r.nom + ' » supprimée');
  location.hash = '#/';
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
  if (r.temperature) puces.append(puceTexte('🌡', r.temperature + ' °C — ' + (r.modeFour === 'tournante' ? 'chaleur tournante' : 'four traditionnel')));

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
      el('span', { class: 'nom', text: ing.nom }),
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
  const champParts = el('input', { type: 'number', id: 'f-parts', min: '1', max: '999', step: '1', required: 'true', value: existant ? existant.partsBase : 4 });
  const champPrepa = el('input', { type: 'number', id: 'f-prepa', min: '0', max: '9999', step: '1', value: existant ? existant.tempsPreparation : 0 });
  const champCuisson = el('input', { type: 'number', id: 'f-cuisson', min: '0', max: '9999', step: '1', value: existant ? existant.tempsCuisson : 0 });
  const champTemp = el('input', { type: 'number', id: 'f-temp', min: '0', max: '300', step: '5', placeholder: 'ex. : 180', value: existant && existant.temperature !== null ? existant.temperature : '' });
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
    const boutonSuppr = el('button', {
      class: 'bouton-icone', type: 'button', 'aria-label': 'Retirer cet ingrédient', title: 'Retirer',
      onclick: () => ligne.remove()
    }, '✕');
    const ligne = el('div', { class: 'ligne-ingredient' }, champIngNom, champQte, champUnite, boutonSuppr);
    ligne._champs = { nom: champIngNom, qte: champQte, unite: champUnite };
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
    el('div', { class: 'ligne-champs' },
      el('div', { class: 'champ' }, el('label', { for: 'f-parts', text: 'Parts de base *' }), champParts),
      el('div', { class: 'champ' }, el('label', { for: 'f-prepa', text: 'Préparation (min)' }), champPrepa),
      el('div', { class: 'champ' }, el('label', { for: 'f-cuisson', text: 'Cuisson (min)' }), champCuisson)
    ),
    el('div', { class: 'ligne-champs' },
      el('div', { class: 'champ' }, el('label', { for: 'f-temp', text: 'Température (°C)' }), champTemp),
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
    unite: ligne._champs.unite.value
  })).filter((i) => i.nom && i.quantite > 0);
  const tempBrute = form.querySelector('#f-temp').value;
  const recette = {
    id: existant ? existant.id : uid(),
    nom,
    partsBase,
    partsActuelles: existant ? existant.partsActuelles : partsBase,
    tempsPreparation: Math.max(0, parseInt(form.querySelector('#f-prepa').value, 10) || 0),
    tempsCuisson: Math.max(0, parseInt(form.querySelector('#f-cuisson').value, 10) || 0),
    temperature: tempBrute === '' ? null : Math.round(Number(tempBrute)),
    modeFour: form.querySelector('#f-mode').value,
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
    conteneur.append(el('p', { class: 'discret', text: 'La liste est vide. Ouvrez une recette et touchez « ＋ Courses » à côté d\'un ingrédient, ou « Tout ajouter ».' }));
    return;
  }
  const liste = el('ul', { class: 'liste-courses' });
  for (const g of groupes) {
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
      el('span', { class: 'article' }, el('span', { class: 'qte', text: formaterQuantite(q.q, q.unite) }), g.nom),
      el('button', {
        class: 'bouton-petit', type: 'button', 'aria-label': 'Retirer ' + g.nom + ' de la liste', title: 'Retirer',
        onclick: () => {
          donnees.courses = donnees.courses.filter((c) => !g.ids.includes(c.id));
          sauvegarder(); rendreCourses(); toast(g.nom + ' retiré de la liste');
        }
      }, '✕')
    ));
  }
  conteneur.append(liste);
}

/* ------------------------------------------------------------
   7. Mode cuisson plein écran + minuteur
   ------------------------------------------------------------ */

let recetteEnCuisson = null;
let minuteur = { actif: false, finAt: 0, restantMs: 0, intervalle: null };
let wakeLock = null;

function ouvrirModeCuisson(id) {
  const r = donnees.recettes.find((x) => x.id === id);
  if (!r) return;
  recetteEnCuisson = r;
  rendreModeCuisson();
  const overlay = document.getElementById('mode-cuisson');
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  const p = overlay.requestFullscreen ? overlay.requestFullscreen() : null;
  if (p && p.catch) p.catch(() => {}); // le plein écran peut être refusé : l'overlay reste plein écran via CSS
  demanderVigilance();
}

function fermerModeCuisson() {
  arreterMinuteur();
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
    ? el('div', { class: 'thermo' }, r.temperature + ' °C',
        el('small', { text: r.modeFour === 'tournante' ? 'chaleur tournante' : 'four traditionnel' }))
    : el('div', { class: 'thermo' }, '—', el('small', { text: 'cuisson à la poêle / sans four' }));

  const champMinutes = el('input', {
    type: 'number', min: '1', max: '999', step: '1', value: r.tempsCuisson || 30,
    'aria-label': 'Durée du minuteur en minutes'
  });
  const affichageTemps = el('div', { class: 'temps', id: 'cuisson-temps', role: 'timer', 'aria-live': 'off' }, formaterDuree((parseInt(champMinutes.value, 10) || 30) * 60000));
  const boutonMarche = el('button', {
    class: 'bouton', type: 'button', id: 'cuisson-marche', text: 'Démarrer',
    onclick: () => basculerMinuteur(champMinutes, affichageTemps, boutonMarche)
  });

  const etapes = r.instructions.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const listeEtapes = el('ol', { class: 'etapes-cuisson' },
    etapes.length > 0 ? etapes.map((e) => el('li', {
      text: e, tabindex: '0',
      onclick: (ev) => ev.currentTarget.classList.toggle('faite'),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.classList.toggle('faite'); } }
    })) : el('li', { text: 'Aucune instruction enregistrée pour cette recette.' })
  );

  conteneur.append(el('div', { class: 'cuisson' },
    el('div', { class: 'entete-cuisson' },
      el('h2', { id: 'cuisson-titre', text: r.nom }),
      el('button', { class: 'bouton-secondaire bouton-quitter', type: 'button', onclick: fermerModeCuisson }, '✕ Quitter le mode cuisson')
    ),
    el('div', { class: 'cuisson-visuel' },
      thermo,
      el('div', { class: 'minuteur' },
        affichageTemps,
        el('div', { class: 'reglage-temps' }, el('label', { for: champMinutes.id || 'cuisson-duree', text: 'Minuteur (min) :' }), champMinutes),
        el('div', { class: 'controles' },
          boutonMarche,
          el('button', {
            class: 'bouton-secondaire', type: 'button',
            onclick: () => { reinitialiserMinuteur(champMinutes, affichageTemps, boutonMarche); }
          }, 'Réinitialiser')
        )
      )
    ),
    etapes.length > 0 ? el('section', { 'aria-labelledby': 'cuisson-etapes-titre' },
      el('h2', { id: 'cuisson-etapes-titre', text: 'Étapes (touchez une étape pour la valider)' }),
      listeEtapes
    ) : null
  ));
  champMinutes.id = 'cuisson-duree';
}

function formaterDuree(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const deux = (n) => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + deux(m) + ':' + deux(s) : deux(m) + ':' + deux(s);
}

function basculerMinuteur(champMinutes, affichageTemps, boutonMarche) {
  if (minuteur.actif) {
    minuteur.restantMs = Math.max(0, minuteur.finAt - Date.now());
    arreterMinuteur();
    boutonMarche.textContent = 'Reprendre';
  } else {
    const duree = minuteur.restantMs > 0 ? minuteur.restantMs : (parseInt(champMinutes.value, 10) || 1) * 60000;
    minuteur.finAt = Date.now() + duree;
    minuteur.restantMs = duree;
    minuteur.actif = true;
    boutonMarche.textContent = 'Pause';
    minuteur.intervalle = setInterval(() => {
      const restant = minuteur.finAt - Date.now();
      if (restant <= 0) {
        minuteur.restantMs = 0;
        arreterMinuteur();
        affichageTemps.textContent = '00:00';
        affichageTemps.classList.add('termine');
        boutonMarche.textContent = 'Démarrer';
        signalerFin();
      } else {
        affichageTemps.textContent = formaterDuree(restant);
      }
    }, 200);
  }
  affichageTemps.textContent = formaterDuree(minuteur.restantMs);
}

function reinitialiserMinuteur(champMinutes, affichageTemps, boutonMarche) {
  arreterMinuteur();
  minuteur.restantMs = (parseInt(champMinutes.value, 10) || 0) * 60000;
  affichageTemps.classList.remove('termine');
  affichageTemps.textContent = formaterDuree(minuteur.restantMs);
  boutonMarche.textContent = 'Démarrer';
}

function arreterMinuteur() {
  minuteur.actif = false;
  if (minuteur.intervalle) { clearInterval(minuteur.intervalle); minuteur.intervalle = null; }
}

/* Son + vibration à la fin du minuteur. */
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
function exporterDonnees() {
  const exportation = {
    application: 'Omni-Cooking',
    version: VERSION_DONNEES,
    exporteLe: new Date().toISOString(),
    recettes: donnees.recettes,
    courses: donnees.courses,
    reglages: donnees.reglages
  };
  const blob = new Blob([JSON.stringify(exportation, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'omni-cooking-' + new Date().toISOString().slice(0, 10) + '.json' });
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
      if (!window.confirm('Remplacer toutes les recettes et la liste de courses actuelles par celles du fichier « ' + fichier.name + ' » ?')) return;
      donnees.recettes = lu.recettes.map(normaliserRecette);
      donnees.courses = (lu.courses || [])
        .filter((c) => c && c.nom)
        .map((c) => ({ id: c.id || uid(), nom: String(c.nom), quantite: Number(c.quantite) || 0, unite: uniteBase(UNITES.includes(c.unite) ? c.unite : 'pièce'), coche: !!c.coche }));
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
function toast(message) {
  const zone = document.getElementById('toast');
  zone.textContent = message;
  zone.classList.add('visible');
  if (toastMinuteur) clearTimeout(toastMinuteur);
  toastMinuteur = setTimeout(() => zone.classList.remove('visible'), 2600);
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
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

/* ------------------------------------------------------------
   11. Routeur (navigation par ancre : #/…)
   ------------------------------------------------------------ */

function router() {
  const parties = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [vue, arg, sous] = parties;
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

  /* Réglages persistants. */
  appliquerTheme(donnees.reglages.theme);
  appliquerLuminosite(donnees.reglages.luminosite);
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.addEventListener('change', () => appliquerTheme(r.value));
  });
  document.getElementById('luminosite').addEventListener('input', (e) => appliquerLuminosite(e.target.value));

  /* Recherche et filtres. */
  document.getElementById('recherche').addEventListener('input', (e) => { rechercheTexte = e.target.value; rendreAccueil(); });
  document.getElementById('filtre-temps').addEventListener('change', (e) => { filtreTemps = e.target.value; rendreAccueil(); });

  /* Liste de courses. */
  document.getElementById('vider-cochees').addEventListener('click', () => {
    donnees.courses = donnees.courses.filter((c) => !c.coche);
    sauvegarder(); rendreCourses(); toast('Articles cochés retirés');
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
    formaterDenombrable, formaterQuantite, quantiteMiseAJour, normaliserTexte, normaliserRecette
  };
}
