// Shared building blocks: top bar, item rows, toasts, image zoom.
import * as store from './store.js';
import * as data from './data.js';
import { icons } from './icons.js';
import { esc, enc } from './util.js';
import { STATUS_ORDER, STATUS_LABEL } from './content.js';
import { renderMarkdown } from './markdown.js';
import { isDone, countValue, guideTally, firstOpenStep, stepDone } from './progress.js';
import { openItems, okey } from './state.js';

// Page chrome ----------------------------------------------------------------

export function topBar({ title = '', back = null, noSearch = false, noSettings = false } = {}) {
  const lead = back
    ? `<button type="button" class="icon-btn" data-nav="back" data-fallback="${esc(back)}" aria-label="Back">${icons.back}</button>`
    : `<img class="brand-mark" src="icons/icon-192.png" alt="" width="28" height="28">`;
  return `<header class="topbar"><div class="topbar-inner">
    ${lead}
    <h1 class="topbar-title">${esc(title)}</h1>
    ${noSearch ? '' : `<a class="icon-btn" href="#/search" aria-label="Search all games">${icons.search}</a>`}
    ${noSettings ? '' : `<a class="icon-btn" href="#/settings" aria-label="Settings">${icons.settings}</a>`}
  </div></header>`;
}

export const statusChip = (s) => `<span class="chip st-${s}">${STATUS_LABEL[s] || s}</span>`;

export function statusSelect(status) {
  const opts = STATUS_ORDER.map(
    (s) => `<option value="${s}"${s === status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`
  ).join('');
  return `<label class="status-wrap"><span class="sr-only">Status</span><select class="status-select st-${status}">${opts}</select></label>`;
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

export function mdCtx(game) {
  return {
    guideHref: (id) => (game.guideById.has(id) ? `#/game/${enc(game.id)}/guide/${enc(id)}` : null),
    imageSrc: (path) => data.mediaUrl(path),
  };
}

export const md = (game, src) => renderMarkdown(src, mdCtx(game));

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
  document.documentElement.classList.remove('no-scroll');
  lastFocus?.focus?.({ preventScroll: true });
}

export const lightboxOpen = () => !!lightbox;
