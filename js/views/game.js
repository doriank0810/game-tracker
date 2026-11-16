// Game pages. The first page depends on the game's layout (views/hubs.js);
// this file also has the full checklist and the list of all guides.
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, plural, debounce, searchTerms, matchesAll, cssEscape } from '../util.js';
import { itemSearchText, guideSearchText, categoryOrder } from '../content.js';
import { tally, nextItems, isDone } from '../progress.js';
import { topBar, itemRow, bindItems, errorBox, emptyBox, whereHTML, guideLinkHTML, gamePage } from '../ui.js';
import { gameUI } from '../state.js';
import { icons } from '../icons.js';
import { renderHub, renderSection, renderGroups, renderGroup } from './hubs.js';

const CHUNK = 200;
const FILTERS = { all: 'All', remaining: 'To do', done: 'Done' };

export async function render(ctx) {
  const { gameId, tab, focus } = ctx.route;
  const entry = await data.getGame(gameId);
  if (!ctx.isCurrent()) return null;
  if (entry.error) {
    ctx.mount(`${topBar({ title: 'Game', back: '#/' })}<main class="page">${errorBox("Couldn't open this game", entry.error)}</main>`);
    return null;
  }
  switch (tab) {
    case 'list':
      return renderChecklist(ctx, entry, focus);
    case 'guides':
      return renderGuides(ctx, entry);
    case 'section':
      return renderSection(ctx, entry);
    case 'groups':
      return renderGroups(ctx, entry);
    case 'group':
      return renderGroup(ctx, entry);
    default:
      return renderHub(ctx, entry);
  }
}

// Full checklist --------------------------------------------------------------------

function renderChecklist(ctx, entry, focusId) {
  const { game } = entry;
  const st = gameUI(game.id);
  const focusItem = focusId ? game.byId.get(focusId) || null : null;
  if (!st.listInited) {
    st.listInited = true;
    const first = nextItems(game, store.game(game.id), 1)[0];
    if (first) st.openGroups.add(first.item.group.key);
  }
  if (focusItem) {
    st.query = '';
    st.filter = 'all';
    st.resultLimit = 0;
    st.openGroups.add(focusItem.group.key);
    st.closedSections.delete(focusItem.section.id);
  }

  const main = gamePage(ctx, entry, {
    title: 'Checklist',
    sub: game.title,
    back: `#/game/${enc(game.id)}`,
    body: `<div class="toolbar">
      <label class="search-field">${icons.search}<span class="sr-only">Search this game</span>
        <input type="search" class="list-q" placeholder="Search this game" value="${esc(st.query)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </label>
      <div class="toolbar-row">
        <div class="seg" role="group" aria-label="Show">${Object.entries(FILTERS)
          .map(([f, label]) => `<button type="button" data-act="filter" data-f="${f}" aria-pressed="${st.filter === f}">${label}</button>`)
          .join('')}</div>
        <button type="button" class="text-btn" data-act="collapse">Close all</button>
      </div>
    </div>
    <div class="tree"></div>`,
  });
  if (!main) return null;
  const panel = main;
  const tree = panel.querySelector('.tree');
  const input = panel.querySelector('.list-q');

  const visible = (items, gp) =>
    st.filter === 'all' ? items : items.filter((it) => isDone(gp, it) === (st.filter === 'done'));

  const rowsHTML = (g, vis, from) => {
    let until = from + CHUNK;
    if (focusItem && focusItem.group === g) until = Math.max(until, vis.indexOf(focusItem) + 1);
    const rows = vis
      .slice(from, until)
      .map((it) => itemRow(game, it))
      .join('');
    const left = vis.length - until;
    return (
      rows +
      (left > 0
        ? `<button type="button" class="more-btn" data-act="more" data-from="${until}">Show ${Math.min(
            left,
            CHUNK
          )} more <span class="muted">(${left} left)</span></button>`
        : '')
    );
  };

  const groupBody = (g, gp) => {
    const vis = visible(g.items, gp);
    return vis.length ? rowsHTML(g, vis, 0) : '<p class="grp-empty">Nothing to show with this filter.</p>';
  };

  const groupHTML = (g, gp) => {
    const t = tally(gp, g.items);
    const open = st.openGroups.has(g.key);
    return `<div class="grp${open ? ' is-open' : ''}${t.total && t.done === t.total ? ' is-complete' : ''}" data-grp="${esc(g.key)}">
      <button type="button" class="grp-head" data-act="grp" aria-expanded="${open}">
        <span class="chev">${icons.chevron}</span>
        <span class="grp-title">${esc(g.title)}</span>
        <span class="grp-count">${t.done}/${t.total}</span>
        <span class="grp-bar"><span style="width:${t.pct}%"></span></span>
      </button>
      <div class="grp-body">${open ? groupBody(g, gp) : ''}</div>
    </div>`;
  };

  const sectionsHTML = () => {
    const gp = store.game(game.id);
    if (!game.items.length) return emptyBox('No checklist items yet.');
    let out = '';
    for (const sec of game.sections) {
      const groups = sec.groups.filter((g) => g.items.length && (st.filter === 'all' || visible(g.items, gp).length));
      if (!groups.length) continue;
      const t = tally(gp, sec.items);
      const closed = st.closedSections.has(sec.id);
      out += `<section class="sec${closed ? ' is-closed' : ''}" data-sec="${esc(sec.id)}">
        <button type="button" class="sec-head" data-act="sec" aria-expanded="${!closed}">
          <span class="chev">${icons.chevron}</span><span class="sec-title">${esc(sec.title)}</span>
          <span class="sec-count">${t.done}/${t.total}</span>
        </button>
        <div class="sec-bar"><span style="width:${t.pct}%"></span></div>
        <div class="sec-body">${groups.map((g) => groupHTML(g, gp)).join('')}</div>
      </section>`;
    }
    if (!out) return emptyBox(st.filter === 'done' ? 'Nothing ticked yet.' : '<p class="empty-title">All done</p><p>Everything here is ticked.</p>');
    return out;
  };

  const resultsHTML = () => {
    const gp = store.game(game.id);
    const terms = searchTerms(st.query);
    const hits = visible(game.items, gp).filter((it) => matchesAll(itemSearchText(it), terms));
    if (!hits.length) return emptyBox(`No items match “${esc(st.query.trim())}”.`);
    const limit = st.resultLimit || CHUNK;
    let out = `<p class="result-count">${plural(hits.length, 'match', 'matches')}</p>`;
    let lastGroup = null;
    for (const it of hits.slice(0, limit)) {
      if (it.group !== lastGroup) {
        if (lastGroup) out += '</div>';
        out += `<h3 class="label result-group">${whereHTML(it)}</h3><div class="item-list">`;
        lastGroup = it.group;
      }
      out += itemRow(game, it);
    }
    out += '</div>';
    if (hits.length > limit) {
      out += `<button type="button" class="more-btn" data-act="more-results">Show more <span class="muted">(${
        hits.length - limit
      } left)</span></button>`;
    }
    return out;
  };

  const draw = () => {
    tree.innerHTML = st.query.trim() ? resultsHTML() : sectionsHTML();
  };
  draw();

  if (focusItem) {
    requestAnimationFrame(() => {
      const row = tree.querySelector(`.item[data-id="${cssEscape(focusItem.id)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('flash');
    });
  }

  const onSearch = debounce(() => {
    st.query = input.value;
    st.resultLimit = 0;
    draw();
  }, 150);
  input.addEventListener('input', onSearch);

  panel.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('.item')) return;
    switch (el.dataset.act) {
      case 'filter':
        st.filter = el.dataset.f;
        st.resultLimit = 0;
        panel.querySelectorAll('[data-act="filter"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === st.filter)));
        draw();
        break;
      case 'collapse':
        st.openGroups.clear();
        draw();
        break;
      case 'sec': {
        const sec = el.closest('.sec');
        const closed = sec.classList.toggle('is-closed');
        el.setAttribute('aria-expanded', String(!closed));
        if (closed) st.closedSections.add(sec.dataset.sec);
        else st.closedSections.delete(sec.dataset.sec);
        break;
      }
      case 'grp': {
        const grpEl = el.closest('.grp');
        const g = game.groupByKey.get(grpEl.dataset.grp);
        if (!g) return;
        const open = !grpEl.classList.contains('is-open');
        grpEl.classList.toggle('is-open', open);
        el.setAttribute('aria-expanded', String(open));
        const body = grpEl.querySelector('.grp-body');
        if (open) {
          st.openGroups.add(g.key);
          body.innerHTML = groupBody(g, store.game(game.id));
        } else {
          st.openGroups.delete(g.key);
          body.innerHTML = '';
          const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
          if (grpEl.getBoundingClientRect().top < top) grpEl.scrollIntoView({ block: 'start' });
        }
        break;
      }
      case 'more': {
        const grpEl = el.closest('.grp');
        const g = game.groupByKey.get(grpEl.dataset.grp);
        const from = Number(el.dataset.from) || 0;
        el.remove();
        grpEl.querySelector('.grp-body').insertAdjacentHTML('beforeend', rowsHTML(g, visible(g.items, store.game(game.id)), from));
        break;
      }
      case 'more-results':
        st.resultLimit = (st.resultLimit || CHUNK) + CHUNK;
        draw();
        break;
      default:
    }
  });

  bindItems(panel, {
    onChange: ({ item }) => {
      const gp = store.game(game.id);
      const grpEl = tree.querySelector(`.grp[data-grp="${cssEscape(item.group.key)}"]`);
      if (grpEl) {
        const t = tally(gp, item.group.items);
        grpEl.querySelector('.grp-count').textContent = `${t.done}/${t.total}`;
        grpEl.querySelector('.grp-bar > span').style.width = `${t.pct}%`;
        grpEl.classList.toggle('is-complete', t.total > 0 && t.done === t.total);
      }
      const secEl = tree.querySelector(`.sec[data-sec="${cssEscape(item.section.id)}"]`);
      if (secEl) {
        const t = tally(gp, item.section.items);
        secEl.querySelector('.sec-count').textContent = `${t.done}/${t.total}`;
        secEl.querySelector('.sec-bar > span').style.width = `${t.pct}%`;
      }
    },
  });

  return () => onSearch.cancel();
}

// All guides ---------------------------------------------------------------------------

function renderGuides(ctx, entry) {
  const { game } = entry;
  const st = gameUI(game.id);
  const main = gamePage(ctx, entry, {
    title: 'All guides',
    sub: game.title,
    back: `#/game/${enc(game.id)}`,
    body: game.guides.length
      ? `<div class="toolbar">
          <label class="search-field">${icons.search}<span class="sr-only">Search guides</span>
            <input type="search" class="guide-q" placeholder="Search guides" value="${esc(st.guideQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          </label>
        </div>
        <div class="guide-list"></div>`
      : emptyBox('No guides for this game yet.'),
  });
  if (!main || !game.guides.length) return null;
  const listEl = main.querySelector('.guide-list');
  const input = main.querySelector('.guide-q');
  const draw = () => {
    const terms = searchTerms(st.guideQuery);
    const found = terms.length ? game.guides.filter((g) => matchesAll(guideSearchText(g), terms)) : game.guides;
    if (!found.length) {
      listEl.innerHTML = emptyBox(`No guides match “${esc(st.guideQuery.trim())}”.`);
      return;
    }
    const cats = categoryOrder(game, found);
    const showHeads = cats.length > 1 || cats[0] !== '';
    listEl.innerHTML = cats
      .map(
        (c) => `<section class="block">${showHeads ? `<div class="block-head"><h2 class="label">${esc(c || 'Other')}</h2></div>` : ''}
          <div class="link-list">${found
            .filter((g) => g.category === c)
            .map((g) => guideLinkHTML(game, g))
            .join('')}</div></section>`
      )
      .join('');
  };
  draw();
  const onSearch = debounce(() => {
    st.guideQuery = input.value;
    draw();
  }, 150);
  input.addEventListener('input', onSearch);
  return () => onSearch.cancel();
}
