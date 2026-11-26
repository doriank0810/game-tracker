// Picture groups (e.g. a weapon and its camos), see js/ladder.js:
//   - picker tiles: the group's picture, name, n/total and a strip
//   - the group page: the picture on a stage, progress, then a segmented
//     control between "Do now" (what to work on, big Done buttons) and the
//     picture grid of every item. Tapping a picture opens it in a sheet.
//   - ticking an item also ticks everything that must have come before it
//     (Gold ticks the military and special camos), with one Undo for all.
import * as store from '../store.js';
import * as data from '../data.js';
import { esc, relTime } from '../util.js';
import { renderInline } from '../markdown.js';
import { tally, isDone } from '../progress.js';
import { gamePage, groupHref, guideHref, openSheet, closeSheet, toast, md, mdCtx, guideSheet, buzz, pulse } from '../ui.js';
import { icons } from '../icons.js';
import { gameUI } from '../state.js';
import {
  ladderOf,
  readItem,
  placeOf,
  isLocked,
  doNow,
  alsoTicks,
  describeItems,
  prereqTally,
  displayTitle,
  initials,
} from '../ladder.js';

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A picture in a fixed-size box (the box's shape comes from CSS, so nothing
 * jumps while it loads). Lazy; a missing or broken picture shows `ph`
 * (text) or `phIcon` (an icon's HTML).
 */
export function picHTML(src, { cls = '', ph = '', alt = '', phIcon = '' } = {}) {
  const url = src ? data.mediaUrl(src) : null;
  return `<span class="pic${cls ? ` ${cls}` : ''}${url ? '' : ' is-broken'}"><span class="pic-ph" aria-hidden="true">${phIcon || esc(ph)}</span>${
    url ? `<img class="pic-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">` : ''
  }</span>`;
}

/** One small cell per item, grouped like the picture grid (lit = done). */
export function stripHTML(group, gp, cls = '') {
  const parts = ladderOf(group).parts;
  if (group.items.length > 40) {
    const t = tally(gp, group.items);
    return `<span class="strip strip-bar${cls}" aria-hidden="true"><span style="width:${t.pct}%"></span></span>`;
  }
  return `<span class="strip${cls}" aria-hidden="true">${parts
    .map((p) => `<span class="strip-part" style="flex-grow:${p.items.length}">${p.items.map((it) => `<i${isDone(gp, it) ? ' class="on"' : ''}></i>`).join('')}</span>`)
    .join('')}</span>`;
}

const isComplete = (gp, g) => g.items.length > 0 && g.items.every((it) => isDone(gp, it));

/** Picker tile for a group with a picture (or pictured items). */
export function groupTileHTML(game, g, gp, { showClass = false } = {}) {
  const t = tally(gp, g.items);
  const on = !!gp.starred[g.key];
  const done = isComplete(gp, g);
  const name = displayTitle(g);
  const label = `${name}${g.class ? `, ${g.class}` : ''}: ${done ? 'all done' : `${t.done} of ${t.total} done`}`;
  return `<div class="wtile${on ? ' is-starred' : ''}${done ? ' is-complete' : ''}" data-key="${esc(g.key)}">
    <a class="wtile-link" href="${groupHref(game, g)}" aria-label="${esc(label)}">
      <span class="wtile-art">${picHTML(g.image, { cls: 'pic-wide', ph: initials(name) })}</span>
      <span class="wtile-name">${esc(name)}</span>
      ${showClass && g.class ? `<span class="wtile-class">${esc(g.class)}</span>` : ''}
      <span class="wtile-foot">${stripHTML(g, gp)}<span class="wtile-n">${done ? `${icons.check}All` : `${t.done}/${t.total}`}</span></span>
    </a>
    <button type="button" class="star-btn wtile-star" data-act="star" aria-pressed="${on}" aria-label="${on ? 'Unstar' : 'Star'} ${esc(name)}">${icons.star}</button>
  </div>`;
}

export { isComplete };

// The group page -----------------------------------------------------------------

const inline = (game, s) => renderInline(s, mdCtx(game));

function tileState(g, it, gp) {
  if (isDone(gp, it)) return { cls: 'is-done', badge: icons.check, label: 'done' };
  if (isLocked(g, it, gp)) return { cls: 'is-locked', badge: icons.lock, label: 'locked' };
  const r = readItem(it);
  const lv = r.level ?? r.opensAt;
  return lv != null ? { cls: 'is-todo', badge: `Lv ${lv}`, label: `not done, level ${lv}` } : { cls: 'is-todo', badge: '', label: 'not done' };
}

function camoTileHTML(g, it, gp) {
  const s = tileState(g, it, gp);
  return `<button type="button" class="ctile ${s.cls}" data-act="camo-open" data-id="${esc(it.id)}" aria-label="${esc(it.title)}: ${s.label}">
    <span class="ctile-box">${picHTML(it.image, { cls: 'pic-sq', ph: initials(it.title) })}<span class="ctile-badge">${s.badge}</span></span>
    <span class="ctile-name">${esc(it.title)}</span>
  </button>`;
}

/** Prerequisite line with progress ("First get Gold on 8 Assault Rifles. 3/8"). */
function prereqHTML(game, g, it, gp, locked, cls) {
  const r = readItem(it);
  if (!r.prereq) return '';
  // Once the item itself is ticked, its prerequisite was met in the game.
  const t = isDone(gp, it) ? null : prereqTally(g, it, gp);
  const met = isDone(gp, it) || (t && t.done >= t.of);
  return `<p class="prq ${cls}${locked ? ' is-locked' : ''}${met ? ' is-met' : ''}">${met ? icons.check : icons.lock}<span>${inline(game, r.prereq)}${
    t ? ` <b class="prq-n">${t.done}/${t.of}</b>` : ''
  }</span></p>`;
}

/** The challenge: level line, or main line big + secondary lines small. */
function challengeHTML(game, it, { sheet = false } = {}) {
  const r = readItem(it);
  let html = '';
  if (r.level != null) html += `<p class="cl-main">${inline(game, r.levelText)}</p>`;
  r.lines.forEach((l, i) => {
    html +=
      i === 0
        ? `<p class="cl-main">${sheet ? `<span class="cl-k">${esc(l.label)}</span>` : ''}${inline(game, l.text)}</p>`
        : `<p class="cl-sub"><span class="cl-k">${esc(l.label)}</span>${inline(game, l.text)}</p>`;
  });
  if (r.rest.length) {
    if (sheet || (!r.lines.length && r.level == null)) html += `<div class="md cl-md">${md(game, sheet ? r.rest.join('\n\n') : r.rest[0])}</div>`;
  }
  if (r.opensAt != null) html += `<p class="cl-note">${icons.lock}<span>Opens at weapon level ${r.opensAt}</span></p>`;
  if (it.tip) html += `<p class="cl-tip">${icons.mapPin}<span>${inline(game, it.tip)}</span></p>`;
  return html;
}

function nowCardHTML(game, g, { item: it, kind, locked }, gp) {
  const pl = placeOf(g, it);
  const where = pl.part ? `${esc(pl.part)} · ${pl.n} of ${pl.of}` : '';
  return `<article class="now is-${kind}${locked ? ' is-locked' : ''}" data-id="${esc(it.id)}">
    <button type="button" class="now-head" data-act="camo-open" data-id="${esc(it.id)}" aria-label="${esc(it.title)}: details">${picHTML(it.image, {
      cls: 'pic-sq now-pic',
      ph: initials(it.title),
    })}<span class="now-titles"><span class="now-name">${esc(it.title)}</span>${where ? `<span class="now-where">${where}</span>` : ''}</span></button>
    <div class="now-main">
      ${kind === 'chain' ? prereqHTML(game, g, it, gp, locked, 'now-prq') : ''}
      <div class="now-cl">${challengeHTML(game, it)}</div>
    </div>
    ${
      locked
        ? `<button type="button" class="now-side now-have" data-act="camo-done" data-id="${esc(it.id)}" aria-label="I already have ${esc(it.title)}">${icons.check}<span>I have it</span></button>`
        : `<button type="button" class="now-side now-done" data-act="camo-done" data-id="${esc(it.id)}" aria-label="Mark ${esc(it.title)} done">${icons.check}<span>Done</span></button>`
    }
  </article>`;
}

/**
 * The page of one picture group. opts: root (the group is a tab of its
 * own), single (the game's only group: no star), sharedGuide (the guide
 * every item points at, shown once at the bottom).
 */
export function renderLadderGroup(ctx, entry, g, { root = false, single = false, sharedGuide = null } = {}) {
  const { game } = entry;
  const L = ladderOf(g);
  const st = gameUI(game.id);
  const name = displayTitle(g);
  const allLabel = game.layout.type === 'loadouts' && game.layout.checklist !== 'Checklist' ? `All ${game.layout.checklist.toLowerCase()}` : 'Everything';
  const meta = [g.class, g.note].filter(Boolean).map(esc).join(' · ');
  let view = L.isLadder ? st.ladderView || 'now' : 'all';

  const starHTML = (gp) => {
    if (single) return '';
    const on = !!gp.starred[g.key];
    return `<button type="button" class="round-btn star-toggle${on ? ' is-on' : ''}" data-act="star" aria-pressed="${on}" aria-label="${
      on ? 'Starred: tap to unstar' : 'Star this one so it stays on top'
    }">${icons.star}</button>`;
  };
  const progressHTML = (gp) => {
    const t = tally(gp, g.items);
    return `<span class="lad-n"><b>${t.done}</b> of ${t.total}${isComplete(gp, g) ? ' · all done' : ''}</span>${stripHTML(g, gp, ' strip-lg')}`;
  };
  const gridHTML = (gp) =>
    L.parts
      .map((p) => {
        const t = tally(gp, p.items);
        return `<div class="cg"><div class="sec-h"><h2>${esc(p.title)}</h2><span class="sec-n cg-n">${t.done}/${t.total}</span></div>
          <div class="cg-grid${p.items.length <= 3 ? ' is-few' : ''}">${p.items.map((it) => camoTileHTML(g, it, gp)).join('')}</div></div>`;
      })
      .join('');

  const helpGuide = g.help ? game.guideById.get(g.help) : null;
  const gp0 = store.game(game.id);
  const main = gamePage(ctx, entry, {
    root,
    tab: 'checklist',
    title: name,
    cls: 'page-ladder',
    body: `<section class="lad-head">
        ${g.image ? `<div class="lad-stage">${picHTML(g.image, { cls: 'pic-wide lad-icon', ph: initials(name), alt: name })}</div>` : ''}
        <div class="lad-title-row">
          <div class="lad-titles"><h1 class="lad-name"${root ? '' : ' data-title-anchor'}>${esc(name)}</h1>${meta ? `<p class="lad-meta">${meta}</p>` : ''}</div>
          <span class="lad-star">${starHTML(gp0)}</span>
        </div>
        <div class="lad-progress">${progressHTML(gp0)}</div>
        ${
          helpGuide
            ? `<button type="button" class="lad-help" data-act="help" aria-haspopup="dialog">${icons.bolt}<span>${esc(helpGuide.title)}</span>${icons.chevron}</button>`
            : ''
        }
      </section>
      ${
        L.isLadder
          ? `<div class="lad-seg"><div class="seg seg-2" role="tablist" aria-label="Show" data-v="${view}">
              <button type="button" role="tab" data-act="view" data-v="now" aria-selected="${view === 'now'}">Do now<span class="seg-n now-n"></span></button>
              <button type="button" role="tab" data-act="view" data-v="all" aria-selected="${view === 'all'}">${esc(allLabel)}<span class="seg-n all-n"></span></button>
            </div></div>`
          : ''
      }
      <section class="lad-pane pane-now"${view === 'now' ? '' : ' hidden'}><div class="now-list"></div></section>
      <section class="lad-pane pane-all"${view === 'all' ? '' : ' hidden'} aria-label="${esc(allLabel)}">${gridHTML(gp0)}</section>
      ${
        sharedGuide
          ? `<div class="block lad-guide"><a class="row-link solo" href="${guideHref(game, sharedGuide)}"><span class="row-icon">${icons.book}</span><span class="row-main"><span class="row-title">${esc(
              sharedGuide.title
            )}</span></span><span class="row-chev">${icons.chevron}</span></a></div>`
          : ''
      }`,
  });
  if (!main) return null;
  const progressEl = main.querySelector('.lad-progress');
  const nowList = main.querySelector('.now-list');
  const segEl = main.querySelector('.lad-seg');

  const counts = () => {
    if (!segEl) return;
    const gp = store.game(game.id);
    const t = tally(gp, g.items);
    const left = t.total - t.done;
    main.querySelector('.now-n').textContent = left ? String(doNow(g, gp).length) : '';
    main.querySelector('.all-n').textContent = `${t.done}/${t.total}`;
  };

  const drawNow = () => {
    if (!nowList) return;
    const gp = store.game(game.id);
    const list = doNow(g, gp);
    nowList.innerHTML = list.length
      ? list.map((e) => nowCardHTML(game, g, e, gp)).join('')
      : `<div class="all-done">${icons.check}<span>All ${g.items.length} done</span></div>`;
  };
  drawNow();
  counts();

  const setView = (v) => {
    view = v;
    st.ladderView = v;
    main.querySelectorAll('[data-act="view"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    segEl.querySelector('.seg').dataset.v = v;
    main.querySelector('.pane-now').hidden = v !== 'now';
    main.querySelector('.pane-all').hidden = v !== 'all';
    // Keep the control where it is; just bring the top of the list under it.
    const segTop = segEl.getBoundingClientRect().top;
    const stuck = parseFloat(getComputedStyle(segEl).top) || 0;
    if (segTop <= stuck + 1) window.scrollTo(0, window.scrollY + segTop - stuck);
  };

  const update = (card = null, ticked = []) => {
    const gp = store.game(game.id);
    progressEl.innerHTML = progressHTML(gp);
    main.querySelectorAll('.ctile').forEach((tile) => {
      const it = game.byId.get(tile.dataset.id);
      if (!it) return;
      const s = tileState(g, it, gp);
      tile.className = `ctile ${s.cls}`;
      tile.querySelector('.ctile-badge').innerHTML = s.badge;
      tile.setAttribute('aria-label', `${it.title}: ${s.label}`);
      if (ticked.includes(it)) pulse(tile.querySelector('.ctile-box'));
    });
    main.querySelectorAll('.cg').forEach((cg, i) => {
      const t = tally(gp, L.parts[i]?.items || []);
      const n = cg.querySelector('.cg-n');
      if (n) n.textContent = `${t.done}/${t.total}`;
    });
    counts();
    if (card && card.isConnected && !reducedMotion()) {
      card.classList.add('leaving');
      setTimeout(drawNow, 200);
    } else drawNow();
  };

  const setDone = (item, on, card = null) => {
    const gp = store.game(game.id);
    // Ticking also ticks what must have come before; unticking is one item.
    const extra = on ? alsoTicks(g, item, gp) : [];
    const touched = [item, ...extra];
    const snap = store.snapshotItems(game.id, touched.map((it) => it.id));
    if (on) store.markDone(game.id, touched);
    else if (item.type === 'counter') store.setCount(game.id, item.id, 0, item.target);
    else store.setChecked(game.id, item.id, false);
    if (on) buzz();
    update(card, on ? touched : []);
    const msg = on ? (extra.length ? `${item.title} done. Also ticked ${describeItems(g, extra)}` : `${item.title} done`) : `${item.title}: not done`;
    toast(msg, {
      action: 'Undo',
      ms: 8000,
      onAction: () => {
        store.restoreItems(game.id, snap);
        update();
      },
    });
  };

  const openItemSheet = (item) => {
    const gp = store.game(game.id);
    const done = isDone(gp, item);
    const locked = !done && isLocked(g, item, gp);
    const pl = placeOf(g, item);
    const at = gp.checked[item.id];
    const state = done ? `Done${at > 1 ? ` ${relTime(at)}` : ''}` : locked ? 'Locked' : 'Not done yet';
    const lower = done ? [] : alsoTicks(g, item, gp);
    const guide = item.guide ? game.guideById.get(item.guide) : null;
    const action = done
      ? `<button type="button" class="btn big csheet-btn" data-act="sheet-undo">${icons.undo}<span>Mark as not done</span></button>`
      : locked
        ? `<button type="button" class="btn primary big csheet-btn" data-act="sheet-done">${icons.check}<span>I already have this</span></button>`
        : `<button type="button" class="btn primary big csheet-btn" data-act="sheet-done">${icons.check}<span>Done</span></button>`;
    const body = openSheet({
      title: item.title,
      html: `<div class="csheet${done ? ' is-done' : ''}${locked ? ' is-locked' : ''}">
        <div class="csheet-top">
          <div class="csheet-pic">${picHTML(item.image, { cls: 'pic-sq', ph: initials(item.title), alt: item.title })}</div>
          <div class="csheet-facts">
            ${pl.part ? `<span class="csheet-place">${esc(pl.part)} · ${pl.n} of ${pl.of}</span>` : ''}
            <span class="csheet-st">${done ? icons.check : locked ? icons.lock : ''}${esc(state)}</span>
          </div>
        </div>
        ${prereqHTML(game, g, item, gp, locked, 'csheet-prq')}
        <div class="csheet-cl">${challengeHTML(game, item, { sheet: true })}</div>
        <div class="csheet-actions">${action}</div>
        ${lower.length ? `<p class="csheet-hint">Also ticks ${esc(describeItems(g, lower))}, since you can't have ${esc(item.title)} without them</p>` : ''}
        ${guide ? `<a class="text-btn csheet-guide" href="${guideHref(game, guide)}">${icons.book}<span>${esc(guide.title)}</span></a>` : ''}
      </div>`,
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="sheet-done"], [data-act="sheet-undo"]');
      if (!b) return;
      closeSheet({ animate: true });
      setDone(item, b.dataset.act === 'sheet-done');
    });
  };

  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !main.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'star') {
      store.setStarred(game.id, g.key, !store.game(game.id).starred[g.key]);
      main.querySelector('.lad-star').innerHTML = starHTML(store.game(game.id));
      return;
    }
    if (act === 'view') {
      if (el.dataset.v !== view) setView(el.dataset.v);
      return;
    }
    if (act === 'help' && helpGuide) {
      guideSheet(game, helpGuide, {
        lead: g.tip ? `<div class="hsheet-own"><p class="hsheet-k">${esc(name)}</p><div class="md">${md(game, g.tip)}</div></div>` : '',
      });
      return;
    }
    const item = el.dataset.id ? game.byId.get(el.dataset.id) : null;
    if (!item || item.group !== g) return;
    if (act === 'camo-open') openItemSheet(item);
    else if (act === 'camo-done') setDone(item, true, el.closest('.now'));
  });
  return null;
}

