// One guide: a readable reference page, or a walkthrough (list of tickable
// steps with a big "Follow" button).
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, cssEscape } from '../util.js';
import { tally, guideTally, stepDone } from '../progress.js';
import {
  topBar,
  itemRow,
  bindItems,
  updateRow,
  errorBox,
  emptyBox,
  gamePage,
  whereHTML,
  md,
  followHref,
  followLabel,
  setStepDone,
  sectionHref,
} from '../ui.js';
import { icons } from '../icons.js';
import { rerender } from '../router.js';
import { clipHTML, warmUp } from '../clip.js';

/** Where "back" goes from a guide: its map/section page, or the game page. */
export function guideBack(game, guide) {
  const sec = guide.sectionId && game.layout.type === 'maps' ? game.sections.find((s) => s.id === guide.sectionId) : null;
  return sec ? sectionHref(game, sec) : `#/game/${enc(game.id)}`;
}

/** The step's clip: in-app player for YouTube, a plain link for anything else. */
export function stepClipHTML(step, opts = {}) {
  if (step.clip) return clipHTML(step.clip, { title: step.title, ...opts });
  return videoButton(step);
}

export function stepImageHTML(src, alt, { lazy = true } = {}) {
  if (!src) return '';
  return `<figure class="step-figure"><img class="step-img" src="${esc(src)}" alt="${esc(alt)}"${
    lazy ? ' loading="lazy"' : ''
  } decoding="async" data-zoom></figure>`;
}

export function whereChip(where, big = false) {
  return where ? `<div class="where-chip${big ? ' big' : ''}">${icons.mapPin}<span>${esc(where)}</span></div>` : '';
}

export function optionsHTML(game, step) {
  if (!step.options.length) return '';
  return `<div class="options"><div class="label">Other spots</div><ul>${step.options
    .map((o) => `<li><div class="md">${md(game, o)}</div></li>`)
    .join('')}</ul></div>`;
}

export const videoButton = (step) =>
  step.video
    ? `<a class="btn clip-btn" href="${esc(step.video)}" target="_blank" rel="noopener noreferrer">${icons.video}<span>Open clip</span></a>`
    : '';

function stepCard(game, guide, step, gp) {
  const done = stepDone(gp, guide, step);
  return `<li class="step-card${done ? ' is-done' : ''}" data-step="${esc(step.id)}" id="step-${esc(step.id)}">
    <button type="button" class="check" data-act="step" role="checkbox" aria-checked="${done}" aria-label="Step ${
      step.index + 1
    }: ${esc(step.title)}"><span class="box">${icons.check}</span></button>
    <div class="step-body">
      <div class="step-num">Step ${step.index + 1}</div>
      <h3 class="step-title">${esc(step.title)}</h3>
      ${whereChip(step.where)}
      ${step.clip ? stepClipHTML(step) : ''}
      ${step.text ? `<div class="md">${md(game, step.text)}</div>` : ''}
      ${stepImageHTML(data.mediaUrl(step.image), step.alt || step.title)}
      ${optionsHTML(game, step)}
      <div class="step-actions">
        ${step.clip ? '' : videoButton(step)}
        <a class="text-btn" href="${followHref(game, guide, step)}">${icons.play}<span>Follow from here</span></a>
      </div>
    </div>
  </li>`;
}

function summaryHTML(game, guide) {
  const t = guideTally(store.game(game.id), guide);
  return `<div class="progress-row"><div class="bar"><span style="width:${t.pct}%"></span></div><span class="pct">${t.done}/${t.total}</span></div>
    <div class="walk-actions">
      <a class="btn primary big" href="${followHref(game, guide)}">${icons.play}<span>${esc(followLabel(game, guide))}</span></a>
      ${t.done ? '<button type="button" class="text-btn" data-act="restart">Start over</button>' : ''}
    </div>`;
}

export async function render(ctx) {
  const { gameId, guideId } = ctx.route;
  const entry = await data.getGame(gameId);
  if (!ctx.isCurrent()) return;
  let back = `#/game/${enc(gameId)}`;
  if (entry.error) {
    ctx.mount(`${topBar({ title: 'Guide', back })}<main class="page">${errorBox("Couldn't open this game", entry.error)}</main>`);
    return;
  }
  const { game } = entry;
  const guide = game.guideById.get(guideId);
  if (guide) back = guideBack(game, guide);
  if (!guide) {
    ctx.mount(
      `${topBar({ title: game.title, back })}<main class="page">${emptyBox(
        `<p class="empty-title">Guide not found</p><p>This guide isn't in the game file (any more).</p>`
      )}</main>`,
      { accent: game.accent }
    );
    return;
  }
  const gp = store.game(game.id);
  const linked = game.items.filter((it) => it.guide === guide.id);
  const walk = guide.kind === 'walkthrough';
  let body;
  if (walk) {
    body = `<div class="walk-summary">${summaryHTML(game, guide)}</div>
      ${guide.intro ? `<div class="md md-guide">${md(game, guide.intro)}</div>` : ''}
      ${guide.steps.length ? `<ol class="steps">${guide.steps.map((s) => stepCard(game, guide, s, gp)).join('')}</ol>` : emptyBox('This walkthrough has no steps yet.')}`;
  } else {
    const card = game.layout.type === 'loadouts' && game.layout.cards.includes(guide.category);
    body = `<div class="md md-guide${card ? ' md-class' : ''}">${
      guide.body ? md(game, guide.body, card ? { kvTables: true } : undefined) : '<p class="muted">This guide is empty.</p>'
    }</div>`;
  }
  const sec = guide.sectionId ? game.sections.find((s) => s.id === guide.sectionId) : null;
  const main = gamePage(ctx, entry, {
    title: sec && game.layout.type === 'maps' ? sec.title : game.title,
    sub: sec && game.layout.type === 'maps' ? game.title : '',
    back,
    cls: 'page-guide',
    body: `<article class="guide">
        ${guide.category && !(sec && game.layout.type === 'maps') ? `<div class="label guide-cat">${esc(guide.category)}</div>` : ''}
        <h2 class="guide-title">${esc(guide.title)}</h2>
        ${body}
      </article>
      ${
        linked.length
          ? `<section class="block linked-block"><div class="block-head"><h3 class="label">In your checklist</h3><span class="count linked-count"></span></div>
          <div class="item-list">${linked.map((it) => itemRow(game, it, { meta: whereHTML(it), hideGuide: true })).join('')}</div></section>`
          : ''
      }`,
  });
  if (!main) return null;
  document.title = `${guide.title} · ${game.title}`;

  const countEl = main.querySelector('.linked-count');
  const updateCount = () => {
    if (!countEl) return;
    const t = tally(store.game(game.id), linked);
    countEl.textContent = `${t.done}/${t.total}`;
  };
  updateCount();
  bindItems(main, { onChange: updateCount });

  if (!walk) return null;
  if (guide.steps.some((s) => s.clip)) warmUp();
  const summary = main.querySelector('.walk-summary');
  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'step') {
      const card = el.closest('.step-card');
      const step = guide.stepById.get(card.dataset.step);
      if (!step) return;
      const on = !stepDone(store.game(game.id), guide, step);
      const { ticked } = setStepDone(game, guide, step, on);
      card.classList.toggle('is-done', on);
      el.setAttribute('aria-checked', String(on));
      summary.innerHTML = summaryHTML(game, guide);
      for (const it of ticked) {
        const row = main.querySelector(`.item[data-id="${cssEscape(it.id)}"]`);
        if (row) updateRow(row, game, it);
      }
      updateCount();
    } else if (el.dataset.act === 'restart') {
      if (!confirm(`Untick all ${guide.steps.length} steps of “${guide.title}”?`)) return;
      store.clearSteps(game.id, guide.id);
      rerender();
    }
  });
  return null;
}
