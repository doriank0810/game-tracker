// Shared building blocks: nav bar, game banner and page shell, item rows,
// sheets, toasts, image zoom.
import * as store from './store.js';
import * as data from './data.js';
import { icons } from './icons.js';
import { esc, enc, relTime, accentStyle } from './util.js';
import { STATUS_ORDER, STATUS_LABEL } from './content.js';
import { renderMarkdown } from './markdown.js';
import { isDone, countValue, guideTally, firstOpenStep, stepDone, tally, effectiveStatus } from './progress.js';
import { rerender, markRoot } from './router.js';
import { openItems, okey } from './state.js';
import { videoLinkHTML } from './clip.js';
import { ownerTab, tabInfo, tabHref, showTabBar, rememberTab, hasTab } from './tabs.js';

// Nav bar ----------------------------------------------------------------------

/**
 * Fixed top bar. back: { href, label } (history back, href as fallback) or
 * { home: true } (pop to the game list). overlay: sits on a banner and only
 * gets its background (and title) once the page scrolls under it. The title
 * shows once the element marked data-title-anchor has scrolled away (or
 * always, when the page has none).
 */
export function navBar({ back = null, title = '', actions = '', overlay = false } = {}) {
  let lead = '';
  if (back?.home) {
    lead = `<button type="button" class="nav-back" data-nav="home" aria-label="Back to your games">${icons.back}<span>${esc(back.label || 'Games')}</span></button>`;
  } else if (back) {
    lead = `<button type="button" class="nav-back" data-nav="back" data-fallback="${esc(back.href || '#/')}" aria-label="Back${
      back.label ? ` to ${esc(back.label)}` : ''
    }">${icons.back}<span>${esc(back.label || 'Back')}</span></button>`;
  }
  return `<header class="navbar${overlay ? ' is-overlay' : ''}"><div class="navbar-in">
    <div class="nav-lead">${lead}</div>
    <div class="nav-title" aria-hidden="true">${esc(title)}</div>
    <div class="nav-actions">${actions}</div>
  </div></header>`;
}

export const iconLink = (href, icon, label) => `<a class="nav-icon" href="${esc(href)}" aria-label="${esc(label)}">${icon}</a>`;

/** Simple page chrome (search, settings, errors). */
export function topBar({ title = '', back = null, backLabel = 'Back', noSearch = false, noSettings = false, actions = null } = {}) {
  const right =
    actions ??
    `${noSearch ? '' : iconLink('#/search', icons.search, 'Search all games')}${noSettings ? '' : iconLink('#/settings', icons.settings, 'Settings')}`;
  return navBar({ back: back ? { href: back, label: backLabel } : null, title, actions: right });
}

/** A large page title under the nav bar (it moves into the bar on scroll). */
export const largeTitle = (title, sub = '') =>
  `<div class="large-title"><h1 data-title-anchor>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;

export const menuButton = (label = 'Game menu') =>
  `<button type="button" class="nav-icon" data-act="menu" aria-label="${esc(label)}" aria-haspopup="dialog">${icons.more}</button>`;

/** Four status buttons (used in the game menu). */
export function statusButtons(status) {
  return `<div class="seg seg-status" role="group" aria-label="Status">${STATUS_ORDER.map(
    (s) => `<button type="button" data-status="${s}" aria-pressed="${s === status}">${STATUS_LABEL[s]}</button>`
  ).join('')}</div>`;
}

export const emptyBox = (html) => `<div class="empty">${html}</div>`;

export function errorBox(title, message, retry = true) {
  return `<div class="empty error"><p class="empty-title">${esc(title)}</p><p>${esc(message || '')}</p>${
    retry ? '<p><button type="button" class="btn" data-act="reload">Try again</button></p>' : ''
  }</div>`;
}

export const offlineNote = () => `<div class="notice">You're offline. Showing the last saved copy of this game.</div>`;

export const whereHTML = (item) => `${esc(item.section.title)} › ${esc(item.group.title)}`;

export function mdCtx(game, extra = {}) {
  return {
    guideHref: (id) => (game.guideById.has(id) ? `#/game/${enc(game.id)}/guide/${enc(id)}` : null),
    imageSrc: (path) => data.mediaUrl(path),
    videoLink: videoLinkHTML,
    ...extra,
  };
}

export const md = (game, src, extra) => renderMarkdown(src, mdCtx(game, extra));

/** Section heading with an optional count on the right. */
export const head = (title, count = '', extra = '') =>
  `<div class="sec-h"><h2>${esc(title)}</h2>${count !== '' ? `<span class="sec-n">${count}</span>` : ''}${extra}</div>`;

/** A remote/local picture that hides itself when broken. */
export function artImg(src, cls, { eager = false } = {}) {
  const url = src ? data.mediaUrl(src) : null;
  if (!url) return '';
  return `<img class="${cls}" src="${esc(url)}" alt="" decoding="async"${eager ? '' : ' loading="lazy"'} referrerpolicy="no-referrer" draggable="false">`;
}

// Game pages -------------------------------------------------------------------

/** The game's artwork as a banner, with its title (tab pages). */
function bannerHTML(game, meta) {
  const art = game.hero || game.cover;
  return `<header class="ghead${art ? '' : ' no-art'}${!game.hero && game.cover ? ' is-cover' : ''}">
    <div class="ghead-art">${art ? artImg(art, 'ghead-img', { eager: true }) : ''}</div>
    <div class="ghead-text">
      <h1 class="ghead-title${game.title.length > 22 ? ' is-long' : ''}" data-title-anchor>${esc(game.title)}</h1>
      ${meta ? `<div class="ghead-meta">${meta}</div>` : ''}
    </div>
  </header>`;
}

function bannerMeta(game) {
  const gp = store.game(game.id);
  const note = gp.note.trim();
  if (note) {
    return `<button type="button" class="ghead-note" data-act="menu" aria-label="Your note: ${esc(note.split('\n')[0])}. Edit">${icons.note}<span>${esc(
      note.split('\n')[0]
    )}</span></button>`;
  }
  return esc([game.platform, gp.lastPlayed ? `Played ${relTime(gp.lastPlayed)}` : ''].filter(Boolean).join(' · '));
}

/**
 * Mount a game page and its tab bar. Returns <main> (or null if outdated).
 *   root: true  a tab's own page: banner with the game art, "Games" back
 *   root: false a page pushed from a tab: back to that tab, the tab stays lit
 * opts: { tab (root: the tab; pushed: where its content lives, used when
 * it wasn't opened from a tab), title, back, backLabel, body, cls, actions }
 */
export function gamePage(ctx, entry, opts) {
  const { game } = entry;
  const root = !!opts.root;
  // A tab's own page lights that tab; a pushed page lights the tab it came from.
  const tab = root && opts.tab && hasTab(game, opts.tab) ? opts.tab : ownerTab(game, opts.tab);
  const info = tabInfo(game, tab);
  const nav = navBar({
    back: root ? { home: true, label: 'Games' } : { href: opts.back || tabHref(game, tab), label: opts.backLabel || info?.label || 'Back' },
    title: opts.title || game.title,
    actions: `${opts.actions || ''}${menuButton()}`,
    overlay: root,
  });
  const html = `${nav}${root ? bannerHTML(game, bannerMeta(game)) : ''}<main class="page page-game${root ? ' is-root' : ''}${
    opts.cls ? ` ${opts.cls}` : ''
  }">${entry.offline ? offlineNote() : ''}${opts.body || ''}</main>`;
  if (!ctx.mount(html, { accent: game.accent })) return null;
  showTabBar(game, tab, { root, accentStyle: accentStyle(game.accent) });
  if (root) {
    rememberTab(game.id, tab);
    markRoot(`game:${game.id}`);
  }
  document.title = `${opts.title && opts.title !== game.title ? `${opts.title} · ` : ''}${game.title}`;
  const onMenu = (e) => {
    if (e.target.closest('[data-act="menu"]')) openGameMenu(game);
  };
  ctx.root.querySelector('.navbar')?.addEventListener('click', onMenu);
  ctx.root.querySelector('.ghead')?.addEventListener('click', onMenu);
  const main = ctx.root.querySelector('main');
  main.addEventListener('click', onMenu);
  return main;
}

/** Status, "where I left off" note and links, behind the ⋯ button. */
export function openGameMenu(game) {
  const gp = store.game(game.id);
  const status = effectiveStatus(game.baseStatus, gp);
  const t = tally(gp, game.items);
  const id = enc(game.id);
  const links = [];
  const listIsTab = hasTab(game, 'checklist') && game.layout.type !== 'loadouts';
  if (game.items.length && !listIsTab) links.push([`#/game/${id}/list`, icons.listChecks, 'Full checklist', `${t.done}/${t.total}`]);
  if (game.guides.length && !hasTab(game, 'guides')) links.push([`#/game/${id}/guides`, icons.book, 'All guides', String(game.guides.length)]);
  links.push(['#/search', icons.search, 'Search all games', '']);
  links.push(['#/settings', icons.settings, 'Settings and backup', '']);
  const openedAt = location.hash;
  let timer = null;
  let pending = false;
  let changed = false;
  let note = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!pending || !note) return;
    pending = false;
    store.setNote(game.id, note.value);
    changed = true;
  };
  const body = openSheet({
    title: game.title,
    html: `<p class="menu-meta">${[game.platform, gp.lastPlayed ? `Played ${relTime(gp.lastPlayed)}` : 'Not played yet'].filter(Boolean).map(esc).join(' · ')}</p>
      <div class="field-label">Status</div>
      ${statusButtons(status)}
      <div class="field-label-row"><label class="field-label" for="gt-note">Where I left off</label><span class="note-state" aria-live="polite"></span></div>
      <textarea id="gt-note" class="note" rows="2" placeholder="Where you saved, what you were in the middle of">${esc(gp.note)}</textarea>
      <div class="group-list menu-links">${links
        .map(
          ([href, icon, label, meta]) =>
            `<a class="row-link" href="${href}"><span class="row-icon">${icon}</span><span class="row-main"><span class="row-title">${esc(
              label
            )}</span></span>${meta ? `<span class="row-meta">${esc(meta)}</span>` : ''}<span class="row-chev">${icons.chevron}</span></a>`
        )
        .join('')}</div>`,
    onClose: () => {
      flush();
      if (changed) setTimeout(() => location.hash === openedAt && rerender(), 0);
    },
  });
  note = body.querySelector('#gt-note');
  const state = body.querySelector('.note-state');
  const autosize = () => {
    note.style.height = 'auto';
    note.style.height = `${Math.max(note.scrollHeight + 2, 72)}px`;
  };
  requestAnimationFrame(autosize);
  note.addEventListener('input', () => {
    autosize();
    pending = true;
    state.textContent = 'Saving';
    clearTimeout(timer);
    timer = setTimeout(() => {
      flush();
      state.textContent = 'Saved';
    }, 600);
  });
  note.addEventListener('blur', () => {
    if (!pending) return;
    flush();
    state.textContent = 'Saved';
  });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const v = b.dataset.status;
    store.setStatus(game.id, v === game.baseStatus ? null : v);
    changed = true;
    body.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}

export const sectionHref = (game, section) => `#/game/${enc(game.id)}/section/${enc(section.id)}`;
export const groupHref = (game, group) => `#/game/${enc(game.id)}/group/${enc(group.section.id)}/${enc(group.id)}`;

export const guideHref = (game, guide) => `#/game/${enc(game.id)}/guide/${enc(guide.id)}`;
export const followHref = (game, guide, step) => `${guideHref(game, guide)}/follow${step ? `/${enc(step.id)}` : ''}`;

/** "Follow guide", "Continue at step 4" or "Follow again" for a walkthrough. */
export function followLabel(game, guide) {
  const gp = store.game(game.id);
  const t = guideTally(gp, guide);
  if (!t.total) return 'Open walkthrough';
  if (t.done === 0) return 'Follow guide';
  if (t.done === t.total) return 'Follow again';
  return `Continue at step ${firstOpenStep(gp, guide) + 1}`;
}

/** First line of plain text in a guide, for previews. */
export function excerpt(guide, max = 96) {
  const src = guide.kind === 'walkthrough' ? guide.intro : guide.body;
  for (const raw of String(src || '').split('\n')) {
    const l = raw.trim();
    if (!l || /^(#|\||-{3,}|!\[|```|>)/.test(l) || /^[-*]\s*$/.test(l)) continue;
    const t = l
      .replace(/^[-*+]\s+|^\d+[.)]\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/▶\s*/g, '')
      .trim();
    if (!t) continue;
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }
  return '';
}

/** A guide's text in a sheet (the levelling guide, the camo table...). lead: HTML above it. */
export function guideSheet(game, guide, { lead = '' } = {}) {
  openSheet({
    title: guide.title,
    cls: 'sheet-tall',
    html: `<div class="hsheet">${lead}<div class="md md-sheet">${guide.body ? md(game, guide.body) : '<p class="muted">Empty</p>'}</div>
      <a class="text-btn hsheet-open" href="${guideHref(game, guide)}">${icons.book}<span>Open as a page</span></a></div>`,
  });
}

export function guideLinkHTML(game, guide) {
  const gp = store.game(game.id);
  let meta = '';
  if (guide.kind === 'walkthrough') {
    const t = guideTally(gp, guide);
    meta = `Walkthrough · ${t.done}/${t.total} steps`;
  } else {
    const linked = game.items.filter((it) => it.guide === guide.id);
    if (linked.length) meta = `${linked.filter((it) => isDone(gp, it)).length}/${linked.length} in your checklist`;
    else meta = excerpt(guide, 72);
  }
  return `<a class="row-link" href="${guideHref(game, guide)}"><span class="row-main"><span class="row-title">${esc(guide.title)}</span>${
    meta ? `<span class="row-sub">${esc(meta)}</span>` : ''
  }</span><span class="row-chev">${icons.chevron}</span></a>`;
}

// Item rows ------------------------------------------------------------------

const ringPct = (v, target) => (target ? Math.round((v / target) * 100) : 0);

function guideBadge(game, item) {
  const guide = item.guide && game.guideById.get(item.guide);
  if (!guide) return '';
  if (guide.kind === 'walkthrough' && guide.steps.length) {
    const t = guideTally(store.game(game.id), guide);
    return `<span class="has-guide">${icons.steps}${t.done}/${t.total} steps</span>`;
  }
  return `<span class="has-guide">${icons.book}Guide</span>`;
}

/**
 * One checklist item. opts:
 *  meta: extra HTML shown under the title (e.g. "Story › Chapter 2")
 *  link: show "Show in checklist" when opened (search results)
 *  hideGuide: don't offer the item's guide (when already on that guide's page)
 */
export function itemRow(game, item, opts = {}) {
  const gp = store.game(game.id);
  const done = isDone(gp, item);
  const pinned = !!gp.pinned[item.id];
  const counter = item.type === 'counter';
  const showGuide = item.guide && !opts.hideGuide;
  const expandable = !!(item.detail || showGuide || opts.link);
  const open = expandable && openItems.has(okey(game.id, item.id));
  const tags = item.tags.length ? item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : '';
  const badge = showGuide ? guideBadge(game, item) : '';
  const meta =
    opts.meta || tags || badge ? `<div class="item-meta">${opts.meta ? `<span class="where">${opts.meta}</span>` : ''}${badge}${tags}</div>` : '';
  let lead;
  let counterBox = '';
  if (counter) {
    const v = countValue(gp, item);
    lead = `<div class="ring" style="--p:${ringPct(v, item.target)}" aria-hidden="true">${icons.check}</div>`;
    counterBox = `<div class="counter">
      <button type="button" class="step-btn" data-act="dec" aria-label="Minus one">${icons.minus}</button>
      <input class="count-in" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="${item.target}" value="${v}" data-act="set" aria-label="Count for ${esc(item.title)}">
      <span class="count-of">/ ${item.target}</span>
      <button type="button" class="step-btn" data-act="inc" aria-label="Plus one">${icons.plus}</button>
    </div>`;
  } else {
    lead = `<button type="button" class="check" data-act="toggle" role="checkbox" aria-checked="${done}" aria-label="${esc(
      item.title
    )}"><span class="box">${icons.check}</span></button>`;
  }
  const mainAttrs = expandable
    ? `data-act="expand" role="button" tabindex="0" aria-expanded="${open}"`
    : counter
      ? ''
      : 'data-act="toggle"';
  const cls = ['item', done && 'is-done', pinned && 'is-pinned', open && 'is-open', counter && 'is-counter'].filter(Boolean).join(' ');
  return `<div class="${cls}" data-game="${esc(game.id)}" data-id="${esc(item.id)}"${opts.link ? ' data-link="1"' : ''}${
    opts.hideGuide ? ' data-hide-guide="1"' : ''
  }>
    <div class="item-row">
      ${lead}
      <div class="item-main" ${mainAttrs}>
        <div class="item-title">${esc(item.title)}${expandable ? `<span class="chev">${icons.chevronDown}</span>` : ''}</div>
        ${meta}
      </div>
      <button type="button" class="pin" data-act="pin" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin from Next' : 'Pin to Next'}">${icons.pin}</button>
    </div>
    ${counterBox}
    <div class="item-detail">${open ? detailHTML(game, item, opts) : ''}</div>
  </div>`;
}

export function detailHTML(game, item, opts = {}) {
  const parts = [];
  if (item.detail) parts.push(`<div class="md">${md(game, item.detail)}</div>`);
  const actions = [];
  const guide = !opts.hideGuide && item.guide && game.guideById.get(item.guide);
  if (guide) {
    if (guide.kind === 'walkthrough' && guide.steps.length) {
      actions.push(`<a class="chip-link primary" href="${followHref(game, guide)}">${icons.play}<span>${esc(followLabel(game, guide))}</span></a>`);
      actions.push(`<a class="chip-link" href="${guideHref(game, guide)}">${icons.steps}<span>All steps</span></a>`);
    } else {
      actions.push(`<a class="chip-link" href="${guideHref(game, guide)}">${icons.book}<span>${esc(guide.title)}</span></a>`);
    }
  }
  if (opts.link) {
    actions.push(`<a class="chip-link" href="#/game/${enc(game.id)}/list/${enc(item.id)}">${icons.list}<span>Show in checklist</span></a>`);
  }
  if (actions.length) parts.push(`<div class="detail-actions">${actions.join('')}</div>`);
  return parts.join('');
}

/** Patch a rendered row after its progress changed (keeps focus and open state). */
export function updateRow(row, game, item) {
  const gp = store.game(game.id);
  const done = isDone(gp, item);
  const pinned = !!gp.pinned[item.id];
  row.classList.toggle('is-done', done);
  row.classList.toggle('is-pinned', pinned);
  row.querySelector('.check')?.setAttribute('aria-checked', String(done));
  const pin = row.querySelector('.pin');
  if (pin) {
    pin.setAttribute('aria-pressed', String(pinned));
    pin.setAttribute('aria-label', pinned ? 'Unpin from Next' : 'Pin to Next');
  }
  if (item.type === 'counter') {
    const v = countValue(gp, item);
    const input = row.querySelector('.count-in');
    if (input) input.value = String(v);
    row.querySelector('.ring')?.style.setProperty('--p', String(ringPct(v, item.target)));
  }
}

function toggleOpen(row, game, item) {
  const k = okey(game.id, item.id);
  const open = !row.classList.contains('is-open');
  row.classList.toggle('is-open', open);
  row.querySelector('.item-main')?.setAttribute('aria-expanded', String(open));
  const det = row.querySelector('.item-detail');
  if (open) {
    openItems.add(k);
    det.innerHTML = detailHTML(game, item, { link: row.dataset.link === '1', hideGuide: row.dataset.hideGuide === '1' });
  } else openItems.delete(k);
}

/**
 * Handle taps on item rows inside container (event delegation).
 * onChange({ game, item, act, wasDone, nowDone, row }) runs after progress changed.
 */
export function bindItems(container, { onChange } = {}) {
  const handle = (row, act, el) => {
    const game = data.peekGame(row.dataset.game);
    const item = game?.byId.get(row.dataset.id);
    if (!item) return;
    const gp = store.game(game.id);
    const wasDone = isDone(gp, item);
    switch (act) {
      case 'toggle':
        if (item.type === 'counter') return;
        store.setChecked(game.id, item.id, !wasDone);
        break;
      case 'pin':
        store.setPinned(game.id, item.id, !gp.pinned[item.id]);
        break;
      case 'inc':
        store.setCount(game.id, item.id, countValue(gp, item) + 1, item.target);
        break;
      case 'dec':
        store.setCount(game.id, item.id, countValue(gp, item) - 1, item.target);
        break;
      case 'set': {
        const v = parseInt(el.value, 10);
        store.setCount(game.id, item.id, Number.isFinite(v) ? v : 0, item.target);
        break;
      }
      case 'expand':
        toggleOpen(row, game, item);
        return;
      default:
        return;
    }
    const nowDone = isDone(store.game(game.id), item);
    updateRow(row, game, item);
    if (nowDone && !wasDone) {
      buzz();
      pulse(row.querySelector('.check .box, .ring'));
    }
    onChange?.({ game, item, act, wasDone, nowDone, row });
  };

  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !container.contains(el)) return;
    const row = el.closest('.item');
    if (!row || el.dataset.act === 'set' || e.target.closest('a')) return;
    handle(row, el.dataset.act, el);
  });
  container.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches?.('.count-in')) return;
    const row = el.closest('.item');
    if (row) handle(row, 'set', el);
  });
  container.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el.matches?.('.count-in') && e.key === 'Enter') {
      el.blur();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && el.matches?.('[role="button"][data-act]')) {
      e.preventDefault();
      el.click();
    }
  });
}

/** A short vibration where supported (Android); silent elsewhere. */
export function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    /* not supported */
  }
}

/** One pulse of the thing that just got confirmed. */
export function pulse(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  setTimeout(() => el.classList.remove('pulse'), 400);
}

// Walkthrough steps ----------------------------------------------------------

/**
 * Tick or untick a walkthrough step. When the last step gets ticked, linked
 * checklist items (type "check", autoComplete not false) are ticked too.
 */
export function setStepDone(game, guide, step, on) {
  const before = guideTally(store.game(game.id), guide);
  store.setStep(game.id, guide.id, step.id, on);
  const gp = store.game(game.id);
  const after = guideTally(gp, guide);
  const ticked = [];
  if (on && after.total && after.done === after.total && before.done < before.total) {
    for (const it of game.items) {
      if (it.guide === guide.id && it.type === 'check' && it.autoComplete && !isDone(gp, it)) {
        store.setChecked(game.id, it.id, true);
        ticked.push(it);
      }
    }
    if (ticked.length) {
      const more = ticked.length > 1 ? ` and ${ticked.length - 1} more` : '';
      toast(`All steps done. Ticked “${ticked[0].title}”${more} in your checklist`);
    }
  }
  return { tally: after, ticked };
}

export { stepDone };

// Bottom sheet -----------------------------------------------------------------

let sheet = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Open a bottom sheet (game menu, a camo, a guide...). Returns its body.
 * Closes on the X, a tap outside, a drag down on its top, Escape, or any
 * page change.
 */
export function openSheet({ title = '', html = '', onClose = null, cls = '' } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  // Carry the game's accent colour (set on #app) into the sheet.
  const accent = document.getElementById('app')?.getAttribute('style');
  if (accent) wrap.setAttribute('style', accent);
  wrap.innerHTML = `<div class="sheet-backdrop" data-sheet-close></div>
    <div class="sheet${cls ? ` ${cls}` : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="sheet-top"><span class="sheet-grab" aria-hidden="true"></span>
        <div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2>
          <button type="button" class="sheet-x" data-sheet-close aria-label="Close">${icons.close}</button></div>
      </div>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  document.documentElement.classList.add('no-scroll');
  sheet = { wrap, onClose, lastFocus: document.activeElement };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) closeSheet({ animate: true });
  });
  dragToClose(wrap.querySelector('.sheet'), wrap.querySelector('.sheet-top'));
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    wrap.querySelector('.sheet').focus({ preventScroll: true });
  });
  return wrap.querySelector('.sheet-body');
}

/** The sheet follows a finger dragging its top down; far enough closes it. */
function dragToClose(panel, handle) {
  let y0 = null;
  let dy = 0;
  handle.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || e.target.closest('button')) return;
      y0 = e.touches[0].clientY;
      dy = 0;
      panel.style.transition = 'none';
    },
    { passive: true }
  );
  handle.addEventListener(
    'touchmove',
    (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      // Upwards it resists instead of stopping dead.
      const shown = dy > 0 ? dy : dy / 5;
      panel.style.transform = `translateY(${shown}px)`;
    },
    { passive: true }
  );
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    panel.style.transition = '';
    if (dy > 90) closeSheet({ animate: true });
    else panel.style.transform = '';
  };
  handle.addEventListener('touchend', end);
  handle.addEventListener('touchcancel', end);
}

export function closeSheet({ animate = false } = {}) {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  try {
    s.onClose?.();
  } catch (err) {
    console.error(err);
  }
  if (animate && !reduced()) {
    s.wrap.classList.remove('open');
    s.wrap.classList.add('closing');
    setTimeout(() => s.wrap.remove(), 200);
  } else s.wrap.remove();
  if (!lightbox) document.documentElement.classList.remove('no-scroll');
  if (s.lastFocus?.isConnected) s.lastFocus.focus?.({ preventScroll: true });
}

export const sheetOpen = () => !!sheet;

// Toast ----------------------------------------------------------------------

let toastEl = null;
let toastTimer = null;

/** Hide the toast now (on a page change, its Undo would act on the wrong page). */
export function hideToast() {
  clearTimeout(toastTimer);
  toastEl?.classList.remove('show');
}

export function toast(message, { action, onAction, ms = 3200 } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  const accent = document.getElementById('app')?.getAttribute('style');
  if (accent) toastEl.setAttribute('style', accent);
  else toastEl.removeAttribute('style');
  toastEl.innerHTML = `<span class="toast-msg">${esc(message)}</span>${
    action ? `<button type="button" class="toast-btn">${action === 'Undo' ? icons.undo : ''}<span>${esc(action)}</span></button>` : ''
  }`;
  const hide = () => toastEl.classList.remove('show');
  if (action) {
    toastEl.querySelector('.toast-btn').addEventListener('click', () => {
      hide();
      onAction?.();
    });
  }
  requestAnimationFrame(() => toastEl.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? Math.max(ms, 8000) : ms);
}

// Image zoom -----------------------------------------------------------------

let lightbox = null;
let lastFocus = null;

export function openLightbox(src, alt = '') {
  closeLightbox();
  lastFocus = document.activeElement;
  lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', alt || 'Picture');
  lightbox.innerHTML = `<div class="lb-scroll"><img src="${esc(src)}" alt="${esc(alt)}"></div>
    <button type="button" class="lb-close" aria-label="Close picture">${icons.close}</button>
    <p class="lb-hint">${alt ? `${esc(alt)} · ` : ''}Tap the picture to zoom</p>`;
  document.body.appendChild(lightbox);
  document.documentElement.classList.add('no-scroll');
  const scroller = lightbox.querySelector('.lb-scroll');
  const img = scroller.querySelector('img');
  img.addEventListener('error', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === img) {
      const rx = e.offsetX / img.clientWidth;
      const ry = e.offsetY / img.clientHeight;
      const zoomed = lightbox.classList.toggle('zoomed');
      if (zoomed) {
        scroller.scrollLeft = rx * img.clientWidth - scroller.clientWidth / 2;
        scroller.scrollTop = ry * img.clientHeight - scroller.clientHeight / 2;
      }
      return;
    }
    closeLightbox();
  });
  lightbox.querySelector('.lb-close').focus({ preventScroll: true });
}

export function closeLightbox() {
  if (!lightbox) return;
  lightbox.remove();
  lightbox = null;
  if (!sheet) document.documentElement.classList.remove('no-scroll');
  lastFocus?.focus?.({ preventScroll: true });
}

export const lightboxOpen = () => !!lightbox;

