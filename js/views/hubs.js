// Game hubs: what the game page shows first, chosen by the game file's
// "layout" (see games/README.md):
//   story     the next thing to do, big, then the few after it
//   maps      a map picker (sections), "Continue" on top; each map lists its
//             guides in play order and its checklist
//   loadouts  class cards first, then other guides; the checklist (e.g.
//             camos) behind one entry with a group picker and stars
import * as store from '../store.js';
import { esc, enc, plural, debounce, searchTerms, matchesAll, fold, cssEscape } from '../util.js';
import { categoryOrder } from '../content.js';
import { renderMarkdown } from '../markdown.js';
import {
  tally,
  nextItems,
  isDone,
  guideTally,
  firstOpenStep,
  isWalk,
  guideState,
  nextGuideIn,
  whereToContinue,
} from '../progress.js';
import {
  itemRow,
  bindItems,
  updateRow,
  emptyBox,
  md,
  mdCtx,
  followHref,
  guideHref,
  sectionHref,
  groupHref,
  whereHTML,
  detailHTML,
  gamePage,
  noteStrip,
  toast,
  guideLinkHTML,
} from '../ui.js';
import { gameUI } from '../state.js';
import { icons } from '../icons.js';

const hubHref = (game) => `#/game/${enc(game.id)}`;

// Shared pieces -------------------------------------------------------------------

/** A walkthrough as one big row: tap = Follow mode. Page guides open the page. */
export function guideRowHTML(game, guide, gp, { num = null } = {}) {
  if (!isWalk(guide)) {
    return `<a class="grow is-page" href="${guideHref(game, guide)}"><span class="grow-lead">${icons.book}</span><span class="grow-main"><span class="grow-title">${esc(
      guide.title
    )}</span><span class="grow-meta">Read</span></span><span class="grow-go">${icons.chevron}</span></a>`;
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
  const go = state === 'started' ? 'Continue' : '';
  return `<a class="grow is-${state}" href="${followHref(game, guide)}">
    <span class="grow-lead">${finished ? icons.check : num ?? icons.play}</span>
    <span class="grow-main"><span class="grow-title">${esc(guide.title)}</span><span class="grow-meta">${meta}</span>${
      state === 'started' ? `<span class="grow-bar"><span style="width:${t.pct}%"></span></span>` : ''
    }</span>
    <span class="grow-go">${go ? `<span>${go}</span>` : ''}${icons.chevron}</span>
  </a>`;
}

/** Big "Continue / Start" card that goes straight into Follow mode. */
function continueCardHTML(game, guide, gp, { where = '', label = '', extra = '' } = {}) {
  const state = guideState(gp, guide);
  const t = guideTally(gp, guide);
  const n = Math.max(0, firstOpenStep(gp, guide));
  const step = guide.steps[n];
  const started = state === 'started';
  return `<section class="continue">
    <a class="continue-main" href="${followHref(game, guide)}">
      <span class="label continue-label">${esc(label || (started ? 'Continue' : 'Next up'))}</span>
      ${where ? `<span class="continue-where">${esc(where)}</span>` : ''}
      <span class="continue-title">${esc(guide.title)}</span>
      <span class="continue-meta">Step ${n + 1} of ${t.total}${step?.where ? ` · ${esc(step.where)}` : ''}</span>
      <span class="btn primary big continue-go">${icons.play}<span>${started ? 'Continue' : 'Start'}</span></span>
    </a>${extra}
  </section>`;
}

function inProgressHTML(game, gp, list = game.guides) {
  const started = list.filter((g) => guideState(gp, g) === 'started');
  if (!started.length) return '';
  return `<section class="block"><div class="block-head"><h2 class="label">Guides in progress</h2></div><div class="rows">${started
    .map((g) => guideRowHTML(game, g, gp))
    .join('')}</div></section>`;
}

function browseHTML(game, gp, { checklist = true } = {}) {
  const rows = [];
  const id = enc(game.id);
  if (checklist && game.items.length) {
    const t = tally(gp, game.items);
    rows.push(
      `<a class="link-row" href="#/game/${id}/list"><span class="link-icon">${icons.list}</span><span class="link-main"><span class="link-title">${esc(
        game.layout.type === 'loadouts' ? 'Full checklist' : 'Checklist'
      )}</span></span><span class="link-meta">${t.done}/${t.total}</span>${icons.chevron}</a>`
    );
  }
  if (game.guides.length) {
    rows.push(
      `<a class="link-row" href="#/game/${id}/guides"><span class="link-icon">${icons.book}</span><span class="link-main"><span class="link-title">All guides</span></span><span class="link-meta">${game.guides.length}</span>${icons.chevron}</a>`
    );
  }
  if (!rows.length) return '';
  return `<section class="block browse"><div class="link-list">${rows.join('')}</div></section>`;
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

/** A reference page shown inline as a tap-to-open card. */
function pageCardHTML(game, guide, open) {
  return `<details class="page-card" data-card="${esc(guide.id)}"${open ? ' open' : ''}>
    <summary><span class="pc-title">${esc(guide.title)}</span><span class="chev">${icons.chevron}</span></summary>
    <div class="pc-body"><div class="md md-page">${guide.body ? md(game, guide.body) : '<p class="muted">Empty.</p>'}</div></div>
  </details>`;
}

// Story hub ------------------------------------------------------------------------

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
  return `<section class="item up-next" data-game="${esc(game.id)}" data-id="${esc(item.id)}">
    <div class="up-where"><span class="label up-label">Up next</span><span class="up-path">${esc(g.title)} · ${gt.done}/${gt.total}</span></div>
    <h2 class="up-title">${esc(item.title)}</h2>
    ${tags}
    ${item.detail || item.guide ? `<div class="up-detail">${detailHTML(game, item)}</div>` : ''}
    <div class="up-actions">${action}
      <button type="button" class="pin up-pin" data-act="pin" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin to the top'}">${icons.pin}</button>
    </div>
  </section>`;
}

function renderStory(ctx, entry) {
  const { game } = entry;
  const st = gameUI(game.id);
  const main = gamePage(ctx, entry, { title: game.title, back: '#/', body: '<div class="hub"></div>' });
  if (!main) return null;
  const hub = main.querySelector('.hub');

  const draw = () => {
    const gp = store.game(game.id);
    const next = nextItems(game, gp, 5);
    let html = noteStrip(game);
    if (!game.items.length) html += emptyBox('No checklist items yet.');
    else if (!next.length) html += emptyBox('<p class="empty-title">All done</p><p>Nothing left to do in this game.</p>');
    else {
      html += upNextHTML(game, next[0].item, gp);
      const rest = next.slice(1);
      const here = next[0].item.group;
      if (rest.length) {
        html += `<section class="block"><div class="block-head"><h2 class="label">After that</h2></div><div class="item-list">${rest
          .map(({ item }) => itemRow(game, item, { meta: item.group === here ? '' : esc(item.group.title) }))
          .join('')}</div></section>`;
      }
    }
    html += inProgressHTML(game, gp);
    st.sessionDone = st.sessionDone.filter((id) => game.byId.has(id) && isDone(gp, game.byId.get(id)));
    if (st.sessionDone.length) {
      html += `<section class="block"><div class="block-head"><h2 class="label">Done this session</h2><span class="count">${
        st.sessionDone.length
      }</span></div><div class="item-list">${st.sessionDone
        .map((id) => itemRow(game, game.byId.get(id), { meta: whereHTML(game.byId.get(id)) }))
        .join('')}</div></section>`;
    }
    html += browseHTML(game, gp);
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
        if (row.classList.contains('up-next')) {
          row.classList.add('leaving');
          setTimeout(draw, 220);
        } else redraw();
      } else if (act === 'pin') redraw();
    },
  });
  return () => redraw.cancel();
}

// Maps hub -------------------------------------------------------------------------

function tileHTML(game, section, gp, isLast) {
  const t = tally(gp, section.items);
  const walks = section.guides.filter(isWalk).length;
  const meta = [walks ? plural(walks, 'guide') : '', t.total ? `${t.done}/${t.total} done` : ''].filter(Boolean).join(' · ');
  return `<a class="tile${isLast ? ' is-last' : ''}${t.total && t.done === t.total ? ' is-complete' : ''}" href="${sectionHref(game, section)}">
    ${isLast ? '<span class="tile-tag">Last time</span>' : ''}
    <span class="tile-title">${esc(section.title)}</span>
    <span class="tile-meta">${meta}</span>
    <span class="tile-bar"><span style="width:${t.pct}%"></span></span>
  </a>`;
}

function renderMaps(ctx, entry) {
  const { game } = entry;
  const gp = store.game(game.id);
  const cont = whereToContinue(game, gp);
  let html = noteStrip(game);
  if (cont?.guide) {
    html += continueCardHTML(game, cont.guide, gp, {
      label: 'Continue',
      where: cont.section?.title || '',
      extra: cont.section
        ? `<a class="text-btn continue-alt" href="${sectionHref(game, cont.section)}">${icons.grid}<span>Open ${esc(cont.section.title)}</span></a>`
        : '',
    });
  } else if (cont?.section) {
    html += `<a class="continue continue-map" href="${sectionHref(game, cont.section)}"><span class="label continue-label">Continue</span><span class="continue-title">${esc(
      cont.section.title
    )}</span>${icons.chevron}</a>`;
  }
  const lastId = cont?.section?.id || gp.lastSection;
  html += `<section class="block"><div class="block-head"><h2 class="label">${esc(game.layout.picker)}</h2><span class="count">${
    game.sections.length
  }</span></div><div class="tiles">${game.sections.map((s) => tileHTML(game, s, gp, s.id === lastId)).join('')}</div></section>`;
  const loose = game.guides.filter((g) => !g.sectionId);
  if (loose.length) {
    html += `<section class="block"><div class="block-head"><h2 class="label">Other guides</h2></div><div class="rows">${loose
      .map((g) => guideRowHTML(game, g, gp))
      .join('')}</div></section>`;
  }
  html += browseHTML(game, gp);
  gamePage(ctx, entry, { title: game.title, back: '#/', body: `<div class="hub">${html}</div>` });
  return null;
}

/** One section (a map): Continue card, guides in play order, its checklist. */
export function renderSection(ctx, entry) {
  const { game } = entry;
  const section = game.sections.find((s) => s.id === ctx.route.sectionId);
  if (!section) {
    gamePage(ctx, entry, {
      title: game.title,
      back: hubHref(game),
      body: emptyBox('<p class="empty-title">Not found</p><p>This part of the game isn\'t in the game file (any more).</p>'),
    });
    return null;
  }
  store.setPlace(game.id, { section: section.id });
  const main = gamePage(ctx, entry, {
    title: section.title,
    sub: game.title,
    back: hubHref(game),
    body: `<div class="sec-top"></div><div class="sec-list"></div>`,
  });
  if (!main) return null;
  const top = main.querySelector('.sec-top');
  const walks = section.guides.filter(isWalk);
  const pages = section.guides.filter((g) => !isWalk(g));

  const drawTop = () => {
    const gp = store.game(game.id);
    const last = walks.find((g) => g.id === gp.lastGuide && guideState(gp, g) === 'started');
    const next = last || walks.find((g) => guideState(gp, g) === 'started') || nextGuideIn(gp, walks);
    let html = '';
    if (next) html += continueCardHTML(game, next, gp);
    else if (walks.length) html += `<div class="all-done">${icons.check}<span>Every guide here is done.</span></div>`;
    if (pages.length) html += `<div class="rows read-first">${pages.map((g) => guideRowHTML(game, g, gp)).join('')}</div>`;
    if (walks.length) {
      const done = walks.filter((g) => ['done', 'covered'].includes(guideState(gp, g))).length;
      html += `<section class="block"><div class="block-head"><h2 class="label">Guides, in play order</h2><span class="count">${done}/${
        walks.length
      }</span></div><div class="rows">${walks.map((g, i) => guideRowHTML(game, g, gp, { num: i + 1 })).join('')}</div></section>`;
    }
    top.innerHTML = html;
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
    list += `<section class="block"><div class="block-head"><h2 class="label">Also in ${esc(section.title)}</h2></div><div class="item-list">${extras
      .map((it) => itemRow(game, it))
      .join('')}</div></section>`;
  }
  if (groups.length) {
    const groupsHTML = groups
      .map((g) => {
        const t = tally(gp, g.items);
        return `<section class="grp-block" data-grp="${esc(g.key)}"><div class="block-head"><h3 class="label">${esc(
          g.title
        )}</h3><span class="count grp-n">${t.done}/${t.total}</span></div><div class="item-list">${g.items
          .map((it) => itemRow(game, it))
          .join('')}</div></section>`;
      })
      .join('');
    if (linkedCount) {
      list += `<details class="page-card all-items" data-card="${esc(allKey)}"${st.openCards.has(allKey) ? ' open' : ''}>
        <summary><span class="pc-title">All checklist items</span><span class="count all-n">${t0.done}/${t0.total}</span><span class="chev">${icons.chevron}</span></summary>
        <div class="pc-body">${groupsHTML}</div></details>`;
    } else list += `<section class="block"><div class="block-head"><h2 class="label">Checklist</h2></div>${groupsHTML}</section>`;
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
  return null;
}

// Loadouts hub ------------------------------------------------------------------------

const tableCells = (line) =>
  line
    .replace(/\\\|/g, '\u0000')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.replace(/\u0000/g, '|').trim());
const plain = (s) => String(s).replace(/\*\*|__|`|~~/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

/**
 * Read a class guide body: "**Tier S** · SMG · Best for: …" first line, then
 * two-column tables. → { tier, sub, title, body, preview: [[label, text]] }
 */
export function parseClass(guide) {
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
    const head = tableCells(l);
    const rows = [];
    let j = i + 2;
    while (j < bodyLines.length && bodyLines[j].includes('|') && bodyLines[j].trim()) rows.push(tableCells(bodyLines[j++]));
    if (head.length === 2) tables.push({ head, rows });
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
  return { tier, sub, title, body: bodyLines.join('\n'), preview };
}

function classCardHTML(game, guide, gp, open) {
  const c = parseClass(guide);
  const linked = (guide.items || []).filter((it) => it.type === 'check');
  const built = linked.length > 0 && linked.every((it) => isDone(gp, it));
  const tierCls = /^s/i.test(c.tier) ? 's' : /^a/i.test(c.tier) ? 'a' : 'b';
  return `<details class="class-card${built ? ' is-built' : ''}" data-card="${esc(guide.id)}" data-guide="${esc(guide.id)}"${open ? ' open' : ''}>
    <summary>
      <span class="cc-top">
        ${c.tier ? `<span class="tier tier-${tierCls}" aria-label="Tier ${esc(c.tier)}">${esc(c.tier)}</span>` : ''}
        <span class="cc-titles"><span class="cc-title">${esc(c.title)}</span>${c.sub ? `<span class="cc-sub">${esc(c.sub)}</span>` : ''}</span>
        ${
          linked.length
            ? `<button type="button" class="cc-built" data-act="built" aria-pressed="${built}" aria-label="${esc(
                linked.map((it) => it.title).join(', ')
              )}: done">${icons.check}</button>`
            : ''
        }
        <span class="chev">${icons.chevron}</span>
      </span>
      ${
        c.preview.length
          ? `<span class="cc-preview">${c.preview
              .map(([k, v]) => `<span class="cc-line"><span class="cc-k">${esc(k)}</span><span class="cc-v">${esc(v)}</span></span>`)
              .join('')}</span>`
          : ''
      }
    </summary>
    <div class="cc-body">
      ${linked.length ? `<div class="item-list cc-items">${linked.map((it) => itemRow(game, it, { hideGuide: true })).join('')}</div>` : ''}
      <div class="md md-class">${renderMarkdown(c.body, mdCtx(game, { kvTables: true }))}</div>
    </div>
  </details>`;
}

function renderLoadouts(ctx, entry) {
  const { game } = entry;
  const st = gameUI(game.id);
  const main = gamePage(ctx, entry, { title: game.title, back: '#/', body: '<div class="hub"></div>' });
  if (!main) return null;
  const hub = main.querySelector('.hub');
  const checklistCat = game.items.length ? game.layout.checklist : null;

  const draw = () => {
    const gp = store.game(game.id);
    let html = noteStrip(game) + inProgressHTML(game, gp);
    for (const cat of categoryOrder(game)) {
      if (checklistCat && cat === checklistCat) continue; // shown with the checklist
      const list = game.guides.filter((g) => g.category === cat);
      const cards = game.layout.cards.includes(cat);
      html += `<section class="block"><div class="block-head"><h2 class="label">${esc(cat || 'Other')}</h2>${
        cards ? `<span class="count">${list.length}</span>` : ''
      }</div>`;
      if (cards) html += `<div class="class-list">${list.map((g) => classCardHTML(game, g, gp, st.openCards.has(g.id))).join('')}</div>`;
      else {
        html += `<div class="card-stack">${list
          .map((g) => (isWalk(g) ? `<div class="rows">${guideRowHTML(game, g, gp)}</div>` : pageCardHTML(game, g, st.openCards.has(g.id))))
          .join('')}</div>`;
      }
      html += '</section>';
    }
    if (game.items.length) {
      const t = tally(gp, game.items);
      const groups = game.sections.flatMap((s) => s.groups.filter((g) => g.items.length));
      const starred = groups.filter((g) => gp.starred[g.key]).map((g) => g.title);
      html += `<section class="block"><a class="entry" href="#/game/${enc(game.id)}/groups">
        <span class="entry-icon">${icons.star}</span>
        <span class="entry-main"><span class="entry-title">${esc(game.layout.checklist)}</span>
          <span class="entry-meta">${
            starred.length ? `Starred: ${esc(starred.slice(0, 3).join(', '))}${starred.length > 3 ? '…' : ''}` : `${groups.length} to pick from`
          } · ${t.done}/${t.total} done</span></span>${icons.chevron}</a></section>`;
    }
    html += browseHTML(game, gp, { checklist: false });
    hub.innerHTML = html;
  };
  draw();
  rememberOpenCards(hub, st);
  const syncCards = () => {
    const gp = store.game(game.id);
    hub.querySelectorAll('.class-card[data-guide]').forEach((card) => {
      const g = game.guideById.get(card.dataset.guide);
      const linked = (g?.items || []).filter((it) => it.type === 'check');
      const built = linked.length > 0 && linked.every((it) => isDone(gp, it));
      card.classList.toggle('is-built', built);
      card.querySelector('.cc-built')?.setAttribute('aria-pressed', String(built));
      for (const it of linked) card.querySelectorAll(`.item[data-id="${cssEscape(it.id)}"]`).forEach((r) => updateRow(r, game, it));
    });
  };
  // The round tick on a class card ticks its checklist item(s) without opening the card.
  hub.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="built"]');
    if (!b) return;
    e.preventDefault();
    const g = game.guideById.get(b.closest('.class-card').dataset.guide);
    const linked = (g?.items || []).filter((it) => it.type === 'check');
    const on = !linked.every((it) => isDone(store.game(game.id), it));
    for (const it of linked) store.setChecked(game.id, it.id, on);
    syncCards();
  });
  bindItems(hub, { onChange: syncCards });
  return null;
}

// Checklist group picker (e.g. pick a weapon, then its camos) ---------------------------

function groupPickRow(game, g, gp) {
  const t = tally(gp, g.items);
  const on = !!gp.starred[g.key];
  return `<div class="gpick${on ? ' is-starred' : ''}${t.total && t.done === t.total ? ' is-complete' : ''}" data-key="${esc(g.key)}">
    <button type="button" class="star-btn" data-act="star" aria-pressed="${on}" aria-label="${on ? 'Unstar' : 'Star'} ${esc(g.title)}">${icons.star}</button>
    <a class="gpick-main" href="${groupHref(game, g)}"><span class="gpick-title">${esc(g.title)}</span>
      <span class="gpick-meta"><span class="gpick-n">${t.done}/${t.total}</span><span class="gpick-bar"><span style="width:${t.pct}%"></span></span></span>
      ${icons.chevron}</a>
  </div>`;
}

export function renderGroups(ctx, entry) {
  const { game } = entry;
  const groups = game.sections.flatMap((s) => s.groups.filter((g) => g.items.length));
  if (groups.length === 1) {
    return renderGroup(ctx, entry, groups[0], hubHref(game), { title: groups[0].section.title, sub: game.title });
  }
  const st = gameUI(game.id);
  const guides = game.guides.filter((g) => g.category === game.layout.checklist);
  const searchable = groups.length > 10;
  const main = gamePage(ctx, entry, {
    title: game.layout.checklist,
    sub: game.title,
    back: hubHref(game),
    body: `${guides.length ? `<div class="card-stack picker-guides">${guides.map((g) => (isWalk(g) ? `<div class="rows">${guideRowHTML(game, g, store.game(game.id))}</div>` : pageCardHTML(game, g, st.openCards.has(g.id)))).join('')}</div>` : ''}
      ${
        searchable
          ? `<label class="search-field picker-search">${icons.search}<span class="sr-only">Find</span><input type="search" class="group-q" placeholder="Find one of ${
              groups.length
            }" value="${esc(st.groupQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>`
          : ''
      }
      <div class="picker"></div>`,
  });
  if (!main) return null;
  const picker = main.querySelector('.picker');
  const input = main.querySelector('.group-q');
  rememberOpenCards(main, st);

  const draw = () => {
    const gp = store.game(game.id);
    if (!groups.length) {
      picker.innerHTML = emptyBox('Nothing to track yet.');
      return;
    }
    const terms = searchTerms(st.groupQuery);
    const match = (g) => !terms.length || matchesAll(fold(`${g.title} ${g.section.title}`), terms);
    const starred = groups.filter((g) => gp.starred[g.key] && match(g)).sort((a, b) => gp.starred[a.key] - gp.starred[b.key]);
    let html = '';
    if (starred.length) {
      html += `<section class="block"><div class="block-head"><h2 class="label">Starred</h2></div><div class="gpick-list">${starred
        .map((g) => groupPickRow(game, g, gp))
        .join('')}</div></section>`;
    }
    const multi = game.sections.filter((s) => s.groups.some((g) => g.items.length)).length > 1;
    for (const s of game.sections) {
      const list = s.groups.filter((g) => g.items.length && match(g) && !gp.starred[g.key]);
      if (!list.length) continue;
      html += `<section class="block">${
        multi || starred.length ? `<div class="block-head"><h2 class="label">${esc(s.title)}</h2></div>` : ''
      }<div class="gpick-list">${list.map((g) => groupPickRow(game, g, gp)).join('')}</div></section>`;
    }
    if (!html) html = emptyBox(`Nothing matches “${esc(st.groupQuery.trim())}”.`);
    else if (!starred.length && !terms.length) html = `<p class="hint">${icons.star} Star the ones you use and they stay on top.</p>${html}`;
    picker.innerHTML = html;
  };
  draw();

  const onSearch = debounce(() => {
    st.groupQuery = input.value;
    draw();
  }, 120);
  input?.addEventListener('input', onSearch);
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="star"]');
    if (!b) return;
    const key = b.closest('.gpick').dataset.key;
    store.setStarred(game.id, key, !store.game(game.id).starred[key]);
    draw();
  });
  return () => onSearch.cancel();
}

/** One checklist group, e.g. one weapon's camos. */
export function renderGroup(ctx, entry, group = null, back = null, names = null) {
  const { game } = entry;
  const g = group || game.groupByKey.get(`${ctx.route.sectionId}/${ctx.route.groupId}`);
  const backHref = back || `#/game/${enc(game.id)}/groups`;
  if (!g) {
    gamePage(ctx, entry, {
      title: game.title,
      back: backHref,
      body: emptyBox('<p class="empty-title">Not found</p><p>This list isn\'t in the game file (any more).</p>'),
    });
    return null;
  }
  const headHTML = () => {
    const gp = store.game(game.id);
    const t = tally(gp, g.items);
    const on = !!gp.starred[g.key];
    // Starring only makes sense when there are other lists to sort against.
    return `<span class="group-count">${t.done} of ${t.total} done</span>${
      names
        ? ''
        : `<button type="button" class="btn small star-toggle${on ? ' is-on' : ''}" data-act="star" aria-pressed="${on}">${icons.star}<span>${
            on ? 'Starred' : 'Star'
          }</span></button>`
    }`;
  };
  // Every item points at the same guide (e.g. the camo table): show it once.
  const shared = g.items.length > 1 && g.items[0].guide && g.items.every((it) => it.guide === g.items[0].guide);
  const sharedGuide = shared ? game.guideById.get(g.items[0].guide) : null;
  const main = gamePage(ctx, entry, {
    title: names?.title || g.title,
    sub: names?.sub || g.section.title,
    back: backHref,
    body: `<div class="group-head">${headHTML()}</div><div class="item-list">${g.items
      .map((it) => itemRow(game, it, { hideGuide: !!sharedGuide }))
      .join('')}</div>${
      sharedGuide ? `<div class="block">${isWalk(sharedGuide) ? `<div class="rows">${guideRowHTML(game, sharedGuide, store.game(game.id))}</div>` : pageCardHTML(game, sharedGuide, false)}</div>` : ''
    }`,
  });
  if (!main) return null;
  const head = main.querySelector('.group-head');
  head.addEventListener('click', (e) => {
    if (!e.target.closest('[data-act="star"]')) return;
    store.setStarred(game.id, g.key, !store.game(game.id).starred[g.key]);
    head.innerHTML = headHTML();
  });
  bindItems(main, { onChange: () => (head.innerHTML = headHTML()) });
  return null;
}

// Entry ---------------------------------------------------------------------------------

export function renderHub(ctx, entry) {
  const type = entry.game.layout.type;
  if (type === 'maps') return renderMaps(ctx, entry);
  if (type === 'loadouts') return renderLoadouts(ctx, entry);
  return renderStory(ctx, entry);
}

export { guideLinkHTML };
