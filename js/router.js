// Hash routing, so back/refresh work on any static host:
//   #/                                   home
//   #/game/<id>                          a game: opens its last tab (or the first one)
//   #/game/<id>/tab/<tab>                one tab of a game (see js/tabs.js)
//   #/game/<id>/section/<sectionId>      one section (a map, for "layout": "maps")
//   #/game/<id>/groups                   checklist group picker (e.g. weapons)
//   #/game/<id>/group/<sectionId>/<groupId>   one checklist group
//   #/game/<id>/list[/<itemId>]          full checklist (optionally jump to an item)
//   #/game/<id>/guides                   all guides
//   #/game/<id>/guide/<guideId>          one guide
//   #/game/<id>/guide/<guideId>/follow[/<stepId>]   walkthrough follow mode
//   #/search?q=...                       search all games
//   #/settings                           backup, import, reset
//
// Every render is told how it was reached (nav): "push" (a link), "pop"
// (back), "replace" (a tab switch), "keep" (same page redrawn) or "init".

let renderFn = null;
let current = null;
const scrollMem = new Map();
// History depth of "root" pages (home, each game's tabs), so the tab bar and
// the Games button can pop straight back to them.
const roots = new Map();
let afterPop = null;
// True while a back the app itself asked for is on its way (its own back
// button or a tab). A system swipe-back already animates, so it must not
// be animated a second time.
let ownBack = false;

export const currentHash = () => location.hash || '#/';
const depth = () => history.state?.depth || 0;

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
    if (!c) return { name: 'game', gameId: b, tab: null };
    if (c === 'tab' && d) return { name: 'game', gameId: b, tab: d };
    if (c === 'next') return { name: 'game', gameId: b, tab: 'next' };
    if (c === 'list') return { name: 'game', gameId: b, page: 'list', focus: d || null };
    if (c === 'guides') return { name: 'game', gameId: b, page: 'guides' };
    if (c === 'section' && d) return { name: 'game', gameId: b, page: 'section', sectionId: d };
    if (c === 'groups') return { name: 'game', gameId: b, page: 'groups' };
    if (c === 'group' && d && e) return { name: 'game', gameId: b, page: 'group', sectionId: d, groupId: e };
    if (c === 'guide' && d) {
      if (e === 'follow') return { name: 'follow', gameId: b, guideId: d, stepId: f || null };
      return { name: 'guide', gameId: b, guideId: d };
    }
  }
  return { name: 'notfound' };
}

function run(scroll, nav) {
  current = currentHash();
  renderFn(parseRoute(current), { scroll, savedScroll: scrollMem.get(current) || 0, nav });
}

export function init(fn) {
  renderFn = fn;
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const onPop = () => {
    if (afterPop) {
      const h = afterPop;
      afterPop = null;
      if (h !== currentHash()) history.replaceState(history.state, '', h);
    }
    const nav = ownBack ? 'pop' : 'instant';
    ownBack = false;
    if (currentHash() !== current) run('restore', nav);
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  document.addEventListener('click', onClick);
  run('top', 'init');
}

/** opts.scroll: "top" (default) or "restore" (where this page was left). */
export function navigate(hash, { replace = false, scroll = 'top' } = {}) {
  if (!hash.startsWith('#')) hash = `#${hash}`;
  if (hash === '#') hash = '#/';
  if (hash === currentHash()) {
    run('keep', 'keep');
    return;
  }
  scrollMem.set(currentHash(), window.scrollY);
  const d = depth();
  if (replace) history.replaceState({ depth: d }, '', hash);
  else history.pushState({ depth: d + 1 }, '', hash);
  run(scroll, replace ? 'replace' : 'push');
}

/** Change the address without rendering (e.g. search text, current step). */
export function replaceQuiet(hash) {
  history.replaceState(history.state, '', hash);
  current = currentHash();
}

export function rerender() {
  if (renderFn) run('keep', 'keep');
}

/** Go back inside the app, or to the fallback page if there's no app history. */
export function goBack(fallback = '#/') {
  if (depth() > 0) {
    ownBack = true;
    history.back();
  }
  else navigate(fallback, { replace: true });
}

/** Remember the history depth of a root page (key: "home", "game:<id>"). */
export function markRoot(key) {
  roots.set(key, depth());
}

/**
 * Pop back to a root page and show `hash` there (e.g. tap a tab while on a
 * weapon page). Without that root in this visit's history, replaces instead.
 */
export function popTo(key, hash) {
  const d = roots.get(key);
  const cur = depth();
  if (d != null && d < cur) {
    scrollMem.set(currentHash(), window.scrollY);
    afterPop = hash;
    ownBack = true;
    history.go(d - cur);
  } else navigate(hash, { replace: true, scroll: 'restore' });
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const back = e.target.closest('[data-nav="back"]');
  if (back) {
    e.preventDefault();
    goBack(back.dataset.fallback || '#/');
    return;
  }
  if (e.target.closest('[data-nav="home"]')) {
    e.preventDefault();
    popTo('home', '#/');
    return;
  }
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute('href'), { replace: a.hasAttribute('data-replace') });
}
