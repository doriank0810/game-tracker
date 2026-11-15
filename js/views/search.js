// Search across every game's checklist items and guides.
import * as data from '../data.js';
import { esc, enc, fold, plural, debounce, searchTerms, matchesAll, accentStyle } from '../util.js';
import { itemSearchText, guideSearchText } from '../content.js';
import { topBar, itemRow, bindItems, guideLinkHTML, whereHTML, emptyBox } from '../ui.js';
import { gameUI } from '../state.js';
import { icons } from '../icons.js';
import { replaceQuiet } from '../router.js';

const ITEMS_PER_GAME = 20;
const GUIDES_PER_GAME = 5;

export async function render(ctx) {
  const q0 = ctx.route.q || '';
  ctx.mount(`${topBar({ title: 'Search', back: '#/', noSearch: true })}
    <main class="page page-search">
      <label class="search-field big">${icons.search}<span class="sr-only">Search all games</span>
        <input type="search" class="global-q" placeholder="Search all games" value="${esc(q0)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </label>
      <div class="results"><p class="hint">Loading your games…</p></div>
    </main>`);
  document.title = 'Search · Game Tracker';
  const input = ctx.root.querySelector('.global-q');
  const results = ctx.root.querySelector('.results');
  if (!q0) input.focus({ preventScroll: true });

  let entries;
  try {
    entries = await data.getAllGames();
  } catch (err) {
    if (ctx.isCurrent()) results.innerHTML = emptyBox(`Couldn't load your games: ${esc(err.message)}`);
    return null;
  }
  if (!ctx.isCurrent()) return null;
  const games = entries.filter((e) => e.game).map((e) => e.game);

  const run = () => {
    const q = input.value.trim();
    const terms = searchTerms(q);
    if (!terms.length) {
      results.innerHTML = `<p class="hint">Search checklist items and guides in all your games.</p>`;
      return;
    }
    let html = '';
    for (const game of games) {
      const guides = game.guides.filter((g) => matchesAll(guideSearchText(g), terms));
      const items = [];
      for (const it of game.items) if (matchesAll(itemSearchText(it), terms)) items.push(it);
      if (!guides.length && !items.length) continue;
      const rank = new Map(items.map((it) => [it, matchesAll(fold(it.title), terms) ? 0 : 1]));
      items.sort((a, b) => rank.get(a) - rank.get(b) || a.order - b.order);
      const count = guides.length + items.length;
      html += `<section class="result-game" style="${accentStyle(game.accent)}">
        <div class="result-head"><a class="result-title" href="#/game/${enc(game.id)}">${esc(game.title)}</a><span class="count">${plural(
          count,
          'result'
        )}</span></div>
        ${guides.length ? `<div class="link-list">${guides.slice(0, GUIDES_PER_GAME).map((g) => guideLinkHTML(game, g)).join('')}</div>` : ''}
        ${
          items.length
            ? `<div class="item-list">${items
                .slice(0, ITEMS_PER_GAME)
                .map((it) => itemRow(game, it, { meta: whereHTML(it), link: true }))
                .join('')}</div>`
            : ''
        }
        ${
          items.length > ITEMS_PER_GAME
            ? `<a class="more-link" href="#/game/${enc(game.id)}/list" data-setq="${esc(q)}" data-game="${esc(game.id)}">Show all ${
                items.length
              } matching items in the checklist</a>`
            : ''
        }
      </section>`;
    }
    results.innerHTML = html || emptyBox(`Nothing found for “${esc(q)}”.`);
  };
  run();

  const onInput = debounce(() => {
    const q = input.value.trim();
    replaceQuiet(q ? `#/search?q=${encodeURIComponent(q)}` : '#/search');
    run();
  }, 160);
  input.addEventListener('input', onInput);
  bindItems(results);
  results.addEventListener('click', (e) => {
    const a = e.target.closest('[data-setq]');
    if (!a) return;
    const st = gameUI(a.dataset.game);
    st.query = a.dataset.setq;
    st.filter = 'all';
    st.resultLimit = 0;
  });
  return () => onInput.cancel();
}
