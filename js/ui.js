// Shared building blocks: top bar, item rows, toasts, image zoom.
import * as store from './store.js';
import * as data from './data.js';
import { icons } from './icons.js';
import { esc, enc, relTime } from './util.js';
import { STATUS_ORDER, STATUS_LABEL } from './content.js';
import { renderMarkdown } from './markdown.js';
import { isDone, countValue, guideTally, firstOpenStep, stepDone, tally, effectiveStatus } from './progress.js';
import { rerender } from './router.js';
import { openItems, okey } from './state.js';
import { videoLinkHTML } from './clip.js';

// Page chrome ----------------------------------------------------------------

/**
 * Sticky top bar. `actions` (HTML) replaces the default search + settings
 * buttons on the right; `sub` is a small line under the title.
 */
export function topBar({ title = '', back = null, noSearch = false, noSettings = false, actions = null, sub = '' } = {}) {
  const lead = back
    ? `<button type="button" class="icon-btn" data-nav="back" data-fallback="${esc(back)}" aria-label="Back">${icons.back}</button>`
    : `<img class="brand-mark" src="icons/icon-192.png" alt="" width="28" height="28">`;
  const right =
    actions ??
    `${noSearch ? '' : `<a class="icon-btn" href="#/search" aria-label="Search all games">${icons.search}</a>`}
    ${noSettings ? '' : `<a class="icon-btn" href="#/settings" aria-label="Settings">${icons.settings}</a>`}`;
  return `<header class="topbar"><div class="topbar-inner">
    ${lead}
    <div class="topbar-titles"><h1 class="topbar-title">${esc(title)}</h1>${sub ? `<div class="topbar-sub">${esc(sub)}</div>` : ''}</div>
    ${right}
  </div></header>`;
}

export const menuButton = (label = 'Game menu') =>
  `<button type="button" class="icon-btn" data-act="menu" aria-label="${esc(label)}" aria-haspopup="dialog">${icons.more}</button>`;

export const statusChip = (s) => `<span class="chip st-${s}">${STATUS_LABEL[s] || s}</span>`;

/** Four status buttons (used in the game menu). */
export function statusButtons(status) {
  return `<div class="seg seg-wide" role="group" aria-label="Status">${STATUS_ORDER.map(
    (s) =>
      `<button type="button" class="st-${s}" data-status="${s}" aria-pressed="${s === status}">${STATUS_LABEL[s]}</button>`
  ).join('')}</div>`;
}

export const emptyBox = (html) => `<div class="empty">${html}</div>`;

export function errorBox(title, message, retry = true) {
  return `<div class="empty error"><p class="empty-title">${esc(title)}</p><p>${esc(message || '')}</p>${
    retry ? '<p><button type="button" class="btn" data-act="reload">Try again</button></p>' : ''
  }</div>`;
}

export const offlineNote = () =>
  `<div class="notice">You're offline. Showing the last saved copy of this game's content.</div>`;

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

// Game pages -------------------------------------------------------------------

/**
 * Mount a game page: slim top bar (back, title, ⋯ menu) and the body.
 * Anything with data-act="menu" opens the game menu. Returns <main>.
 */
export function gamePage(ctx, entry, { title, back, sub = '', body = '', cls = '' }) {
  const { game } = entry;
  if (
    !ctx.mount(
      `${topBar({ title, back, sub, actions: menuButton() })}<main class="page page-game${cls ? ` ${cls}` : ''}">${
        entry.offline ? offlineNote() : ''
      }${body}</main>`,
      { accent: game.accent }
    )
  )
    return null;
  document.title = `${title === game.title ? '' : `${title} · `}${game.title} · Game Tracker`;
  const onMenu = (e) => {
    if (e.target.closest('[data-act="menu"]')) openGameMenu(game);
  };
  ctx.root.querySelector('.topbar')?.addEventListener('click', onMenu);
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
  const loadouts = game.layout.type === 'loadouts';
  if (game.layout.type !== 'story') links.push([`#/game/${id}`, icons.grid, loadouts ? 'Classes' : game.layout.picker, '']);
  if (loadouts && game.items.length) links.push([`#/game/${id}/groups`, icons.star, game.layout.checklist, `${t.done}/${t.total}`]);
  if (game.items.length) links.push([`#/game/${id}/list`, icons.list, loadouts ? 'Full checklist' : 'Checklist', `${t.done}/${t.total} · ${t.pct}%`]);
  if (game.guides.length) links.push([`#/game/${id}/guides`, icons.book, 'All guides', String(game.guides.length)]);
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
    html: `<p class="menu-meta">${game.platform ? `${esc(game.platform)} · ` : ''}${
      gp.lastPlayed ? `Played ${esc(relTime(gp.lastPlayed))}` : 'Not played yet'
    }</p>
      <h3 class="label menu-label">Status</h3>
      ${statusButtons(status)}
      <div class="menu-label-row"><label class="label menu-label" for="gt-note">Where I left off</label><span class="note-state" aria-live="polite"></span></div>
      <textarea id="gt-note" class="note" rows="2" placeholder="Where you saved, what you were in the middle of…">${esc(gp.note)}</textarea>
      <div class="link-list menu-links">${links
        .map(
          ([href, icon, label, meta]) =>
            `<a class="link-row" href="${href}"><span class="link-icon">${icon}</span><span class="link-main"><span class="link-title">${esc(
              label
            )}</span></span>${meta ? `<span class="link-meta">${esc(meta)}</span>` : ''}${icons.chevron}</a>`
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
    note.style.height = `${Math.max(note.scrollHeight + 2, 64)}px`;
  };
  requestAnimationFrame(autosize);
  note.addEventListener('input', () => {
    autosize();
    pending = true;
    state.textContent = 'Saving…';
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
    body.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
}

/** One-line reminder of the "where I left off" note (opens the menu). */
export function noteStrip(game) {
  const note = store.game(game.id).note.trim();
  if (!note) return '';
  const line = note.split('\n')[0];
  return `<button type="button" class="note-strip" data-act="menu" aria-label="Your note: ${esc(line)}. Edit">${icons.note}<span>${esc(
    line
  )}</span></button>`;
}

export const sectionHref = (game, section) => `#/game/${enc(game.id)}/section/${enc(section.id)}`;
export const groupHref = (game, group) => `#/game/${enc(game.id)}/group/${enc(group.section.id)}/${enc(group.id)}`;

export const guideHref = (game, guide) => `#/game/${enc(game.id)}/guide/${enc(guide.id)}`;
export const followHref = (game, guide, step) =>
  `${guideHref(game, guide)}/follow${step ? `/${enc(step.id)}` : ''}`;

/** "Start", "Continue at step 4" or "Follow again" for a walkthrough. */
export function followLabel(game, guide) {
  const gp = store.game(game.id);
  const t = guideTally(gp, guide);
  if (!t.total) return 'Open walkthrough';
  if (t.done === 0) return 'Follow guide';
  if (t.done === t.total) return 'Follow again';
  return `Continue at step ${firstOpenStep(gp, guide) + 1}`;
}

export function guideLinkHTML(game, guide) {
  const gp = store.game(game.id);
  let meta = '';
  if (guide.kind === 'walkthrough') {
    const t = guideTally(gp, guide);
    meta = `<span class="link-meta">${icons.steps}Walkthrough · ${t.done}/${t.total} steps</span>`;
  } else {
    const linked = game.items.filter((it) => it.guide === guide.id);
    if (linked.length) {
      const done = linked.filter((it) => isDone(gp, it)).length;
      meta = `<span class="link-meta">${done}/${linked.length} checklist items done</span>`;
    }
  }
  return `<a class="link-row" href="${guideHref(game, guide)}"><span class="link-main"><span class="link-title">${esc(
    guide.title
  )}</span>${meta}</span>${icons.chevron}</a>`;
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
  const meta = opts.meta || tags || badge
    ? `<div class="item-meta">${opts.meta ? `<span class="where">${opts.meta}</span>` : ''}${badge}${tags}</div>`
    : '';
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
  const cls = ['item', done && 'is-done', pinned && 'is-pinned', open && 'is-open', counter && 'is-counter']
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}" data-game="${esc(game.id)}" data-id="${esc(item.id)}"${opts.link ? ' data-link="1"' : ''}${
    opts.hideGuide ? ' data-hide-guide="1"' : ''
  }>
    <div class="item-row">
      ${lead}
      <div class="item-main" ${mainAttrs}>
        <div class="item-title">${esc(item.title)}${expandable ? `<span class="chev">${icons.chevron}</span>` : ''}</div>
        ${meta}
      </div>
      <button type="button" class="pin" data-act="pin" aria-pressed="${pinned}" aria-label="${
        pinned ? 'Unpin from Next' : 'Pin to Next'
      }">${icons.pin}</button>
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
      actions.push(
        `<a class="chip-link primary" href="${followHref(game, guide)}">${icons.play}<span>${esc(followLabel(game, guide))}</span></a>`
      );
      actions.push(`<a class="chip-link" href="${guideHref(game, guide)}">${icons.steps}<span>All steps</span></a>`);
    } else {
      actions.push(`<a class="chip-link" href="${guideHref(game, guide)}">${icons.book}<span>${esc(guide.title)}</span></a>`);
    }
  }
  if (opts.link) {
    actions.push(
      `<a class="chip-link" href="#/game/${enc(game.id)}/list/${enc(item.id)}">${icons.list}<span>Show in checklist</span></a>`
    );
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
    if (nowDone && !wasDone && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {
        /* not supported */
      }
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
      toast(`All steps done. Ticked “${ticked[0].title}”${more} in your checklist.`);
    }
  }
  return { tally: after, ticked };
}

export { stepDone };

// Bottom sheet -----------------------------------------------------------------

let sheet = null;

/**
 * Open a bottom sheet (game menu, step list...). Returns its body element.
 * Closes on the X, a tap outside, Escape, or any page change.
 */
export function openSheet({ title = '', html = '', onClose = null } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  // Carry the game's accent colour (set on #app) into the sheet.
  const accent = document.getElementById('app')?.getAttribute('style');
  if (accent) wrap.setAttribute('style', accent);
  wrap.innerHTML = `<div class="sheet-backdrop" data-sheet-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-sheet-close aria-label="Close">${icons.close}</button></div>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  document.documentElement.classList.add('no-scroll');
  sheet = { wrap, onClose, lastFocus: document.activeElement };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) closeSheet();
  });
  requestAnimationFrame(() => {
    wrap.classList.add('open');
    wrap.querySelector('.sheet').focus({ preventScroll: true });
  });
  return wrap.querySelector('.sheet-body');
}

export function closeSheet() {
  if (!sheet) return;
  const s = sheet;
  sheet = null;
  try {
    s.onClose?.();
  } catch (err) {
    console.error(err);
  }
  s.wrap.remove();
  if (!lightbox) document.documentElement.classList.remove('no-scroll');
  if (s.lastFocus?.isConnected) s.lastFocus.focus?.({ preventScroll: true });
}

export const sheetOpen = () => !!sheet;

// Toast ----------------------------------------------------------------------

let toastEl = null;
let toastTimer = null;

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
    action ? `<button type="button" class="toast-btn">${esc(action)}</button>` : ''
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
    <button type="button" class="icon-btn lb-close" aria-label="Close picture">${icons.close}</button>
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
