/* Game Tracker service worker.
 *
 * - App shell (HTML, CSS, JS, icons): precached and served cache-first.
 *   >>> Bump VERSION whenever any app file changes, so phones get the update. <<<
 *   (On localhost the shell is network-first, so local edits show up at once.)
 * - Game content (games/*.json): always network-first; the saved copy is only
 *   used when the network fails or hangs (offline). No need to bump VERSION.
 * - Guide pictures (games/**.png|jpg|webp|gif|svg|avif): cached on first view,
 *   then served from the cache and refreshed in the background.
 * - Video clips (youtube-nocookie.com embeds, i.ytimg.com posters, the
 *   youtube.com IFrame API): other origins, so this worker never touches or
 *   caches them; they always come straight from the network.
 */
const VERSION = '1.1.0';
const SHELL_CACHE = `gt-shell-${VERSION}`;
const DATA_CACHE = 'gt-data';
const MEDIA_CACHE = 'gt-media';

const SHELL_FILES = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/router.js',
  'js/store.js',
  'js/data.js',
  'js/content.js',
  'js/progress.js',
  'js/markdown.js',
  'js/util.js',
  'js/icons.js',
  'js/ui.js',
  'js/state.js',
  'js/clip.js',
  'js/views/home.js',
  'js/views/game.js',
  'js/views/hubs.js',
  'js/views/guide.js',
  'js/views/follow.js',
  'js/views/search.js',
  'js/views/settings.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

const SCOPE = new URL('./', self.location.href);
const GAMES_PATH = new URL('games/', SCOPE).pathname;
const INDEX_URL = new URL('index.html', SCOPE).href;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname) || self.location.hostname.endsWith('.localhost');
const NETWORK_TIMEOUT = 8000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES.map((f) => new Request(new URL(f, SCOPE), { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gt-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Other sites (YouTube clips, thumbnails, the IFrame API) go straight to the network, uncached.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (url.pathname.startsWith(GAMES_PATH)) {
    if (url.pathname.endsWith('.json')) return event.respondWith(contentFirst(req));
    if (IMAGE_RE.test(url.pathname)) return event.respondWith(mediaCached(event, req));
    return; // anything else in games/ (e.g. README.md) goes straight to the network
  }
  if (req.mode === 'navigate') return event.respondWith(DEV ? networkThenCache(req, INDEX_URL) : appPage(req));
  event.respondWith(DEV ? networkThenCache(req) : shellFirst(req));
});

/** games/*.json: network first (fresh), saved copy only when offline or very slow. */
async function contentFirst(req) {
  const cache = await caches.open(DATA_CACHE);
  const key = req.url.split('?')[0];
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  network.catch(() => {});
  try {
    return await withTimeout(network, NETWORK_TIMEOUT);
  } catch {
    const saved = await cache.match(key);
    if (saved) return markSaved(saved);
    try {
      return await network;
    } catch {
      return new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'X-GT-Source': 'offline' },
      });
    }
  }
}

/** Pictures: serve the saved copy if there is one, refresh it in the background. */
async function mediaCached(event, req) {
  const cache = await caches.open(MEDIA_CACHE);
  const saved = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (saved) {
    event.waitUntil(network.catch(() => {}));
    return saved;
  }
  return network;
}

async function appPage(req) {
  const saved = await caches.match(INDEX_URL);
  if (saved) return saved;
  return fetch(req);
}

async function shellFirst(req) {
  const saved = await caches.match(req, { ignoreSearch: true });
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(req, res.clone());
  }
  return res;
}

async function networkThenCache(req, fallbackUrl) {
  try {
    const res = await fetch(req);
    const isPage = !fallbackUrl || (res.headers.get('Content-Type') || '').includes('text/html');
    if (res.ok && res.type === 'basic' && isPage) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(fallbackUrl || req, res.clone());
    }
    return res;
  } catch (err) {
    const saved = await caches.match(fallbackUrl || req, { ignoreSearch: true });
    if (saved) return saved;
    throw err;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function markSaved(res) {
  const headers = new Headers(res.headers);
  headers.set('X-GT-Source', 'cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
