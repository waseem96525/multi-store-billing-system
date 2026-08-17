// Retail POS service worker.
// - App shell (HTML/JS/CSS/images): stale-while-revalidate -> works offline
//   after the first visit.
// - /api GET requests: network-first with cache fallback so pages can show
//   previously fetched data when the network drops.
// - /api POST/PUT/DELETE: never cached; the offline module in the app queues
//   writes in IndexedDB and replays them when the connection returns.
//
// Every fetch handler resolves to a real Response object (never undefined)
// so navigations never surface a "Failed to convert value to 'Response'"
// error to the page.
const CACHE = 'retail-pos-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'])
      )
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cachePutSafely(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Quota exceeded / opaque responses: keep serving without caching.
  }
}

function offlineHtml() {
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:3rem;color:#334155">' +
      '<h1>You are offline</h1>' +
      '<p>Open the app once while online to cache it, then it works without internet.</p>' +
      '</body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network-first, fall back to the last cached response.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) cachePutSafely(request, response);
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      })()
    );
    return;
  }

  // Navigations: network-first; on failure or a 5xx, serve the cached app
  // shell so the SPA keeps working offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) cachePutSafely(request, response);
          else if (response.status >= 500) throw new Error('Server error');
          return response;
        } catch {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          return cached || offlineHtml();
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) cachePutSafely(request, response);
          })
          .catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok) cachePutSafely(request, response);
        return response;
      } catch {
        return new Response('Not found', { status: 404 });
      }
    })()
  );
});