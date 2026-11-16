// Home: one card per game, grouped by status (playing first).
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, relTime, accentStyle, cssEscape } from '../util.js';
import { STATUS_ORDER, STATUS_LABEL } from '../content.js';
import { tally, nextItems, effectiveStatus, whereToContinue } from '../progress.js';
import { topBar, statusChip, errorBox, emptyBox } from '../ui.js';

/** [label, text] for the card's one-line "what's next", per layout. */
function nextLine(game, gp) {
  const { layout } = game;
  if (layout.type === 'maps') {
    const c = whereToContinue(game, gp);
    if (c?.guide) return ['Continue', `${c.section ? `${c.section.title} › ` : ''}${c.guide.title}`];
    if (c?.section) return ['Continue', c.section.title];
    return ['Start', `Pick one of ${game.sections.length} ${layout.picker.toLowerCase()}`];
  }
  if (layout.type === 'loadouts') {
    const starred = game.sections.flatMap((s) => s.groups).filter((g) => gp.starred[g.key]).map((g) => g.title);
    if (starred.length) return ['Starred', starred.join(', ')];
    const classes = game.guides.filter((g) => layout.cards.includes(g.category)).length;
    return ['Classes', classes ? `${classes} ready to copy` : `${game.guides.length} guides`];
  }
  const n = nextItems(game, gp, 1)[0];
  return ['Next', n ? n.item.title : game.items.length ? 'All done' : 'Nothing to track yet'];
}

function cardHTML(g) {
  const { meta } = g;
  const gp = store.game(meta.id);
  const status = effectiveStatus(meta.status, gp);
  const entry = data.peekEntry(meta.id) || g.entry || null;
  let pct = 0;
  let line = ['Next', 'Loading…'];
  let count = '';
  let showBar = true;
  if (entry?.error) line = ['Next', "Couldn't load this game's file."];
  else if (entry?.game) {
    const game = entry.game;
    const t = tally(gp, game.items);
    pct = t.pct;
    count = t.total ? `${t.done}/${t.total}` : '';
    showBar = game.layout.type !== 'loadouts' && t.total > 0;
    line = nextLine(game, gp);
  }
  return `<a class="game-card${entry?.error ? ' has-error' : ''}" href="#/game/${enc(meta.id)}" data-game="${esc(
    meta.id
  )}" style="${accentStyle(meta.accent)}">
    <div class="card-top">
      <div class="card-titles">
        <h3 class="card-title">${esc(meta.title)}</h3>
        ${meta.platform ? `<div class="card-platform">${esc(meta.platform)}</div>` : ''}
      </div>
      ${statusChip(status)}
    </div>
    <div class="card-next"><span class="card-next-label">${esc(line[0])}</span><span class="card-next-text">${esc(line[1])}</span></div>
    ${showBar ? `<div class="progress-row card-progress"><div class="bar"><span style="width:${pct}%"></span></div><span class="pct">${pct}%</span></div>` : ''}
    <div class="card-foot"><span>${gp.lastPlayed ? `Played ${relTime(gp.lastPlayed)}` : 'Not played yet'}</span><span class="card-count">${count}</span></div>
  </a>`;
}

export async function render(ctx) {
  let index;
  try {
    index = await data.getIndex();
  } catch (err) {
    ctx.mount(`${topBar({ title: 'Game Tracker' })}<main class="page">${errorBox(
      "Couldn't load your game list",
      err.message
    )}</main>`);
    return;
  }
  if (!ctx.isCurrent()) return;
  document.title = 'Game Tracker';

  const games = index.games.map((meta) => {
    const gp = store.game(meta.id);
    return { meta, status: effectiveStatus(meta.status, gp), last: gp.lastPlayed || 0 };
  });
  games.sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.last - a.last || a.meta.order - b.meta.order
  );

  let html = '';
  if (!games.length) {
    html = emptyBox('<p class="empty-title">No games yet</p><p>Add a game to <code>games/index.json</code>.</p>');
  } else {
    for (const st of STATUS_ORDER) {
      const group = games.filter((g) => g.status === st);
      if (!group.length) continue;
      html += `<section class="home-group"><h2 class="label home-label">${STATUS_LABEL[st]}<span class="count">${
        group.length
      }</span></h2><div class="cards">${group.map(cardHTML).join('')}</div></section>`;
    }
  }
  const problems = index.errors.length
    ? `<div class="notice">games/index.json has problems. See Settings → Game files.</div>`
    : '';
  ctx.mount(`${topBar({ title: 'Game Tracker' })}<main class="page page-home">${
    index.offline ? '<div class="notice">You\'re offline. Showing the last saved game list.</div>' : ''
  }${problems}${html}</main>`);

  // Fill in progress as each game file arrives.
  for (const g of games) {
    if (data.peekEntry(g.meta.id)) continue;
    data.getGame(g.meta.id).then((entry) => {
      if (!ctx.isCurrent()) return;
      const card = ctx.root.querySelector(`.game-card[data-game="${cssEscape(g.meta.id)}"]`);
      if (card) card.outerHTML = cardHTML({ ...g, entry });
    });
  }
}
