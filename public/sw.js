/**
 * Service worker: the app has to open in a basement with no signal.
 *
 * Everything else about working offline was already here — the cached program
 * in `localStorage`, the outbox that replays writes, the banner — and none of
 * it could be reached, because closing the tab and reopening it without a
 * connection meant the browser could not fetch `index.html` or the bundle. The
 * offline machinery was unreachable in exactly the situation it was built for.
 *
 * Three rules, no more:
 *
 *   - `/api/*` is NEVER cached. The app has its own cache and its own queue,
 *     and a stale set served from here would be a lie the app cannot detect.
 *   - Navigations are network-first, falling back to the cached shell. A new
 *     deploy is picked up on the first online load rather than one after.
 *   - Everything else same-origin is cache-first. Asset filenames carry a
 *     content hash, so a cached one is never the wrong version.
 *
 * Written by hand rather than generated: it is sixty lines, and a build
 * plugin's precache manifest would be one more thing to keep in step.
 */

// Bumping this name is what evicts the previous deploy's assets.
const CACHE = 'kilaje-v1';

/** The shell needed to render anything at all. */
const SHELL = ['/', '/theme.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  // The new worker is useless until it controls pages; skipping the wait means
  // one reload picks up a deploy instead of two.
  event.waitUntil(
    caches
      .open(CACHE)
      // Individually, so one missing file cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Training data is never served from here. The app knows how to be offline;
  // it does not know how to distrust its own cache.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigateOrShell(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/** Network first so a deploy lands, cached shell so the gym still works. */
async function navigateOrShell(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match('/')) ?? (await caches.match('/index.html'));
    if (cached) return cached;
    throw new Error('sin conexión y sin copia local');
  }
}

/** Cache first: hashed filenames mean a hit is always the right version. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}
