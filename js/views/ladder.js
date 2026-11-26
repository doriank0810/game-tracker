// Picture groups (e.g. a weapon and its camos), see js/ladder.js:
//   - picker tiles: the group's picture, name, n/total and a strip
//   - the group page: header, "Do now" (what to work on right now, big
//     Done buttons), then a picture grid of every item; tapping a picture
//     opens its challenge in a bottom sheet with Done / Undo.
import * as store from '../store.js';
import * as data from '../data.js';
import { esc, plural, relTime } from '../util.js';
import { renderInline } from '../markdown.js';
import { tally, isDone } from '../progress.js';
import { gamePage, groupHref, guideHref, openSheet, closeSheet, toast, md, mdCtx } from '../ui.js';
import { icons } from '../icons.js';
import { ladderOf, readItem, placeOf, isLocked, doNow, alsoTicks, prereqTally, displayTitle, initials } from '../ladder.js';

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A picture in a fixed-size box (the box's shape comes from CSS, so nothing
 * jumps while it loads). Lazy; a missing or broken picture shows `ph`.
 */
export function picHTML(src, { cls = '', ph = '', alt = '' } = {}) {
  const url = src ? data.mediaUrl(src) : null;
  return `<span class="pic${cls ? ` ${cls}` : ''}${url ? '' : ' is-broken'}"><span class="pic-ph" aria-hidden="true">${esc(ph)}</span>${
    url ? `<img class="pic-img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''
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
      <span class="wtile-top">${picHTML(g.image, { cls: 'pic-wide wtile-pic', ph: initials(name) })}${
        done ? `<span class="wtile-badge">${icons.check}</span>` : ''
      }</span>
      <span class="wtile-name">${esc(name)}</span>${showClass && g.class ? `<span class="wtile-class">${esc(g.class)}</span>` : ''}
      <span class="wtile-foot">${stripHTML(g, gp)}<span class="wtile-n">${done ? 'Done' : `${t.done}/${t.total}`}</span></span>
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
  return lv != null
    ? { cls: 'is-todo', badge: `Lv ${lv}`, label: `not done, level ${lv}` }
    : { cls: 'is-todo', badge: '', label: 'not done' };
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
  return `<p class="prq ${cls}${locked ? ' is-locked' : ''}${met ? ' is-met' : ''}">${locked ? icons.lock : met ? icons.check : icons.lock}<span>${inline(
    game,
    r.prereq
  )}${t ? ` <b class="prq-n">${t.done}/${t.of}</b>` : ''}</span></p>`;
}

/** The challenge: level line, or main line big + secondary lines small. */
function challengeHTML(game, it, { sheet = false } = {}) {
  const r = readItem(it);
  let html = '';
  if (r.level != null) html += `<p class="cl-main">${inline(game, r.levelText)}</p>`;
  r.lines.forEach((l, i) => {
    html += i === 0
      ? `<p class="cl-main">${sheet ? `<span class="cl-k">${esc(l.label)}</span>` : ''}${inline(game, l.text)}</p>`
      : `<p class="cl-sub"><span class="cl-k">${esc(l.label)}</span>${inline(game, l.text)}</p>`;
  });
  if (r.rest.length) {
    if (sheet || (!r.lines.length && r.level == null)) html += `<div class="md cl-md">${md(game, sheet ? r.rest.join('\n\n') : r.rest[0])}</div>`;
  }
  if (r.opensAt != null) html += `<p class="cl-note">${icons.lock}<span>Opens at weapon level ${r.opensAt}</span></p>`;
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
        ? `<button type="button" class="now-side now-lock" data-act="camo-open" data-id="${esc(it.id)}" aria-label="${esc(it.title)} is locked: details">${icons.lock}<span>Locked</span></button>`
        : `<button type="button" class="now-side now-done" data-act="camo-done" data-id="${esc(it.id)}" aria-label="Mark ${esc(it.title)} done">${icons.check}<span>Done</span></button>`
    }
  </article>`;
}

/**
 * The page of one picture group. opts: back (href), names ({ title, sub }
 * when this is the only group: no star), guideHTML (shared guide card).
 */
export function renderLadderGroup(ctx, entry, g, { back, names = null, guideHTML = '' }) {
  const { game } = entry;
  const L = ladderOf(g);
  const name = displayTitle(g);
  const gridLabel = game.layout.type === 'loadouts' ? game.layout.checklist : 'Everything in this list';
  const meta = [g.class, g.note].filter(Boolean).map(esc).join(' · ');

  const starHTML = (gp) => {
    if (names) return '';
    const on = !!gp.starred[g.key];
    return `<button type="button" class="btn small star-toggle lad-star-btn${on ? ' is-on' : ''}" data-act="star" aria-pressed="${on}" aria-label="${
      on ? 'Starred: tap to unstar' : 'Star this one so it stays on top'
    }">${icons.star}</button>`;
  };
  const progressHTML = (gp) => {
    const t = tally(gp, g.items);
    const done = isComplete(gp, g);
    return `<span class="lad-n"><b>${t.done}</b>/${t.total}${done ? ' · all done' : ''}</span>${stripHTML(g, gp, ' strip-lg')}`;
  };
  const gridHTML = (gp) =>
    L.parts
      .map((p) => {
        const t = tally(gp, p.items);
        return `<div class="cg"><div class="block-head"><h2 class="label">${esc(p.title)}</h2><span class="count cg-n">${t.done}/${t.total}</span></div>
          <div class="cg-grid${p.items.length <= 3 ? ' is-few' : ''}">${p.items.map((it) => camoTileHTML(g, it, gp)).join('')}</div></div>`;
      })
      .join('');

  const gp0 = store.game(game.id);
  const main = gamePage(ctx, entry, {
    title: names?.title || name,
    sub: names?.sub || g.section.title,
    back,
    body: `<section class="lad-head">
        ${g.image ? `<div class="lad-hero">${picHTML(g.image, { cls: 'pic-wide lad-icon', ph: initials(name), alt: name })}</div>` : ''}
        <div class="lad-title-row">
          <div class="lad-titles"><h2 class="lad-name">${esc(name)}</h2>${meta ? `<p class="lad-meta">${meta}</p>` : ''}</div>
          <span class="lad-star">${starHTML(gp0)}</span>
        </div>
        <div class="lad-progress">${progressHTML(gp0)}</div>
      </section>
      ${L.isLadder ? `<section class="block lad-now"><div class="block-head"><h2 class="label">Do now</h2><span class="count now-n"></span></div><div class="now-list"></div></section>` : ''}
      <section class="block lad-grid" aria-label="${esc(gridLabel)}">${gridHTML(gp0)}</section>
      ${guideHTML}`,
  });
  if (!main) return null;
  const progressEl = main.querySelector('.lad-progress');
  const nowList = main.querySelector('.now-list');

  const drawNow = () => {
    if (!nowList) return;
    const gp = store.game(game.id);
    const list = doNow(g, gp);
    const left = g.items.filter((it) => !isDone(gp, it)).length;
    main.querySelector('.now-n').textContent = left ? `${left} left` : '';
    nowList.innerHTML = list.length
      ? list.map((e) => nowCardHTML(game, g, e, gp)).join('')
      : `<div class="all-done">${icons.check}<span>All ${g.items.length} done.</span></div>`;
  };
  drawNow();

  const update = (card = null) => {
    const gp = store.game(game.id);
    progressEl.innerHTML = progressHTML(gp);
    main.querySelectorAll('.ctile').forEach((tile) => {
      const it = game.byId.get(tile.dataset.id);
      if (!it) return;
      const s = tileState(g, it, gp);
      tile.className = `ctile ${s.cls}`;
      tile.querySelector('.ctile-badge').innerHTML = s.badge;
      tile.setAttribute('aria-label', `${it.title}: ${s.label}`);
    });
    main.querySelectorAll('.cg').forEach((cg, i) => {
      const t = tally(gp, L.parts[i]?.items || []);
      const n = cg.querySelector('.cg-n');
      if (n) n.textContent = `${t.done}/${t.total}`;
    });
    if (card && card.isConnected && !reducedMotion()) {
      card.classList.add('leaving');
      setTimeout(drawNow, 200);
    } else drawNow();
  };

  const setOne = (it, on) => {
    if (it.type === 'counter') store.setCount(game.id, it.id, on ? it.target : 0, it.target);
    else store.setChecked(game.id, it.id, on);
  };
  const setDone = (item, on, card = null) => {
    const gp = store.game(game.id);
    const touched = on ? [item, ...alsoTicks(g, item, gp)] : [item];
    const before = touched.map((it) => [it, isDone(gp, it)]);
    for (const it of touched) setOne(it, on);
    if (on && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch {
        /* not supported */
      }
    }
    update(card);
    const more = touched.length - 1;
    toast(on ? `Done: ${item.title}${more ? ` and ${plural(more, 'lower level')}` : ''}` : `Not done: ${item.title}`, {
      action: 'Undo',
      ms: 5000,
      onAction: () => {
        for (const [it, was] of before) setOne(it, was);
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
    const body = openSheet({
      title: item.title,
      html: `<div class="csheet${done ? ' is-done' : ''}${locked ? ' is-locked' : ''}">
        <div class="csheet-pic">${picHTML(item.image, { cls: 'pic-fit', ph: initials(item.title), alt: item.title })}</div>
        <p class="csheet-state">${pl.part ? `<span>${esc(pl.part)} · ${pl.n} of ${pl.of}</span>` : ''}<span class="csheet-st">${
          done ? icons.check : locked ? icons.lock : ''
        }${esc(state)}</span></p>
        ${prereqHTML(game, g, item, gp, locked, 'csheet-prq')}
        <div class="csheet-cl">${challengeHTML(game, item, { sheet: true })}</div>
        <div class="csheet-actions">${
          done
            ? `<button type="button" class="btn big csheet-btn" data-act="sheet-undo">${icons.undo}<span>Mark as not done</span></button>`
            : `<button type="button" class="btn primary big csheet-btn" data-act="sheet-done">${icons.check}<span>Done</span></button>`
        }</div>
        ${
          lower.length
            ? `<p class="csheet-hint">Also ticks ${esc(lower.length > 3 ? plural(lower.length, 'lower level') : lower.map((it) => it.title).join(', '))}: levels add up.</p>`
            : ''
        }
        ${guide ? `<a class="text-btn csheet-guide" href="${guideHref(game, guide)}">${icons.book}<span>${esc(guide.title)}</span></a>` : ''}
      </div>`,
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="sheet-done"], [data-act="sheet-undo"]');
      if (!b) return;
      closeSheet();
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
    const item = el.dataset.id ? game.byId.get(el.dataset.id) : null;
    if (!item || item.group !== g) return;
    if (act === 'camo-open') openItemSheet(item);
    else if (act === 'camo-done') setDone(item, true, el.closest('.now'));
  });
  return null;
}
