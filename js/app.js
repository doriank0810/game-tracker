// App entry: wires routing, views, storage, content updates and the
// service worker together.
import * as router from './router.js';
import * as store from './store.js';
import * as data from './data.js';
import { accentStyle } from './util.js';
import { topBar, toast, emptyBox, openLightbox, closeLightbox, lightboxOpen } from './ui.js';
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
    ctx.mount(`${topBar({ title: 'Not found', back: '#/' })}<main class="page">${emptyBox(
      '<p class="empty-title">This page doesn\'t exist</p><p><a class="btn" href="#/">Go to your games</a></p>'
    )}</main>`);
  },
};

let token = 0;
let cleanup = null;

async function render(route, { scroll, savedScroll }) {
  const my = ++token;
  closeLightbox();
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  const slow = setTimeout(() => {
    if (my === token) root.innerHTML = '<main class="page"><p class="loading">Loading…</p></main>';
  }, 200);
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
    ctx.mount(`${topBar({ title: 'Something went wrong', back: '#/' })}<main class="page">${emptyBox(
      `<p class="empty-title">Something went wrong</p><p>${String(err?.message || err).replace(/[<>&]/g, '')}</p><p><button type="button" class="btn" data-act="reload">Reload</button></p>`
    )}</main>`);
  } finally {
    clearTimeout(slow);
  }
  if (my !== token) return;
  if (scroll === 'top') window.scrollTo(0, 0);
  else if (scroll === 'restore') window.scrollTo(0, savedScroll);
}

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
    if (e.key === 'Escape' && lightboxOpen()) {
      e.stopPropagation();
      e.preventDefault();
      closeLightbox();
    }
  },
  true
);

// Images that fail to load are hidden instead of showing a broken icon.
document.addEventListener(
  'error',
  (e) => {
    const el = e.target;
    if (el?.tagName !== 'IMG' || !el.matches('.md-img, .step-img')) return;
    el.hidden = true;
    el.closest('.step-figure')?.setAttribute('hidden', '');
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
    toast("Couldn't save on this device (storage full or blocked). Export a backup from Settings.");
  }
});

let contentPending = false;
data.onUpdate(() => {
  if (isTyping()) contentPending = true;
  else {
    router.rerender();
    toast('Loaded the newest game content.');
  }
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (contentPending && !isTyping()) {
      contentPending = false;
      router.rerender();
    }
  }, 60);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') data.refresh();
});

router.init(render);

// Service worker (offline support). Needs https:// or localhost.
if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable:', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    toast('A new version of the app is ready.', {
      action: 'Reload',
      onAction: () => {
        reloading = true;
        location.reload();
      },
    });
  });
}
