const CACHE_NAME = 'flux-asistencia-v2';
const ASSETS_TO_CACHE = [
  '/asistencia',
  '/',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo interceptar peticiones GET
  if (req.method !== 'GET') {
    return;
  }

  // No interceptar peticiones directas a Supabase (auth, base de datos, edge functions)
  if (req.url.includes('supabase.co') || req.url.includes('/rest/v1') || req.url.includes('/functions/v1')) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Guardar copia en cache si es una respuesta válida del sitio local
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || req.url.includes('/_next/'))
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback offline
        return caches.match(req).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (req.mode === 'navigate') {
            // Si no tiene internet, devolver la pantalla principal que ya está precacheada
            return caches.match('/asistencia') || caches.match('/');
          }
        });
      })
  );
});
