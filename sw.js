/* ============================================================
   Omni-Cooking — service worker
   Met en cache la coquille de l'application pour un
   fonctionnement 100 % hors ligne, et gère les mises à jour :
   la nouvelle version s'installe en arrière-plan, puis est
   activée quand l'utilisateur clique sur « Mise à jour ».

   Le nom du cache est dérivé d'une empreinte SHA-256 du contenu
   des fichiers mis en cache : toute modification d'un fichier
   produit automatiquement un nouveau cache (plus besoin de
   changer un numéro de version à la main).
   ============================================================ */

const PREFIXE_CACHE = 'omni-cooking-';
let CACHE = null; // renseigné à l'installation

/* Coquille de l'application, mise en cache dès l'installation. */
const COQUILLE = [
  './',
  './index.html',
  './css/styles.css',
  './js/pdf.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './LICENSE'
];

/* Empreinte SHA-256 (16 premiers caractères hex) du contenu de la coquille. */
async function empreinteCoquille() {
  const morceaux = [];
  for (const f of COQUILLE) {
    const reponse = await fetch(f);
    morceaux.push(new Uint8Array(await reponse.arrayBuffer()));
  }
  const total = morceaux.reduce((n, m) => n + m.byteLength, 0);
  const buf = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) { buf.set(m, decalage); decalage += m.byteLength; }
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/* Nom du cache de cette instance du worker (avec repli si non calculé). */
async function cacheActuel() {
  if (CACHE) return CACHE;
  const cles = await caches.keys();
  CACHE = cles.find((c) => c.startsWith(PREFIXE_CACHE)) || PREFIXE_CACHE + 'inconnu';
  return CACHE;
}

/* Installation : on calcule l'empreinte, on remplit le cache correspondant,
   sans prendre le contrôle tout de suite (la page ouverte reste sur
   l'ancienne version jusqu'au clic sur « Mise à jour »). */
self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    try {
      CACHE = PREFIXE_CACHE + await empreinteCoquille();
    } catch (e) {
      CACHE = PREFIXE_CACHE + 'v1';
    }
    const cache = await caches.open(CACHE);
    await cache.addAll(COQUILLE);
  })());
});

/* Activation : on supprime les anciens caches « omni-cooking-* », puis on prend le contrôle. */
self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const nom = await cacheActuel();
    const cles = await caches.keys();
    await Promise.all(
      cles.filter((cle) => cle.startsWith(PREFIXE_CACHE) && cle !== nom).map((cle) => caches.delete(cle))
    );
    await self.clients.claim();
  })());
});

/* Réception des requêtes. */
self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  /* Fichiers de l'application : cache d'abord, réseau ensuite. */
  if (url.origin === self.location.origin) {
    evenement.respondWith((async () => {
      const cache = await caches.open(await cacheActuel());
      const enCache = await cache.match(requete);
      if (enCache) return enCache;
      try {
        const reponse = await fetch(requete);
        cache.put(requete, reponse.clone());
        return reponse;
      } catch (e) {
        /* Hors ligne et absent du cache : repli sur la page principale. */
        if (requete.mode === 'navigate') return cache.match('./index.html');
        return Response.error();
      }
    })());
    return;
  }

  /* Polices de la charte (Oxanium, Literata, JetBrains Mono) :
     réseau d'abord avec mise en cache, pour fonctionner hors ligne ensuite. */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evenement.respondWith((async () => {
      const cache = await caches.open(await cacheActuel());
      const enCache = await cache.match(requete);
      const reseau = fetch(requete).then((reponse) => {
        cache.put(requete, reponse.clone());
        return reponse;
      }).catch(() => enCache);
      return enCache || reseau;
    })());
  }
});

/* Message envoyé par la page quand l'utilisateur demande la mise à jour. */
self.addEventListener('message', (evenement) => {
  if (evenement.data && evenement.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
