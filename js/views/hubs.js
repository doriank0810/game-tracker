// What each tab shows (the tabs themselves come from js/tabs.js):
//   story     Next: the next thing to do, big, then the few after it
//   maps      Continue: the current map (Continue card, guides in play
//             order, its checklist) · Maps: the map picker
//   loadouts  Classes: class cards · Camos (the checklist): the weapon grid
//             with class filters, search and stars · Maps / Tips: guides
// Pages pushed from a tab (a map, a weapon) are here too.
import * as store from '../store.js';
import { esc, plural, debounce, searchTerms, matchesAll, fold, cssEscape } from '../util.js';
import { categoryOrder } from '../content.js';
import { tally, nextItems, isDone, guideTally, firstOpenStep, isWalk, guideState, nextGuideIn, whereToContinue } from '../progress.js';
import {
  itemRow,
  bindItems,
  updateRow,
  emptyBox,
  md,
  followHref,
  guideHref,
  sectionHref,
  groupHref,
  whereHTML,
  detailHTML,
  gamePage,
  toast,
  head,
  largeTitle,
  excerpt,
  openSheet,
  closeSheet,
  pulse,
  buzz,
  guideSheet,
} from '../ui.js';
import { gameUI } from '../state.js';
import { icons } from '../icons.js';
import { hasPictures, displayTitle } from '../ladder.js';
import { groupTileHTML, renderLadderGroup, isComplete, picHTML } from './ladder.js';
import { tabInfo, tabHref } from '../tabs.js';

// Shared pieces -------------------------------------------------------------------

/** A guide as one big row: a walkthrough opens Follow mode, a page opens the page. */
export function guideRowHTML(game, guide, gp, { num = null, preview = false } = {}) {
  if (!isWalk(guide)) {
    const ex = preview ? excerpt(guide) : '';
    return `<a class="grow is-page" href="${guideHref(game, guide)}"><span class="grow-lead">${icons.book}</span><span class="grow-main"><span class="grow-title">${esc(
      guide.title
    )}</span>${ex ? `<span class="grow-meta">${esc(ex)}</span>` : ''}</span><span class="grow-go">${icons.chevron}</span></a>`;
  }
  const state = guideState(gp, guide);
  const t = guideTally(gp, guide);
  const n = firstOpenStep(gp, guide);
  const finished = state === 'done' || state === 'covered';
  const meta =
    state === 'done'
      ? `Done · ${plural(t.total, 'step')}`
      : state === 'covered'
        ? `Ticked in checklist · ${plural(t.total, 'step')}`
        : state === 'started'
          ? `Step ${n + 1} of ${t.total}`
          : plural(t.total, 'step');
  return `<a class="grow is-${state}" href="${followHref(game, guide)}">
    <span class="grow-lead">${finished ? icons.check : num ?? icons.play}</span>
    <span class="grow-main"><span class="grow-title">${esc(guide.title)}</span><span class="grow-meta">${meta}</span>${
      state === 'started' ? `<span class="grow-bar"><span style="width:${t.pct}%"></span></span>` : ''
    }</span>
    <span class="grow-go">${icons.chevron}</span>
  </a>`;
}

/** One cell per walkthrough step (lit = ticked). */
function stepStrip(guide, gp) {
  if (guide.steps.length > 40) {
    return `<span class="strip strip-bar" aria-hidden="true"><span style="width:${guideTally(gp, guide).pct}%"></span></span>`;
  }
  return `<span class="strip" aria-hidden="true"><span class="strip-part">${guide.steps
    .map((s) => `<i${gp.steps?.[guide.id]?.[s.id] ? ' class="on"' : ''}></i>`)
    .join('')}</span></span>`;
}

/** Big "Continue / Start" card that goes straight into Follow mode. */
function continueCardHTML(game, guide, gp) {
  const state = guideState(gp, guide);
  const t = guideTally(gp, guide);
  const n = Math.max(0, firstOpenStep(gp, guide));
  const step = guide.steps[n];
  const started = state === 'started';
  return `<a class="cont" href="${followHref(game, guide)}">
    <span class="cont-top"><span class="cont-k">${started ? 'Continue' : 'Up next'}</span><span class="cont-n">Step ${n + 1} of ${t.total}</span></span>
    <span class="cont-title">${esc(guide.title)}</span>
    ${step?.where ? `<span class="cont-where">${icons.mapPin}<span>${esc(step.where)}</span></span>` : ''}
    ${stepStrip(guide, gp)}
    <span class="btn primary big cont-go">${icons.play}<span>${started ? 'Continue' : 'Start'}</span></span>
  </a>`;
}

function inProgressHTML(game, gp, list = game.guides) {
  const started = list.filter((g) => guideState(gp, g) === 'started');
  if (!started.length) return '';
  return `<section class="block">${head('Guides in progress')}<div class="rows">${started.map((g) => guideRowHTML(game, g, gp)).join('')}</div></section>`;
}

/** Keep <details> cards open across redraws ("toggle" doesn't bubble: capture it). */
function rememberOpenCards(container, st) {
  container.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (!d.matches?.('details[data-card]')) return;
      if (d.open) st.openCards.add(d.dataset.card);
      else st.openCards.delete(d.dataset.card);
    },
    true
  );
}

// Story: Next ------------------------------------------------------------------------

function upNextHTML(game, item, gp) {
  const g = item.group;
  const gt = tally(gp, g.items);
  const counter = item.type === 'counter';
  const tags = item.tags.length ? `<div class="up-tags">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';
  const pinned = !!gp.pinned[item.id];
  const action = counter
    ? `<div class="counter up-counter">
        <button type="button" class="step-btn" data-act="dec" aria-label="Minus one">${icons.minus}</button>
        <input class="count-in" type="number" inputmode="numeric" pattern="[0-9]*" min="0" max="${item.target}" value="${
          gp.counts[item.id] || 0
        }" data-act="set" aria-label="Count for ${esc(item.title)}">
        <span class="count-of">/ ${item.target}</span>
        <button type="button" class="step-btn" data-act="inc" aria-label="Plus one">${icons.plus}</button>
      </div>`
    : `<button type="button" class="btn primary big up-done" data-act="toggle">${icons.check}<span>Done</span></button>`;
  return `<section class="item up${pinned ? ' is-pinned' : ''}" data-game="${esc(game.id)}" data-id="${esc(item.id)}">
    <div class="up-path"><span class="up-group">${esc(g.title)}</span><span class="up-n">${gt.done}/${gt.total}</span></div>
    <h2 class="up-title">${esc(item.title)}</h2>
    ${tags}
    ${item.detail || item.guide ? `<div class="up-detail">${detailHTML(game, item)}</div>` : ''}
    <div class="up-actions">${action}
      <button type="button" class="pin up-pin" data-act="pin" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin to the top'}">${icons.pin}</button>
    </div>
  </section>`;
}

export function renderNext(ctx, entry) {
  const { game } = entry;
  const st = gameUI(game.id);
  const main = gamePage(ctx, entry, { root: true, tab: 'next', body: '<div class="hub"></div>' });
  if (!main) return null;
  const hub = main.querySelector('.hub');

  const draw = () => {
    const gp = store.game(game.id);
    const next = nextItems(game, gp, 5);
    let html = '';
    if (!game.items.length) html += emptyBox('No checklist items yet');
    else if (!next.length) html += emptyBox('<p class="empty-title">All done</p><p>Nothing left to do in this game</p>');
    else {
      html += upNextHTML(game, next[0].item, gp);
      const rest = next.slice(1);
      const here = next[0].item.group;
      if (rest.length) {
        html += `<section class="block">${head('After that')}<div class="item-list">${rest
          .map(({ item }) => itemRow(game, item, { meta: item.group === here ? '' : esc(item.group.title) }))
          .join('')}</div></section>`;
      }
    }
    html += inProgressHTML(game, gp);
    st.sessionDone = st.sessionDone.filter((id) => game.byId.has(id) && isDone(gp, game.byId.get(id)));
    if (st.sessionDone.length) {
      html += `<section class="block">${head('Done this session', String(st.sessionDone.length))}<div class="item-list">${st.sessionDone
        .map((id) => itemRow(game, game.byId.get(id), { meta: whereHTML(game.byId.get(id)) }))
        .join('')}</div></section>`;
    }
    hub.innerHTML = html;
  };
  draw();

  const redraw = debounce(draw, 450);
  bindItems(hub, {
    onChange: ({ item, act, wasDone, nowDone, row }) => {
      if (wasDone !== nowDone) {
        if (nowDone && !st.sessionDone.includes(item.id)) st.sessionDone.unshift(item.id);
        if (nowDone && item.type === 'check') {
          toast(`Done: ${item.title}`, {
            action: 'Undo',
            ms: 5000,
            onAction: () => {
              store.setChecked(game.id, item.id, false);
              draw();
            },
          });
        }
        if (row.classList.contains('up')) {
          row.classList.add('leaving');
          setTimeout(draw, 220);
        } else redraw();
      } else if (act === 'pin') redraw();
    },
  });
  return () => redraw.cancel();
}

// Maps: one map ------------------------------------------------------------------------

/** A map's guides and checklist; `top` decides the heading. Returns { html, bind }. */
function mapContent(game, section, { inTab }) {
  const walks = section.guides.filter(isWalk);
  const pages = section.guides.filter((g) => !isWalk(g));
  const gp0 = store.game(game.id);
  const doneCount = (gp) => walks.filter((g) => ['done', 'covered'].includes(guideState(gp, g))).length;
  const headHTML = inTab
    ? `<div class="map-head"><h2 class="map-name">${esc(section.title)}</h2><a class="pill-btn" href="${tabHref(game, 'maps')}" data-replace>${icons.map}<span>Change map</span></a></div>`
    : largeTitle(section.title, walks.length ? `<span class="map-done">${doneCount(gp0)} of ${plural(walks.length, 'guide')} done</span>` : '');

  const html = `${headHTML}<div class="sec-top"></div><div class="sec-list"></div>`;

  const bind = (main) => {
    const top = main.querySelector('.sec-top');
    const drawTop = () => {
      const gp = store.game(game.id);
      const last = walks.find((g) => g.id === gp.lastGuide && guideState(gp, g) === 'started');
      const next = last || walks.find((g) => guideState(gp, g) === 'started') || nextGuideIn(gp, walks);
      let h = '';
      if (next) h += continueCardHTML(game, next, gp);
      else if (walks.length) h += `<div class="all-done">${icons.check}<span>Every guide here is done</span></div>`;
      if (pages.length) h += `<div class="rows read-first">${pages.map((g) => guideRowHTML(game, g, gp)).join('')}</div>`;
      if (walks.length) {
        h += `<section class="block">${head('Guides, in play order', `${doneCount(gp)}/${walks.length}`)}<div class="rows">${walks
          .map((g, i) => guideRowHTML(game, g, gp, { num: i + 1 }))
          .join('')}</div></section>`;
      }
      top.innerHTML = h;
      const md0 = main.querySelector('.map-done');
      if (md0) md0.textContent = `${doneCount(gp)} of ${plural(walks.length, 'guide')} done`;
    };
    drawTop();

    // Checklist: items a guide above already covers are tucked into "All
    // checklist items" (they tick themselves when the guide is finished);
    // the rest are shown openly.
    const gp = store.game(game.id);
    const st = gameUI(game.id);
    const groups = section.groups.filter((g) => g.items.length);
    const covered = (it) => !!it.guide && walks.some((g) => g.id === it.guide);
    const extras = section.items.filter((it) => !covered(it));
    const linkedCount = section.items.length - extras.length;
    const allKey = `all:${section.id}`;
    const t0 = tally(gp, section.items);
    let list = '';
    if (extras.length && linkedCount) {
      list += `<section class="block">${head(`Also in ${section.title}`)}<div class="item-list">${extras.map((it) => itemRow(game, it)).join('')}</div></section>`;
    }
    if (groups.length) {
      const groupsHTML = groups
        .map((g) => {
          const t = tally(gp, g.items);
          return `<section class="grp-block" data-grp="${esc(g.key)}">${head(g.title, `<span class="grp-n">${t.done}/${t.total}</span>`)}<div class="item-list">${g.items
            .map((it) => itemRow(game, it))
            .join('')}</div></section>`;
        })
        .join('');
      if (linkedCount) {
        list += `<details class="disclose all-items" data-card="${esc(allKey)}"${st.openCards.has(allKey) ? ' open' : ''}>
          <summary><span class="disclose-title">All checklist items</span><span class="sec-n all-n">${t0.done}/${t0.total}</span><span class="chev">${icons.chevronDown}</span></summary>
          <div class="disclose-body">${groupsHTML}</div></details>`;
      } else list += `<section class="block">${groupsHTML}</section>`;
    }
    main.querySelector('.sec-list').innerHTML = list;
    rememberOpenCards(main, st);

    bindItems(main, {
      onChange: ({ item, row }) => {
        const now = store.game(game.id);
        const t = tally(now, item.group.items);
        const n = main.querySelector(`.grp-block[data-grp="${cssEscape(item.group.key)}"] .grp-n`);
        if (n) n.textContent = `${t.done}/${t.total}`;
        const all = main.querySelector('.all-n');
        if (all) {
          const ta = tally(now, section.items);
          all.textContent = `${ta.done}/${ta.total}`;
        }
        // The same item can be listed twice (open list + "All checklist items").
        main.querySelectorAll(`.item[data-id="${cssEscape(item.id)}"]`).forEach((r) => r !== row && updateRow(r, game, item));
        drawTop();
      },
    });
  };
  return { html, bind };
}

/** Continue tab: the map you're on. */
export function renderContinue(ctx, entry) {
  const { game } = entry;
  const gp = store.game(game.id);
  const cont = whereToContinue(game, gp);
  const section = cont?.section || game.sections.find((s) => s.id === gp.lastSection) || null;
  if (!section) {
    gamePage(ctx, entry, {
      root: true,
      tab: 'continue',
      body: `<div class="empty"><p class="empty-title">Pick a map to start</p><p>Open one from ${esc(game.layout.picker)} and it shows here next time, with the guide you were on</p>
        <p><a class="btn primary" href="${tabHref(game, 'maps')}" data-replace>${icons.map}<span>Choose a map</span></a></p></div>`,
    });
    return null;
  }
  const c = mapContent(game, section, { inTab: true });
  const main = gamePage(ctx, entry, { root: true, tab: 'continue', body: c.html });
  if (main) c.bind(main);
  return null;
}

/** A map pushed from the Maps tab (or a link). */
export function renderSection(ctx, entry) {
  const { game } = entry;
  const section = game.sections.find((s) => s.id === ctx.route.sectionId);
  if (!section) {
    gamePage(ctx, entry, {
      title: game.title,
      body: emptyBox('<p class="empty-title">Not found</p><p>This part of the game isn\'t in the game file any more</p>'),
    });
    return null;
  }
  store.setPlace(game.id, { section: section.id });
  const c = mapContent(game, section, { inTab: false });
  const main = gamePage(ctx, entry, { title: section.title, tab: 'maps', body: c.html });
  if (main) c.bind(main);
  return null;
}

// Maps: the picker -----------------------------------------------------------------------

function mapTileHTML(game, section, gp, isCurrent) {
  const t = tally(gp, section.items);
  const walks = section.guides.filter(isWalk);
  const done = walks.filter((g) => ['done', 'covered'].includes(guideState(gp, g))).length;
  const meta = walks.length ? `${done}/${walks.length} ${walks.length === 1 ? 'guide' : 'guides'}` : t.total ? `${t.done}/${t.total} done` : '';
  const pct = walks.length ? Math.floor((done / walks.length) * 100) : t.pct;
  const complete = walks.length ? done === walks.length : t.total && t.done === t.total;
  return `<a class="mtile${isCurrent ? ' is-current' : ''}${complete ? ' is-complete' : ''}" href="${sectionHref(game, section)}">
    <span class="mtile-title">${esc(section.title)}</span>
    <span class="mtile-meta">${isCurrent ? '<span class="mtile-cur">Current</span>' : ''}${esc(meta)}</span>
    <span class="mtile-bar"><span style="width:${pct}%"></span></span>
  </a>`;
}

export function renderMapPicker(ctx, entry) {
  const { game } = entry;
  const gp = store.game(game.id);
  const cont = whereToContinue(game, gp);
  const currentId = cont?.section?.id || gp.lastSection;
  let html = `<section class="block first">${head(game.layout.picker, String(game.sections.length))}<div class="mtiles">${game.sections
    .map((s) => mapTileHTML(game, s, gp, s.id === currentId))
    .join('')}</div></section>`;
  const loose = game.guides.filter((g) => !g.sectionId);
  if (loose.length) html += `<section class="block">${head('Other guides')}<div class="rows">${loose.map((g) => guideRowHTML(game, g, gp)).join('')}</div></section>`;
  gamePage(ctx, entry, { root: true, tab: 'maps', body: html });
  return null;
}

// Loadouts: class cards ------------------------------------------------------------------

const tableCells = (line) =>
  line
    .replace(/\\\|/g, '\u0000')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.replace(/\u0000/g, '|').trim());
const plain = (s) =>
  String(s)
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();

/**
 * Read a class guide body: "**Tier S** · SMG · Best for: …" first line, then
 * two-column tables. → { tier, type, bestFor, sub, title, weapon, body, preview }
 */
export function parseClass(guide) {
  if (guide._cls) return guide._cls;
  const lines = guide.body.replace(/\r\n?/g, '\n').split('\n');
  let tier = '';
  let sub = '';
  const first = lines.findIndex((l) => l.trim());
  const m = first >= 0 ? /^\s*\*\*\s*tier\s+([^*]+?)\s*\*\*\s*(?:[·•|–-]\s*(.*))?$/i.exec(lines[first]) : null;
  let bodyLines = lines;
  if (m) {
    tier = m[1].trim();
    sub = plain(m[2] || '').replace(/\bBest for:\s*/i, '');
    bodyLines = [...lines.slice(0, first), ...lines.slice(first + 1)];
  }
  const tables = [];
  for (let i = 0; i < bodyLines.length - 1; i++) {
    const l = bodyLines[i];
    if (!l.includes('|') || !/^\s*\|?\s*:?-+:?\s*\|/.test(bodyLines[i + 1])) continue;
    const headRow = tableCells(l);
    const rows = [];
    let j = i + 2;
    while (j < bodyLines.length && bodyLines[j].includes('|') && bodyLines[j].trim()) rows.push(tableCells(bodyLines[j++]));
    if (headRow.length === 2) tables.push({ head: headRow, rows });
    i = j - 1;
  }
  const kv = tables.flatMap((t) => t.rows.map((r) => [plain(r[0] || ''), plain(r[1] || '')]));
  const pick = (re) => kv.filter(([k, v]) => re.test(k) && v && !/^none$/i.test(v)).map(([, v]) => v);
  let attach = pick(/^attachments?$/i);
  if (!attach.length) {
    const t = tables.find((x) => /attachment/i.test(x.head[1]));
    if (t) attach = t.rows.map((r) => plain(r[1] || '')).filter((v) => v && !/^none$/i.test(v));
  }
  let perks = pick(/^perks?$/i);
  if (!perks.length) perks = pick(/^perk\s*\d/i);
  let equip = pick(/^equipment$/i);
  if (!equip.length) equip = pick(/^(lethal|tactical)$/i);
  const preview = [
    ['Attachments', attach.join(', ')],
    ['Perks', perks.join(', ')],
    ['Equipment', equip.join(', ')],
  ].filter(([, v]) => v);
  const title = tier ? guide.title.replace(/\s*\([^)]*\btier\b[^)]*\)\s*$/i, '') : guide.title;
  const parts = sub.split(/\s+·\s+/);
  const weapon = (/^\s*#{2,3}\s+(.+?)\s*$/m.exec(bodyLines.join('\n')) || [])[1] || '';
  guide._cls = { tier, sub, type: parts.length > 1 ? parts[0] : '', bestFor: parts.length > 1 ? parts.slice(1).join(' · ') : sub, title, weapon: plain(weapon), body: bodyLines.join('\n'), preview };
  return guide._cls;
}

/** The weapon picture for a class card: a checklist group named like its weapon. */
export function classImage(game, guide) {
  if (guide._img !== undefined) return guide._img;
  const w = fold(parseClass(guide).weapon).trim();
  let img = '';
  if (w) {
    for (const sec of game.sections) {
      const g = sec.groups.find((x) => x.image && fold(displayTitle(x)).trim() === w);
      if (g) {
        img = g.image;
        break;
      }
    }
  }
  guide._img = img;
  return img;
}

export const tierClass = (tier) => (/^s/i.test(tier) ? 's' : /^a/i.test(tier) ? 'a' : 'b');

function classTileHTML(game, guide) {
  const c = parseClass(guide);
  const img = classImage(game, guide);
  return `<a class="cls" href="${guideHref(game, guide)}">
    <span class="cls-art">${picHTML(img, { cls: 'pic-wide', phIcon: icons.crosshair })}${
      c.tier ? `<span class="tier tier-${tierClass(c.tier)}" aria-label="Tier ${esc(c.tier)}">${esc(c.tier)}</span>` : ''
    }</span>
    <span class="cls-body">
      ${c.type ? `<span class="cls-type">${esc(c.type)}</span>` : ''}
      <span class="cls-name">${esc(c.title)}</span>
      ${c.bestFor ? `<span class="cls-sub">${esc(c.bestFor)}</span>` : ''}
    </span>
  </a>`;
}

function classRowHTML(game, guide, gp) {
  const c = parseClass(guide);
  const linked = (guide.items || []).filter((it) => it.type === 'check');
  const built = linked.length > 0 && linked.every((it) => isDone(gp, it));
  return `<div class="crow${built ? ' is-built' : ''}" data-guide="${esc(guide.id)}">
    <a class="crow-main" href="${guideHref(game, guide)}">
      ${c.tier ? `<span class="tier tier-${tierClass(c.tier)}" aria-label="Tier ${esc(c.tier)}">${esc(c.tier)}</span>` : ''}
      <span class="crow-text"><span class="crow-name">${esc(c.title)}</span>${c.sub ? `<span class="crow-sub">${esc(c.sub)}</span>` : ''}</span>
    </a>
    ${
      linked.length
        ? `<button type="button" class="built-btn" data-act="built" aria-pressed="${built}" aria-label="${esc(c.title)}: ${built ? 'built' : 'not built yet'}"><span class="box">${icons.check}</span></button>`
        : `<span class="crow-chev">${icons.chevron}</span>`
    }
  </div>`;
}

export function renderClasses(ctx, entry) {
  const { game } = entry;
  const cats = tabInfo(game, 'classes')?.cats || [];
  const cards = game.guides.filter((g) => cats.includes(g.category));
  const tiles = cards.some((g) => classImage(game, g));
  const ordered = categoryOrder(game, cards);
  const gp0 = store.game(game.id);
  const body = ordered
    .map((cat, i) => {
      const list = cards.filter((g) => g.category === cat);
      const h = ordered.length > 1 ? head(cat || 'Other', String(list.length)) : head(`${plural(list.length, 'class', 'classes')}`, '', meta(list));
      return `<section class="block${i === 0 ? ' first' : ''}">${h}${
        tiles ? `<div class="cls-grid">${list.map((g) => classTileHTML(game, g)).join('')}</div>` : `<div class="group-list crows">${list.map((g) => classRowHTML(game, g, gp0)).join('')}</div>`
      }</section>`;
    })
    .join('');
  const main = gamePage(ctx, entry, { root: true, tab: 'classes', body });
  if (!main) return null;
  // The round tick on a class row ticks its checklist item(s) ("built").
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="built"]');
    if (!b) return;
    e.preventDefault();
    const row = b.closest('.crow');
    const g = game.guideById.get(row.dataset.guide);
    const linked = (g?.items || []).filter((it) => it.type === 'check');
    const on = !linked.every((it) => isDone(store.game(game.id), it));
    for (const it of linked) store.setChecked(game.id, it.id, on);
    row.classList.toggle('is-built', on);
    b.setAttribute('aria-pressed', String(on));
    if (on) {
      buzz();
      pulse(b.querySelector('.box'));
    }
  });
  return null;
}

/** "Meta as of 14 November 2026" style note found in the guides, shown by the heading. */
function meta(list) {
  for (const g of list) {
    const m = /meta as of ([^.(*]+)/i.exec(g.body);
    if (m) return `<span class="sec-note">As of ${esc(m[1].trim())}</span>`;
  }
  return '';
}

// Loadouts: Maps / Tips ------------------------------------------------------------------

export function renderGuideTab(ctx, entry, key) {
  const { game } = entry;
  const cats = tabInfo(game, key)?.cats || [];
  const list = game.guides.filter((g) => cats.includes(g.category));
  const gp = store.game(game.id);
  let body;
  if (list.length === 1 && !isWalk(list[0])) {
    // One page: show it right here.
    const g = list[0];
    const linked = game.items.filter((it) => it.guide === g.id);
    body = `<article class="guide inline-guide"><h2 class="guide-title">${esc(g.title)}</h2><div class="md md-guide">${md(game, g.body)}</div></article>${
      linked.length ? `<section class="block">${head('In your checklist')}<div class="item-list">${linked.map((it) => itemRow(game, it, { hideGuide: true })).join('')}</div></section>` : ''
    }`;
  } else {
    const ordered = categoryOrder(game, list);
    body = ordered
      .map(
        (c, i) =>
          `<section class="block${i === 0 ? ' first' : ''}">${ordered.length > 1 || key === 'tips' ? head(c || 'Other') : ''}<div class="rows">${list
            .filter((g) => g.category === c)
            .map((g) => guideRowHTML(game, g, gp, { preview: true }))
            .join('')}</div></section>`
      )
      .join('');
    body = inProgressHTML(game, gp, list) + body;
  }
  const main = gamePage(ctx, entry, { root: true, tab: key, body });
  if (main) bindItems(main);
  return null;
}

// Loadouts: the checklist group picker (e.g. weapons, then a weapon's camos) --------------

function groupPickRow(game, g, gp) {
  const t = tally(gp, g.items);
  const on = !!gp.starred[g.key];
  return `<div class="gpick${on ? ' is-starred' : ''}${t.total && t.done === t.total ? ' is-complete' : ''}" data-key="${esc(g.key)}">
    <a class="gpick-main" href="${groupHref(game, g)}"><span class="gpick-title">${esc(g.title)}</span>
      <span class="gpick-n">${t.done}/${t.total}</span><span class="row-chev">${icons.chevron}</span></a>
    <button type="button" class="star-btn" data-act="star" aria-pressed="${on}" aria-label="${on ? 'Unstar' : 'Star'} ${esc(g.title)}">${icons.star}</button>
  </div>`;
}

export function renderGroups(ctx, entry, { root }) {
  const { game } = entry;
  const groups = game.sections.flatMap((s) => s.groups.filter((g) => g.items.length));
  if (groups.length === 1) return renderGroup(ctx, entry, groups[0], { root, single: true });
  const st = gameUI(game.id);
  if (!st.groupFilter) st.groupFilter = 'all';
  const guides = game.guides.filter((g) => g.category === game.layout.checklist);
  const searchable = groups.length > 10;
  const classes = [...new Set(groups.map((g) => g.class).filter(Boolean))];
  const pictured = (g) => !!g.image || hasPictures(g);

  const chipsHTML = (gp) => {
    if (!classes.length) return '';
    const starredN = groups.filter((g) => gp.starred[g.key]).length;
    const chips = [['all', 'All'], ...(starredN ? [['starred', `Starred ${starredN}`]] : []), ...classes.map((c) => [c, c])];
    if (st.groupFilter === 'starred' && !starredN) st.groupFilter = 'all';
    return chips
      .map(
        ([k, label]) =>
          `<button type="button" class="chip${st.groupFilter === k ? ' is-on' : ''}" data-act="chip" data-k="${esc(k)}" aria-pressed="${st.groupFilter === k}">${
            k === 'starred' ? icons.star : ''
          }<span>${esc(label)}</span></button>`
      )
      .join('');
  };

  const main = gamePage(ctx, entry, {
    root,
    tab: 'checklist',
    title: game.layout.checklist,
    cls: 'page-picker',
    body: `<div class="pick-tools">
        ${
          searchable
            ? `<label class="search-field">${icons.search}<span class="sr-only">Find</span><input type="search" class="group-q" placeholder="Find one of ${groups.length}" value="${esc(
                st.groupQuery
              )}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>`
            : ''
        }
        ${guides.length ? `<button type="button" class="tool-btn" data-act="guides" aria-haspopup="dialog">${icons.book}<span>Guides</span></button>` : ''}
      </div>
      ${classes.length ? `<div class="chips" role="group" aria-label="Show"></div>` : ''}
      <div class="picker"></div>`,
  });
  if (!main) return null;
  const picker = main.querySelector('.picker');
  const chipsEl = main.querySelector('.chips');
  const input = main.querySelector('.group-q');

  const listHTML = (list, gp, opts) => {
    const tiles = list.filter(pictured);
    const rows = list.filter((g) => !pictured(g));
    return `${tiles.length ? `<div class="wtiles">${tiles.map((g) => groupTileHTML(game, g, gp, opts)).join('')}</div>` : ''}${
      rows.length ? `<div class="group-list gpick-list">${rows.map((g) => groupPickRow(game, g, gp)).join('')}</div>` : ''
    }`;
  };

  // Rebuild the chips only when the starred count changes, so the row keeps
  // its scroll position.
  let chipSig = null;
  const syncChips = (gp) => {
    if (!chipsEl) return;
    const sig = String(groups.filter((g) => gp.starred[g.key]).length);
    if (sig !== chipSig) {
      const x = chipsEl.scrollLeft;
      chipsEl.innerHTML = chipsHTML(gp);
      chipsEl.scrollLeft = x;
      chipSig = sig;
    }
    chipsEl.querySelectorAll('.chip').forEach((c) => {
      const on = c.dataset.k === st.groupFilter;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
    });
  };

  const draw = () => {
    const gp = store.game(game.id);
    syncChips(gp);
    const terms = searchTerms(st.groupQuery);
    const f = st.groupFilter;
    const match = (g) =>
      (!terms.length || matchesAll(fold(`${g.title} ${g.class} ${g.section.title}`), terms)) &&
      (f === 'all' || (f === 'starred' ? !!gp.starred[g.key] : g.class === f));
    const starred = groups.filter((g) => gp.starred[g.key] && match(g)).sort((a, b) => gp.starred[a.key] - gp.starred[b.key]);
    let html = '';
    if (starred.length && f !== 'starred' && f === 'all') {
      html += `<section class="block">${head('Starred')}${listHTML(starred, gp, { showClass: true })}</section>`;
    } else if (f === 'starred' && starred.length) {
      html += `<section class="block">${listHTML(starred, gp, { showClass: true })}</section>`;
    }
    if (f !== 'starred') {
      const multi = game.sections.filter((s) => s.groups.some((g) => g.items.length)).length > 1;
      for (const s of game.sections) {
        const all = s.groups.filter((g) => g.items.length);
        const list = all.filter((g) => match(g) && !(f === 'all' && gp.starred[g.key]));
        if (!list.length) continue;
        if (all.some((g) => g.class)) {
          // One heading per class ("Assault rifle", "SMG"…), in file order,
          // with how many of that class are finished.
          const byClass = new Map();
          for (const g of list) {
            const c = g.class || '';
            if (!byClass.has(c)) byClass.set(c, []);
            byClass.get(c).push(g);
          }
          for (const [c, members] of byClass) {
            const everyone = all.filter((g) => (g.class || '') === c);
            const fin = everyone.filter((g) => isComplete(gp, g)).length;
            html += `<section class="block">${head(c || s.title, `<span class="${fin && fin === everyone.length ? 'is-all' : ''}">${fin}/${everyone.length} done</span>`)}${listHTML(
              members,
              gp
            )}</section>`;
          }
          continue;
        }
        html += `<section class="block">${multi || starred.length ? head(s.title) : ''}${listHTML(list, gp)}</section>`;
      }
    }
    if (!html) html = emptyBox(terms.length ? `Nothing matches “${esc(st.groupQuery.trim())}”` : 'Nothing here yet');
    else if (!starred.length && !terms.length && f === 'all') html = `<p class="hint">${icons.star}<span>Star the ones you use and they stay on top</span></p>${html}`;
    picker.innerHTML = html;
  };
  draw();

  const onSearch = debounce(() => {
    st.groupQuery = input.value;
    draw();
  }, 120);
  input?.addEventListener('input', onSearch);
  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'star') {
      const key = el.closest('[data-key]').dataset.key;
      store.setStarred(game.id, key, !store.game(game.id).starred[key]);
      draw();
    } else if (el.dataset.act === 'chip') {
      st.groupFilter = el.dataset.k;
      draw();
      const r = el.getBoundingClientRect();
      const box = chipsEl.getBoundingClientRect();
      if (r.left < box.left + 16 || r.right > box.right - 16) chipsEl.scrollBy({ left: r.left - box.left - box.width / 2 + r.width / 2, behavior: 'smooth' });
    } else if (el.dataset.act === 'guides') {
      if (guides.length === 1) {
        guideSheet(game, guides[0]);
        return;
      }
      const body = openSheet({
        title: 'Guides',
        html: `<div class="group-list">${guides
          .map(
            (g) =>
              `<button type="button" class="row-link" data-guide="${esc(g.id)}"><span class="row-icon">${g.id === guides[0].id ? icons.bolt : icons.book}</span><span class="row-main"><span class="row-title">${esc(
                g.title
              )}</span></span><span class="row-chev">${icons.chevron}</span></button>`
          )
          .join('')}</div>`,
      });
      body.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-guide]');
        if (!b) return;
        const g = game.guideById.get(b.dataset.guide);
        closeSheet();
        if (g) guideSheet(game, g);
      });
    }
  });
  return () => onSearch.cancel();
}

/** One checklist group, e.g. one weapon's camos. */
export function renderGroup(ctx, entry, group = null, { root = false, single = false } = {}) {
  const { game } = entry;
  const g = group || game.groupByKey.get(`${ctx.route.sectionId}/${ctx.route.groupId}`);
  if (!g) {
    gamePage(ctx, entry, {
      title: game.title,
      tab: 'checklist',
      body: emptyBox('<p class="empty-title">Not found</p><p>This list isn\'t in the game file any more</p>'),
    });
    return null;
  }
  // Every item points at the same guide (e.g. the camo table): show it once.
  const shared = g.items.length > 1 && g.items[0].guide && g.items.every((it) => it.guide === g.items[0].guide);
  const sharedGuide = shared ? game.guideById.get(g.items[0].guide) : null;
  // Items with pictures (e.g. one weapon's camos): "Do now" + picture grid.
  if (hasPictures(g)) return renderLadderGroup(ctx, entry, g, { root, single, sharedGuide });

  const headHTML = () => {
    const gp = store.game(game.id);
    const t = tally(gp, g.items);
    const on = !!gp.starred[g.key];
    // Starring only makes sense when there are other lists to sort against.
    return `<span class="group-count">${t.done} of ${t.total} done</span>${
      single
        ? ''
        : `<button type="button" class="pill-btn star-toggle${on ? ' is-on' : ''}" data-act="star" aria-pressed="${on}">${icons.star}<span>${on ? 'Starred' : 'Star'}</span></button>`
    }`;
  };
  const main = gamePage(ctx, entry, {
    root,
    tab: 'checklist',
    title: single ? g.section.title : g.title,
    body: `${root ? '' : largeTitle(single ? g.section.title : g.title)}<div class="group-head">${headHTML()}</div><div class="item-list">${g.items
      .map((it) => itemRow(game, it, { hideGuide: !!sharedGuide }))
      .join('')}</div>${sharedGuide ? `<div class="block"><div class="rows">${guideRowHTML(game, sharedGuide, store.game(game.id))}</div></div>` : ''}`,
  });
  if (!main) return null;
  const headEl = main.querySelector('.group-head');
  headEl.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="star"]')) return;
    store.setStarred(game.id, g.key, !store.game(game.id).starred[g.key]);
    headEl.innerHTML = headHTML();
  });
  bindItems(main, { onChange: () => (headEl.innerHTML = headHTML()) });
  return null;
}

