// A game's tabs, derived from its layout and content (see games/README.md),
// and the bottom tab bar that switches between them.
//
//   loadouts  Classes (class cards) · <checklist> (e.g. Camos: the weapon
//             grid) · Maps ("… map" guides) · Tips ("Start here" and the rest)
//   maps      Continue (the current map) · Maps (the picker) · Checklist ·
//             Guides (only for guides that belong to no map)
//   story     Next · Checklist · Guides
// A tab only exists when it has something to show. The last tab opened is
// remembered per game (app metadata, not part of backups).
import * as store from './store.js';
import { categoryOrder } from './content.js';
import { whereToContinue } from './progress.js';
import { icons } from './icons.js';
import { enc, esc } from './util.js';
import { navigate, popTo } from './router.js';

const isMapCat = (c) => /\bmaps?\b/i.test(c);

/** Guide categories per loadouts tab. */
export function loadoutCats(game) {
  const cats = categoryOrder(game);
  const checklistCat = game.items.length ? game.layout.checklist : null;
  const cards = cats.filter((c) => game.layout.cards.includes(c));
  const rest = cats.filter((c) => !cards.includes(c) && c !== checklistCat);
  return { cards, checklistCat, maps: rest.filter(isMapCat), tips: rest.filter((c) => !isMapCat(c)) };
}

/**
 * Does the checklist need its own tab? Not when every item is a "built"
 * tick of a class card (it is shown on the cards).
 */
function checklistTab(game) {
  if (!game.items.length) return false;
  if (game.layout.type !== 'loadouts') return true;
  const cardIds = new Set(game.guides.filter((g) => game.layout.cards.includes(g.category)).map((g) => g.id));
  return !game.items.every((it) => it.guide && cardIds.has(it.guide));
}

export function gameTabs(game) {
  if (game._tabs) return game._tabs;
  const tabs = [];
  const guidesIn = (cats) => game.guides.filter((g) => cats.includes(g.category));
  const { type } = game.layout;
  if (type === 'loadouts') {
    const c = loadoutCats(game);
    const showChecklist = checklistTab(game);
    if (guidesIn(c.cards).length) tabs.push({ key: 'classes', label: 'Classes', icon: icons.crosshair, cats: c.cards });
    if (showChecklist) tabs.push({ key: 'checklist', label: game.layout.checklist, icon: icons.swatch, cats: c.checklistCat ? [c.checklistCat] : [] });
    if (guidesIn(c.maps).length) tabs.push({ key: 'maps', label: 'Maps', icon: icons.map, cats: c.maps });
    const tips = showChecklist ? c.tips : [...c.tips, ...(c.checklistCat ? [c.checklistCat] : [])];
    if (guidesIn(tips).length) tabs.push({ key: 'tips', label: 'Tips', icon: icons.bulb, cats: tips });
  } else if (type === 'maps') {
    if (game.sections.length) {
      tabs.push({ key: 'continue', label: 'Continue', icon: icons.playCircle });
      tabs.push({ key: 'maps', label: game.layout.picker, icon: icons.map });
    }
    if (game.items.length) tabs.push({ key: 'checklist', label: game.layout.checklist, icon: icons.listChecks });
    if (game.guides.some((g) => !g.sectionId)) tabs.push({ key: 'guides', label: 'Guides', icon: icons.book });
  } else {
    tabs.push({ key: 'next', label: 'Next', icon: icons.playCircle });
    if (game.items.length) tabs.push({ key: 'checklist', label: game.layout.checklist, icon: icons.listChecks });
    if (game.guides.length) tabs.push({ key: 'guides', label: 'Guides', icon: icons.book });
  }
  if (!tabs.length) tabs.push({ key: 'guides', label: 'Guides', icon: icons.book });
  game._tabs = tabs;
  return tabs;
}

export const hasTab = (game, key) => gameTabs(game).some((t) => t.key === key);
export const tabInfo = (game, key) => gameTabs(game).find((t) => t.key === key) || null;
export const tabHref = (game, key) => `#/game/${enc(game.id)}/tab/${enc(key)}`;

export function defaultTab(game) {
  const tabs = gameTabs(game);
  if (game.layout.type === 'maps' && hasTab(game, 'continue') && !whereToContinue(game, store.game(game.id))) return 'maps';
  return tabs[0].key;
}

export function rememberedTab(game) {
  const key = store.getMeta().tabs?.[game.id];
  return key && hasTab(game, key) ? key : null;
}

export function rememberTab(gameId, key) {
  const tabs = { ...(store.getMeta().tabs || {}) };
  if (tabs[gameId] === key) return;
  tabs[gameId] = key;
  store.setMeta({ tabs });
}

// The tab lit on the last game page shown (kept through Follow mode, cleared
// by pages outside a game such as search).
let lastShown = { gameId: null, active: null };

/**
 * The tab a pushed page belongs to: the one it was opened from, else the
 * tab its content lives in (`derived`, e.g. after opening it from search).
 */
export function ownerTab(game, derived = null) {
  if (lastShown.gameId === game.id && hasTab(game, lastShown.active)) return lastShown.active;
  if (derived && hasTab(game, derived)) return derived;
  return rememberedTab(game) || defaultTab(game);
}

/** The tab whose content includes this guide. */
export function tabForGuide(game, guide) {
  const t = gameTabs(game).find((x) => x.cats?.includes(guide.category));
  if (t) return t.key;
  if (game.layout.type === 'maps') return guide.sectionId ? 'maps' : 'guides';
  return 'guides';
}

// Tab bar -------------------------------------------------------------------

let bar = null;
let claimed = false;
let state = { game: null, active: null, root: false, sig: '' };
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.setAttribute('aria-label', 'Sections');
  bar.hidden = true;
  document.body.appendChild(bar);
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab]');
    if (!a || !state.game) return;
    e.preventDefault();
    const game = state.game;
    const key = a.dataset.tab;
    if (state.root && key === state.active) {
      window.scrollTo({ top: 0, behavior: smooth() });
      return;
    }
    setActive(key);
    rememberTab(game.id, key);
    const href = tabHref(game, key);
    if (state.root) navigate(href, { replace: true, scroll: 'restore' });
    else popTo(`game:${game.id}`, href);
  });
  return bar;
}

function setActive(key) {
  const tabs = gameTabs(state.game);
  const i = Math.max(0, tabs.findIndex((t) => t.key === key));
  state.active = key;
  bar.style.setProperty('--i', String(i));
  bar.querySelectorAll('a[data-tab]').forEach((a) => {
    const on = a.dataset.tab === key;
    a.classList.toggle('is-on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/** Called by every render before the view runs; views claim the bar. */
export function beginRender() {
  claimed = false;
}

/** After a render: hide the bar if no view claimed it. inGame: the route belongs to a game. */
export function endRender(inGame = false) {
  if (!inGame) lastShown = { gameId: null, active: null };
  if (!claimed && bar) {
    bar.hidden = true;
    document.documentElement.classList.remove('has-tabbar');
  }
}

/** Show the game's tab bar with `active` lit. root: on the tab's own page. */
export function showTabBar(game, active, { root = false, accentStyle = '' } = {}) {
  claimed = true;
  ensureBar();
  const tabs = gameTabs(game);
  const sig = `${game.id}|${tabs.map((t) => `${t.key}:${t.label}`).join(',')}`;
  if (sig !== state.sig) {
    bar.style.setProperty('--n', String(tabs.length));
    bar.innerHTML = `<div class="tabbar-in"><span class="tabbar-pill" aria-hidden="true"></span>${tabs
      .map(
        (t) =>
          `<a class="tab" href="${tabHref(game, t.key)}" data-tab="${esc(t.key)}"><span class="tab-icon">${t.icon}</span><span class="tab-label">${esc(
            t.label
          )}</span></a>`
      )
      .join('')}</div>`;
    // No slide on the first paint for this game.
    bar.classList.add('no-anim');
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('no-anim')));
  }
  if (accentStyle) bar.setAttribute('style', `${accentStyle};--n:${tabs.length};--i:${bar.style.getPropertyValue('--i') || 0}`);
  state = { game, active: state.active, root, sig };
  lastShown = { gameId: game.id, active };
  bar.classList.toggle('is-sub', !root);
  setActive(active);
  bar.hidden = false;
  document.documentElement.classList.add('has-tabbar');
}
