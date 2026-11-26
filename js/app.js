// App entry: wires routing, views, storage, content updates and the
// service worker together.
import * as router from './router.js';
import * as store from './store.js';
import * as data from './data.js';
import * as tabs from './tabs.js';
import { accentStyle } from './util.js';
import { topBar, toast, hideToast, emptyBox, openLightbox, closeLightbox, lightboxOpen, closeSheet, sheetOpen } from './ui.js';
import { initClips } from './clip.js';
import * as home from './views/home.js';
import * as gameView from './views/game.js';
import * as guideView from './views/guide.js';
import * as followView from './views/follow.js';
import * as searchView from './views/search.js';
import * as settingsView from './views/settings.js';

const root = document.getElementById('app');
const VIEWS = {
  home,
  game: gameView,
  guide: guideView,
  follow: followView,
  search: searchView,
  settings: settingsView,
};

const notFound = {
  render(ctx) {
    ctx.mount(`${topBar({ title: 'Not found', back: '#/', backLabel: 'Games' })}<main class="page">${emptyBox(
      '<p class="empty-title">This page doesn\'t exist</p><p><a class="btn" href="#/">Go to your games</a></p>'
    )}</main>`);
  },
};

let token = 0;
let cleanup = null;

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Page changes animate like a native stack: a pushed page slides in from the
 * right, back slides it away, a tab switch cross-fades. Uses the View
 * Transitions API where available; nothing animates with Reduce Motion.
 */
function render(route, opts) {
  closeLightbox();
  closeSheet();
  if (opts.nav !== 'keep') hideToast();
  const kind = { push: 'push', pop: 'pop', replace: 'fade' }[opts.nav] || null;
  if (kind && typeof document.startViewTransition === 'function' && !reducedMotion() && document.visibilityState === 'visible') {
    const html = document.documentElement;
    html.dataset.vt = kind;
    // The page renders exactly once: inside the transition, or right away if
    // the browser hasn't started it within a moment (e.g. no frames coming).
    let started = false;
    const go = () => {
      if (started) return undefined;
      started = true;
      return doRender(route, opts);
    };
    let vt;
    try {
      vt = document.startViewTransition(go);
    } catch {
      delete html.dataset.vt;
      return go();
    }
    setTimeout(() => {
      if (started) return;
      try {
        vt.skipTransition();
      } catch {
        /* already done */
      }
      go();
    }, 300);
    vt.ready.catch(() => {});
    vt.finished
      .catch(() => {})
      .finally(() => {
        if (html.dataset.vt === kind) delete html.dataset.vt;
      });
    return vt.updateCallbackDone.catch(() => {});
  }
  return doRender(route, opts);
}

async function doRender(route, { scroll, savedScroll }) {
  const my = ++token;
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  tabs.beginRender();
  const slow = setTimeout(() => {
    if (my === token) root.innerHTML = '<main class="page"><p class="loading">Loading</p></main>';
  }, 400);
  const ctx = {
    root,
    route,
    isCurrent: () => my === token,
    mount(html, { accent } = {}) {
      if (my !== token) return false;
      clearTimeout(slow);
      if (accent) root.setAttribute('style', accentStyle(accent));
      else root.removeAttribute('style');
      root.dataset.view = route.name;
      document.title = 'Game Tracker';
      root.innerHTML = html;
      return true;
    },
  };
  try {
    const view = VIEWS[route.name] || notFound;
    const res = await view.render(ctx);
    if (my !== token) {
      if (typeof res === 'function') res();
      return;
    }
    cleanup = typeof res === 'function' ? res : null;
  } catch (err) {
    console.error(err);
    ctx.mount(`${topBar({ title: 'Something went wrong', back: '#/', backLabel: 'Games' })}<main class="page">${emptyBox(
      `<p class="empty-title">Something went wrong</p><p>${String(err?.message || err).replace(/[<>&]/g, '')}</p><p><button type="button" class="btn" data-act="reload">Reload</button></p>`
    )}</main>`);
  } finally {
    clearTimeout(slow);
  }
  if (my !== token) return;
  tabs.endRender(!!route.gameId);
  if (scroll === 'top') window.scrollTo(0, 0);
  else if (scroll === 'restore') window.scrollTo(0, savedScroll);
  updateChrome();
}

// Nav bar: background and title appear once content scrolls under it --------

let chromeQueued = false;
function updateChrome() {
  chromeQueued = false;
  const bar = root.querySelector('.navbar');
  if (!bar) return;
  const h = bar.offsetHeight;
  const anchor = root.querySelector('[data-title-anchor]');
  const titled = anchor ? anchor.getBoundingClientRect().bottom <= h + 2 : true;
  const overlay = bar.classList.contains('is-overlay');
  bar.classList.toggle('is-solid', overlay ? titled : window.scrollY > 2);
  bar.classList.toggle('is-titled', titled);
}
window.addEventListener(
  'scroll',
  () => {
    if (chromeQueued) return;
    chromeQueued = true;
    requestAnimationFrame(updateChrome);
  },
  { passive: true }
);
window.addEventListener('resize', () => requestAnimationFrame(updateChrome));

// Global handlers -------------------------------------------------------------

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="reload"]')) {
    location.reload();
    return;
  }
  const img = e.target.closest('img[data-zoom]');
  if (img && !img.closest('a') && !lightboxOpen()) openLightbox(img.currentSrc || img.src, img.alt);
});

window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && (lightboxOpen() || sheetOpen())) {
      e.stopPropagation();
      e.preventDefault();
      if (lightboxOpen()) closeLightbox();
      else closeSheet({ animate: true });
    }
  },
  true
);

initClips();

// Same name as REMOTE_CACHE in sw.js (pictures from other sites).
const REMOTE_PICS = 'gt-remote-img';

// Images that fail to load are hidden instead of showing a broken icon;
// boxed pictures (.pic) show their placeholder instead.
document.addEventListener(
  'error',
  (e) => {
    const el = e.target;
    if (el?.tagName !== 'IMG') return;
    // A saved copy of a picture from another site that turns out broken is
    // dropped, so the next visit asks the network again.
    try {
      const u = new URL(el.currentSrc || el.src, location.href);
      if (u.protocol === 'https:' && u.origin !== location.origin && 'caches' in window) {
        caches.open(REMOTE_PICS).then((c) => c.delete(u.href)).catch(() => {});
      }
    } catch {
      /* not a URL */
    }
    if (el.matches('.pic-img')) {
      el.hidden = true;
      const box = el.closest('.pic');
      box?.classList.remove('is-loaded');
      box?.classList.add('is-broken');
      return;
    }
    if (el.matches('.ghead-img, .art-img, .art-blur')) {
      el.hidden = true;
      el.closest('.ghead, .art')?.classList.add('no-art');
      return;
    }
    if (!el.matches('.md-img, .step-img, .clip-thumb')) return;
    el.hidden = true;
    el.closest('.step-figure')?.setAttribute('hidden', '');
  },
  true
);
document.addEventListener(
  'load',
  (e) => {
    if (e.target?.tagName === 'IMG' && e.target.matches('.pic-img')) e.target.closest('.pic')?.classList.add('is-loaded');
  },
  true
);

const isTyping = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['button', 'checkbox', 'file'].includes(a.type)));
};

store.load();
store.onChange((e) => {
  if (e.type === 'external' || e.type === 'import') router.rerender();
});
let warnedSave = 0;
store.onChange((e) => {
  if (e.type === 'save-failed' && Date.now() - warnedSave > 20_000) {
    warnedSave = Date.now();
    toast("Couldn't save on this device (storage full or blocked). Export a backup from Settings");
  }
});

let contentPending = false;
data.onUpdate(() => {
  if (isTyping() || sheetOpen()) contentPending = true;
  else {
    router.rerender();
    toast('Loaded the newest game content');
  }
});
const flushPending = () => {
  setTimeout(() => {
    if (contentPending && !isTyping() && !sheetOpen()) {
      contentPending = false;
      router.rerender();
    }
  }, 60);
};
document.addEventListener('focusout', flushPending);
document.addEventListener('click', flushPending);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') data.refresh();
});

router.init(render);

// Service worker (offline support). Needs https:// or localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Look for a new version at every launch and every time the app comes back to the front.
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('Offline mode unavailable:', err));
  let reloading = false;
  // A new version took over: switch to it straight away, no button to find.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}
