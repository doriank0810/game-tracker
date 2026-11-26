// Home: your games as box art. The one you played last is a wide banner on
// top with what to do next; the others sit on a shelf, grouped by status.
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, relTime, accentStyle, cssEscape } from '../util.js';
import { STATUS_ORDER, STATUS_LABEL } from '../content.js';
import { tally, nextItems, effectiveStatus, whereToContinue } from '../progress.js';
import { navBar, iconLink, largeTitle, errorBox, emptyBox, artImg } from '../ui.js';
import { icons } from '../icons.js';
import { markRoot } from '../router.js';

/** [label, text] for "what's next", per layout. */
function nextLine(game, gp) {
  const { layout } = game;
  if (layout.type === 'maps') {
    const c = whereToContinue(game, gp);
    if (c?.guide) return ['Continue', `${c.section ? `${c.section.title} › ` : ''}${c.guide.title}`];
    if (c?.section) return ['Continue', c.section.title];
    return ['Start', `Pick one of ${game.sections.length} ${layout.picker.toLowerCase()}`];
  }
  if (layout.type === 'loadouts') {
    const starred = game.sections.flatMap((s) => s.groups).filter((g) => gp.starred[g.key]);
    if (starred.length) return ['Starred', starred.map((g) => g.title.replace(/\s*\([^)]*\)\s*$/, '')).join(', ')];
    const classes = game.guides.filter((g) => layout.cards.includes(g.category)).length;
    return ['Classes', classes ? `${classes} ready to copy` : `${game.guides.length} guides`];
  }
  const n = nextItems(game, gp, 1)[0];
  return ['Next', n ? n.item.title : game.items.length ? 'All done' : 'Nothing to track yet'];
}

/** Box art in a fixed frame. wide: prefer the banner art; else the cover. */
function artHTML(meta, wide) {
  const main = wide ? meta.hero || meta.cover : meta.cover || meta.hero;
  if (!main) return `<div class="art no-art"><span class="art-name">${esc(meta.title)}</span></div>`;
  // Art of the other shape is shown whole over a blurred copy of itself.
  const fits = wide ? !!meta.hero : !!meta.cover;
  return `<div class="art${fits ? '' : ' is-contain'}">${fits ? '' : artImg(main, 'art-blur')}${artImg(main, 'art-img', { eager: true })}<span class="art-name">${esc(
    meta.title
  )}</span></div>`;
}

function played(gp) {
  return gp.lastPlayed ? `Played ${relTime(gp.lastPlayed)}` : 'Not played yet';
}

function featuredHTML(g) {
  const { meta } = g;
  const gp = store.game(meta.id);
  const entry = data.peekEntry(meta.id) || g.entry || null;
  let line = null;
  let pct = 0;
  let bar = false;
  if (entry?.error) line = ['', "Couldn't load this game's file"];
  else if (entry?.game) {
    line = nextLine(entry.game, gp);
    const t = tally(gp, entry.game.items);
    pct = t.pct;
    bar = t.total > 0 && t.done > 0;
  }
  // The banner art fills the card; the box art (if any) sits in front of it,
  // so the game reads at a glance even when the banner's subject is cropped.
  const backdrop = meta.hero
    ? `<div class="art">${artImg(meta.hero, 'art-img', { eager: true })}</div>`
    : meta.cover
      ? `<div class="art is-backdrop">${artImg(meta.cover, 'art-blur', { eager: true })}</div>`
      : '<div class="art no-art"></div>';
  return `<a class="feat${entry?.error ? ' has-error' : ''}${meta.cover ? ' has-cover' : ''}" href="#/game/${enc(meta.id)}" data-game="${esc(meta.id)}" style="${accentStyle(meta.accent)}">
    ${backdrop}
    <div class="feat-body">
      ${meta.cover ? `<span class="feat-cover">${artImg(meta.cover, 'art-img', { eager: true })}</span>` : ''}
      <div class="feat-text">
        <h2 class="feat-title${meta.title.length > 22 ? ' is-long' : ''}">${esc(meta.title)}</h2>
        <p class="feat-next">${line ? `${line[0] ? `<span class="feat-k">${esc(line[0])}</span>` : ''}<span class="feat-v">${esc(line[1])}</span>` : '&nbsp;'}</p>
        <div class="feat-meta">${esc([meta.platform, played(gp)].filter(Boolean).join(' · '))}</div>
      </div>
    </div>
    ${bar ? `<span class="feat-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}
  </a>`;
}

function shelfHTML(g) {
  const { meta } = g;
  const gp = store.game(meta.id);
  const entry = data.peekEntry(meta.id) || g.entry || null;
  let pct = 0;
  if (entry?.game) pct = tally(gp, entry.game.items).pct;
  return `<a class="shelf-item${entry?.error ? ' has-error' : ''}" href="#/game/${enc(meta.id)}" data-game="${esc(meta.id)}" style="${accentStyle(meta.accent)}">
    <div class="shelf-art">${artHTML(meta, false)}${pct ? `<span class="shelf-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ''}</div>
    <span class="shelf-title">${esc(meta.title)}</span>
    <span class="shelf-sub">${entry?.error ? "Couldn't load" : esc(pct ? `${pct}% · ${played(gp).replace('Played ', '')}` : played(gp))}</span>
  </a>`;
}

export async function render(ctx) {
  const nav = navBar({ title: 'Games', actions: `${iconLink('#/search', icons.search, 'Search all games')}${iconLink('#/settings', icons.settings, 'Settings')}` });
  let index;
  try {
    index = await data.getIndex();
  } catch (err) {
    ctx.mount(`${nav}<main class="page page-home">${largeTitle('Games')}${errorBox("Couldn't load your game list", err.message)}</main>`);
    return;
  }
  if (!ctx.isCurrent()) return;

  const games = index.games.map((meta) => {
    const gp = store.game(meta.id);
    return { meta, status: effectiveStatus(meta.status, gp), last: gp.lastPlayed || 0 };
  });
  games.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.last - a.last || a.meta.order - b.meta.order);

  let html = '';
  if (!games.length) {
    html = emptyBox('<p class="empty-title">No games yet</p><p>Add a game to <code>games/index.json</code></p>');
  } else {
    // The game played last (or the first one you're playing) gets the banner.
    const featured = games.find((g) => g.status === 'playing') || games[0];
    html += featuredHTML(featured);
    const rest = games.filter((g) => g !== featured);
    for (const st of STATUS_ORDER) {
      const group = rest.filter((g) => g.status === st);
      if (!group.length) continue;
      html += `<section class="shelf"><div class="sec-h"><h2>${STATUS_LABEL[st]}</h2></div><div class="shelf-grid">${group.map(shelfHTML).join('')}</div></section>`;
    }
  }
  const problems = index.errors.length ? `<div class="notice">games/index.json has problems. See Settings, Game files</div>` : '';
  ctx.mount(`${nav}<main class="page page-home">${largeTitle('Games')}${
    index.offline ? '<div class="notice">You\'re offline. Showing the last saved game list</div>' : ''
  }${problems}${html}</main>`);
  document.title = 'Game Tracker';
  markRoot('home');

  // Fill in what's next and progress as each game file arrives.
  for (const g of games) {
    if (data.peekEntry(g.meta.id)) continue;
    data.getGame(g.meta.id).then((entry) => {
      if (!ctx.isCurrent()) return;
      const el = ctx.root.querySelector(`[data-game="${cssEscape(g.meta.id)}"]`);
      if (!el) return;
      // Patch the text and bar only, so the artwork doesn't flash.
      const tpl = document.createElement('div');
      tpl.innerHTML = el.classList.contains('feat') ? featuredHTML({ ...g, entry }) : shelfHTML({ ...g, entry });
      const fresh = tpl.firstElementChild;
      for (const sel of ['.feat-text', '.shelf-sub']) {
        const a = el.querySelector(sel);
        const b = fresh.querySelector(sel);
        if (a && b) a.replaceWith(b);
      }
      el.querySelector('.feat-bar, .shelf-bar')?.remove();
      const bar = fresh.querySelector('.feat-bar, .shelf-bar');
      if (bar) (el.querySelector('.shelf-art') || el).appendChild(bar);
      el.classList.toggle('has-error', fresh.classList.contains('has-error'));
    });
  }
}
