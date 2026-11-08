/* ============================================================
   Omni-Cooking — service worker
   Met en cache la coquille de l'application pour un
   fonctionnement 100 % hors ligne, et gère les mises à jour :
   la nouvelle version s'installe en arrière-plan, puis est
   activée quand l'utilisateur clique sur « Mise à jour ».
   ============================================================ */

/* Numéro de version du cache : à incrémenter à chaque évolution du code. */
const VERSION = 'v1';
const CACHE = 'omni-cooking-' + VERSION;

/* Coquille de l'application, mise en cache dès l'installation. */
const COQUILLE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './LICENSE'
];

/* Installation : on remplit le cache, sans prendre le contrôle
   tout de suite (la page déjà ouverte reste sur l'ancienne version). */
self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(COQUILLE))
      .catch((erreur) => console.error('Omni-Cooking : échec du pré-cache', erreur))
  );
});

/* Activation : on supprime les anciens caches, puis on prend le contrôle. */
self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== CACHE).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim())
  );
});

/* Réception des requêtes. */
self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  /* Fichiers de l'application : cache d'abord, réseau ensuite. */
  if (url.origin === self.location.origin) {
    evenement.respondWith(
      caches.match(requete).then((enCache) => {
        if (enCache) return enCache;
        return fetch(requete).then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE).then((cache) => cache.put(requete, copie));
          return reponse;
        }).catch(() => {
          /* Hors ligne et absent du cache : repli sur la page principale. */
          if (requete.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
    );
    return;
  }

  /* Polices de la charte (Oxanium, Literata, JetBrains Mono) :
     réseau d'abord avec mise en cache, pour fonctionner hors ligne ensuite. */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evenement.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const enCache = await cache.match(requete);
        const reseau = fetch(requete).then((reponse) => {
          cache.put(requete, reponse.clone());
          return reponse;
        }).catch(() => enCache);
        return enCache || reseau;
      })
    );
  }
});

/* Message envoyé par la page quand l'utilisateur demande la mise à jour. */
self.addEventListener('message', (evenement) => {
  if (evenement.data && evenement.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
