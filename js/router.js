// Hash routing, so back/refresh work on any static host:
//   #/                                   home
//   #/game/<id>                          game page, Next tab
//   #/game/<id>/list[/<itemId>]          Checklist tab (optionally jump to an item)
//   #/game/<id>/guides                   Guides tab
//   #/game/<id>/guide/<guideId>          one guide
//   #/game/<id>/guide/<guideId>/follow[/<stepId>]   walkthrough follow mode
//   #/search?q=...                       search all games
//   #/settings                           backup, import, reset

let renderFn = null;
let current = null;
const scrollMem = new Map();

export const currentHash = () => location.hash || '#/';

export function parseRoute(hash = currentHash()) {
  const h = hash.replace(/^#\/?/, '');
  const qi = h.indexOf('?');
  const query = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  const path = qi >= 0 ? h.slice(0, qi) : h;
  let parts;
  try {
    parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { name: 'notfound' };
  }
  const [a, b, c, d, e, f] = parts;
  if (!a) return { name: 'home' };
  if (a === 'search') return { name: 'search', q: query.get('q') || '' };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'game' && b) {
    if (!c || c === 'next') return { name: 'game', gameId: b, tab: 'next' };
    if (c === 'list') return { name: 'game', gameId: b, tab: 'list', focus: d || null };
    if (c === 'guides') return { name: 'game', gameId: b, tab: 'guides' };
    if (c === 'guide' && d) {
      if (e === 'follow') return { name: 'follow', gameId: b, guideId: d, stepId: f || null };
      return { name: 'guide', gameId: b, guideId: d };
    }
  }
  return { name: 'notfound' };
}

function run(scroll) {
  current = currentHash();
  renderFn(parseRoute(current), { scroll, savedScroll: scrollMem.get(current) || 0 });
}

export function init(fn) {
  renderFn = fn;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const onPop = () => {
    if (currentHash() !== current) run('restore');
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  document.addEventListener('click', onClick);
  run('top');
}

export function navigate(hash, { replace = false } = {}) {
  if (!hash.startsWith('#')) hash = `#${hash}`;
  if (hash === '#') hash = '#/';
  if (hash === currentHash()) {
    run('keep');
    return;
  }
  scrollMem.set(currentHash(), window.scrollY);
  const depth = history.state?.depth || 0;
  if (replace) history.replaceState({ depth }, '', hash);
  else history.pushState({ depth: depth + 1 }, '', hash);
  run('top');
}

/** Change the address without rendering (e.g. search text, current step). */
export function replaceQuiet(hash) {
  history.replaceState(history.state, '', hash);
  current = currentHash();
}

export function rerender() {
  if (renderFn) run('keep');
}

/** Go back inside the app, or to the fallback page if there's no app history. */
export function goBack(fallback = '#/') {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(fallback, { replace: true });
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const back = e.target.closest('[data-nav="back"]');
  if (back) {
    e.preventDefault();
    goBack(back.dataset.fallback || '#/');
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute('href'), { replace: a.hasAttribute('data-replace') });
}
