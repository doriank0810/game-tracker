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
  offlineNote,
  whereHTML,
  md,
  followHref,
  followLabel,
  setStepDone,
} from '../ui.js';
import { icons } from '../icons.js';
import { rerender } from '../router.js';

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
      ${step.text ? `<div class="md">${md(game, step.text)}</div>` : ''}
      ${stepImageHTML(data.mediaUrl(step.image), step.alt || step.title)}
      ${optionsHTML(game, step)}
      <div class="step-actions">
        ${videoButton(step)}
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
  const back = `#/game/${enc(gameId)}/guides`;
  if (entry.error) {
    ctx.mount(`${topBar({ title: 'Guide', back })}<main class="page">${errorBox("Couldn't open this game", entry.error)}</main>`);
    return;
  }
  const { game } = entry;
  const guide = game.guideById.get(guideId);
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
    body = `<div class="md md-guide">${guide.body ? md(game, guide.body) : '<p class="muted">This guide is empty.</p>'}</div>`;
  }
  ctx.mount(
    `${topBar({ title: game.title, back })}
    <main class="page page-guide">
      ${entry.offline ? offlineNote() : ''}
      <article class="guide">
        ${guide.category ? `<div class="label guide-cat">${esc(guide.category)}</div>` : ''}
        <h2 class="guide-title">${esc(guide.title)}</h2>
        ${body}
      </article>
      ${
        linked.length
          ? `<section class="block linked-block"><div class="block-head"><h3 class="label">In your checklist</h3><span class="count linked-count"></span></div>
          <div class="item-list">${linked.map((it) => itemRow(game, it, { meta: whereHTML(it), hideGuide: true })).join('')}</div></section>`
          : ''
      }
    </main>`,
    { accent: game.accent }
  );
  document.title = `${guide.title} · ${game.title}`;
  const main = ctx.root.querySelector('main');

  const countEl = main.querySelector('.linked-count');
  const updateCount = () => {
    if (!countEl) return;
    const t = tally(store.game(game.id), linked);
    countEl.textContent = `${t.done}/${t.total}`;
  };
  updateCount();
  bindItems(main, { onChange: updateCount });

  if (!walk) return null;
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
