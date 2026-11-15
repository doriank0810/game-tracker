// Game page: header with progress, then three tabs (Next, Checklist, Guides).
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, relTime, plural, debounce, searchTerms, matchesAll, cssEscape } from '../util.js';
import { itemSearchText, guideSearchText } from '../content.js';
import { tally, nextItems, isDone, firstOpen, effectiveStatus, guideTally, firstOpenStep } from '../progress.js';
import {
  topBar,
  itemRow,
  bindItems,
  errorBox,
  emptyBox,
  offlineNote,
  statusSelect,
  whereHTML,
  guideLinkHTML,
  followHref,
} from '../ui.js';
import { gameUI, openItems, okey } from '../state.js';
import { icons } from '../icons.js';

const CHUNK = 200;
const FILTERS = { all: 'All', remaining: 'Remaining', done: 'Done' };

export async function render(ctx) {
  const { gameId, tab, focus } = ctx.route;
  const entry = await data.getGame(gameId);
  if (!ctx.isCurrent()) return;
  if (entry.error) {
    ctx.mount(`${topBar({ title: 'Game', back: '#/' })}<main class="page">${errorBox(
      "Couldn't open this game",
      entry.error
    )}</main>`);
    return;
  }
  const { game } = entry;
  const base = `#/game/${enc(game.id)}`;
  const tabLink = (href, label, active) =>
    `<a class="tab" href="${href}" data-replace${active ? ' aria-current="page"' : ''}>${label}</a>`;
  ctx.mount(
    `${topBar({ title: game.title, back: '#/' })}
    <main class="page page-game">
      ${entry.offline ? offlineNote() : ''}
      <section class="hero">${heroHTML(game)}</section>
      <nav class="tabs" aria-label="Game sections">
        ${tabLink(base, 'Next', tab === 'next')}
        ${tabLink(`${base}/list`, 'Checklist', tab === 'list')}
        ${tabLink(
          `${base}/guides`,
          `Guides${game.guides.length ? `<span class="tab-n">${game.guides.length}</span>` : ''}`,
          tab === 'guides'
        )}
      </nav>
      <div class="panel"></div>
    </main>`,
    { accent: game.accent }
  );
  document.title = `${game.title} · Game Tracker`;
  const main = ctx.root.querySelector('main');
  const hero = main.querySelector('.hero');
  const panel = main.querySelector('.panel');
  const updateHero = () => patchHero(hero, game);

  hero.addEventListener('change', (e) => {
    const sel = e.target.closest('.status-select');
    if (!sel) return;
    store.setStatus(game.id, sel.value === game.baseStatus ? null : sel.value);
    sel.className = `status-select st-${sel.value}`;
  });

  if (tab === 'list') return renderChecklist(panel, game, updateHero, focus);
  if (tab === 'guides') return renderGuides(panel, game);
  return renderNext(panel, game, updateHero);
}

// Header -----------------------------------------------------------------------

const lastText = (gp) => (gp.lastPlayed ? `Played ${relTime(gp.lastPlayed)}` : 'Not played yet');
const upToHTML = (at) =>
  at ? `<span class="label-inline">Up to</span> ${esc(at.section.title)} › ${esc(at.group.title)}` : '';

function heroHTML(game) {
  const gp = store.game(game.id);
  const t = tally(gp, game.items);
  const status = effectiveStatus(game.baseStatus, gp);
  return `<div class="hero-meta">
      ${game.platform ? `<span class="hero-platform">${esc(game.platform)}</span>` : ''}
      ${statusSelect(status)}
    </div>
    <div class="progress-row hero-progress"><div class="bar"><span style="width:${t.pct}%"></span></div><span class="pct">${t.pct}%</span></div>
    <div class="hero-foot"><span class="hero-count">${t.done} of ${t.total} done</span><span class="hero-last">${lastText(gp)}</span></div>
    <div class="hero-at">${upToHTML(firstOpen(game, gp))}</div>`;
}

function patchHero(hero, game) {
  const gp = store.game(game.id);
  const t = tally(gp, game.items);
  hero.querySelector('.bar > span').style.width = `${t.pct}%`;
  hero.querySelector('.pct').textContent = `${t.pct}%`;
  hero.querySelector('.hero-count').textContent = `${t.done} of ${t.total} done`;
  hero.querySelector('.hero-last').textContent = lastText(gp);
  hero.querySelector('.hero-at').innerHTML = upToHTML(firstOpen(game, gp));
}

// Next tab -----------------------------------------------------------------------

function renderNext(panel, game, onAny) {
  const st = gameUI(game.id);
  const gp0 = store.game(game.id);
  panel.innerHTML = `
    <section class="block note-block">
      <div class="block-head"><label class="label" for="note">Where I left off</label><span class="note-state" aria-live="polite">${
        gp0.noteAt ? `Saved ${relTime(gp0.noteAt)}` : ''
      }</span></div>
      <textarea id="note" class="note" rows="2" placeholder="Where you saved, what you were in the middle of…">${esc(
        gp0.note
      )}</textarea>
    </section>
    <section class="block walk-block" hidden></section>
    <section class="block">
      <div class="block-head"><h2 class="label">Next session</h2></div>
      <div class="next-list"></div>
    </section>
    <section class="block done-block" hidden></section>`;

  const listEl = panel.querySelector('.next-list');
  const walkEl = panel.querySelector('.walk-block');
  const doneEl = panel.querySelector('.done-block');

  const draw = () => {
    const gp = store.game(game.id);
    const next = nextItems(game, gp, 5);
    if (!st.autoOpened) {
      st.autoOpened = true;
      const first = next[0]?.item;
      if (first && (first.detail || first.guide)) openItems.add(okey(game.id, first.id));
    }
    const meta = (item) => whereHTML(item);
    if (!game.items.length) listEl.innerHTML = emptyBox('No checklist items yet.');
    else if (!next.length) listEl.innerHTML = emptyBox('<p class="empty-title">All done</p><p>Nothing left to do in this game.</p>');
    else {
      const anyPinned = Object.keys(gp.pinned).some((id) => game.byId.has(id));
      listEl.innerHTML = `<div class="item-list">${next.map(({ item }) => itemRow(game, item, { meta: meta(item) })).join('')}</div>${
        anyPinned ? '' : `<p class="hint">Tap ${icons.pin} on any item to pin it to the top of this list.</p>`
      }`;
    }

    // Walkthroughs that are started but not finished.
    const inProgress = game.guides.filter((g) => {
      if (g.kind !== 'walkthrough' || !g.steps.length) return false;
      const t = guideTally(gp, g);
      return t.done > 0 && t.done < t.total;
    });
    walkEl.hidden = !inProgress.length;
    walkEl.innerHTML = inProgress.length
      ? `<div class="block-head"><h2 class="label">Guides in progress</h2></div><div class="link-list">${inProgress
          .map((g) => {
            const t = guideTally(gp, g);
            const n = firstOpenStep(gp, g);
            return `<a class="link-row walk-row" href="${followHref(game, g, g.steps[n])}"><span class="link-main"><span class="link-title">${esc(
              g.title
            )}</span><span class="link-meta">${icons.play}Continue at step ${n + 1} of ${t.total}</span></span>${icons.chevron}</a>`;
          })
          .join('')}</div>`
      : '';

    st.sessionDone = st.sessionDone.filter((id) => game.byId.has(id) && isDone(gp, game.byId.get(id)));
    doneEl.hidden = !st.sessionDone.length;
    doneEl.innerHTML = st.sessionDone.length
      ? `<div class="block-head"><h2 class="label">Done this session</h2><span class="count">${st.sessionDone.length}</span></div>
         <div class="item-list">${st.sessionDone.map((id) => itemRow(game, game.byId.get(id), { meta: meta(game.byId.get(id)) })).join('')}</div>`
      : '';
  };
  draw();

  const redraw = debounce(draw, 450);
  bindItems(panel, {
    onChange: ({ item, act, wasDone, nowDone }) => {
      onAny();
      if (wasDone !== nowDone) {
        if (nowDone && !st.sessionDone.includes(item.id)) st.sessionDone.unshift(item.id);
        redraw();
      } else if (act === 'pin') redraw();
    },
  });

  // "Where I left off" note, saved automatically.
  const note = panel.querySelector('#note');
  const stateEl = panel.querySelector('.note-state');
  const autosize = () => {
    note.style.height = 'auto';
    note.style.height = `${Math.max(note.scrollHeight + 2, 64)}px`;
  };
  let timer = null;
  const flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    store.setNote(game.id, note.value);
    stateEl.textContent = 'Saved';
    onAny();
  };
  note.addEventListener('input', () => {
    autosize();
    stateEl.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  });
  note.addEventListener('blur', flush);
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  requestAnimationFrame(autosize);

  return () => {
    flush();
    redraw.cancel();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  };
}

// Checklist tab --------------------------------------------------------------------

function renderChecklist(panel, game, onAny, focusId) {
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

  panel.innerHTML = `
    <div class="toolbar">
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
    <div class="tree"></div>`;
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
      onAny();
    },
  });

  return () => onSearch.cancel();
}

// Guides tab --------------------------------------------------------------------------

function renderGuides(panel, game) {
  const st = gameUI(game.id);
  if (!game.guides.length) {
    panel.innerHTML = emptyBox('No guides for this game yet.');
    return null;
  }
  panel.innerHTML = `
    <div class="toolbar">
      <label class="search-field">${icons.search}<span class="sr-only">Search guides</span>
        <input type="search" class="guide-q" placeholder="Search guides" value="${esc(st.guideQuery)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </label>
    </div>
    <div class="guide-list"></div>`;
  const listEl = panel.querySelector('.guide-list');
  const input = panel.querySelector('.guide-q');
  const draw = () => {
    const terms = searchTerms(st.guideQuery);
    const found = terms.length ? game.guides.filter((g) => matchesAll(guideSearchText(g), terms)) : game.guides;
    if (!found.length) {
      listEl.innerHTML = emptyBox(`No guides match “${esc(st.guideQuery.trim())}”.`);
      return;
    }
    const cats = new Map();
    for (const g of found) {
      const c = g.category || '';
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c).push(g);
    }
    const keys = [...cats.keys()].sort((a, b) => (a === '') - (b === ''));
    const showHeads = keys.length > 1 || keys[0] !== '';
    listEl.innerHTML = keys
      .map(
        (c) => `<section class="block">${showHeads ? `<h2 class="label block-head">${esc(c || 'Other')}</h2>` : ''}
          <div class="link-list">${cats.get(c).map((g) => guideLinkHTML(game, g)).join('')}</div></section>`
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
