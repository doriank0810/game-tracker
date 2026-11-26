// One guide, pushed from a tab: a readable reference page, a class card
// (loadouts: the weapon, tier and build as a spec sheet), or a walkthrough
// (tickable steps with a big "Follow" button).
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, cssEscape, plural } from '../util.js';
import { tally, guideTally, stepDone, isDone } from '../progress.js';
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
  head,
  buzz,
  pulse,
} from '../ui.js';
import { icons } from '../icons.js';
import { rerender } from '../router.js';
import { clipHTML, warmUp } from '../clip.js';
import { tabForGuide } from '../tabs.js';
import { parseClass, classImage, tierClass } from './hubs.js';
import { picHTML } from './ladder.js';
import { initials } from '../ladder.js';

/** Where "back" goes from a guide when there's no history: its map, or the game. */
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
  return `<figure class="step-figure"><img class="step-img" src="${esc(src)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" data-zoom></figure>`;
}

export function whereChip(where, big = false) {
  return where ? `<div class="where-chip${big ? ' big' : ''}">${icons.mapPin}<span>${esc(where)}</span></div>` : '';
}

export function optionsHTML(game, step) {
  if (!step.options.length) return '';
  return `<div class="options"><div class="options-k">Other spots</div><ul>${step.options.map((o) => `<li><div class="md">${md(game, o)}</div></li>`).join('')}</ul></div>`;
}

export const videoButton = (step) =>
  step.video
    ? `<a class="btn clip-link-btn" href="${esc(step.video)}" target="_blank" rel="noopener noreferrer">${icons.video}<span>Open clip</span></a>`
    : '';

function stepCard(game, guide, step, gp) {
  const done = stepDone(gp, guide, step);
  return `<li class="step-card${done ? ' is-done' : ''}" data-step="${esc(step.id)}" id="step-${esc(step.id)}">
    <button type="button" class="check" data-act="step" role="checkbox" aria-checked="${done}" aria-label="Step ${step.index + 1}: ${esc(
      step.title
    )}"><span class="box">${icons.check}</span></button>
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
  const gp = store.game(game.id);
  const t = guideTally(gp, guide);
  const cells =
    guide.steps.length <= 40
      ? `<span class="strip strip-lg"><span class="strip-part">${guide.steps.map((s) => `<i${stepDone(gp, guide, s) ? ' class="on"' : ''}></i>`).join('')}</span></span>`
      : `<span class="strip strip-bar strip-lg"><span style="width:${t.pct}%"></span></span>`;
  return `<div class="walk-progress"><span class="lad-n"><b>${t.done}</b> of ${plural(t.total, 'step')}</span>${cells}</div>
    <div class="walk-actions">
      <a class="btn primary big" href="${followHref(game, guide)}">${icons.play}<span>${esc(followLabel(game, guide))}</span></a>
      ${t.done ? '<button type="button" class="text-btn" data-act="restart">Start over</button>' : ''}
    </div>`;
}

function classHTML(game, guide) {
  const c = parseClass(guide);
  const img = classImage(game, guide);
  const gp = store.game(game.id);
  const linked = (guide.items || []).filter((it) => it.type === 'check');
  const built = linked.length > 0 && linked.every((it) => isDone(gp, it));
  return `<article class="class-detail">
    ${img ? `<div class="cd-stage">${picHTML(img, { cls: 'pic-wide', ph: initials(c.weapon || c.title), alt: c.weapon })}</div>` : ''}
    <div class="cd-head">
      ${c.tier ? `<span class="tier tier-lg tier-${tierClass(c.tier)}" aria-label="Tier ${esc(c.tier)}">${esc(c.tier)}</span>` : ''}
      <div class="cd-titles"><h1 class="cd-title" data-title-anchor>${esc(c.title)}</h1>${c.sub ? `<p class="cd-sub">${esc(c.sub)}</p>` : ''}</div>
    </div>
    ${
      linked.length
        ? `<button type="button" class="built-toggle${built ? ' is-built' : ''}" data-act="built" aria-pressed="${built}"><span class="box">${icons.check}</span><span class="built-label">${
            built ? 'Built in Create a Class' : 'Mark as built'
          }</span></button>`
        : ''
    }
    <div class="md md-class">${md(game, c.body, { kvTables: true })}</div>
  </article>`;
}

export async function render(ctx) {
  const { gameId, guideId } = ctx.route;
  const entry = await data.getGame(gameId);
  if (!ctx.isCurrent()) return null;
  if (entry.error) {
    ctx.mount(`${topBar({ title: 'Guide', back: `#/game/${enc(gameId)}`, backLabel: 'Game' })}<main class="page">${errorBox("Couldn't open this game", entry.error)}</main>`);
    return null;
  }
  const { game } = entry;
  const guide = game.guideById.get(guideId);
  if (!guide) {
    gamePage(ctx, entry, {
      title: game.title,
      body: emptyBox(`<p class="empty-title">Guide not found</p><p>This guide isn't in the game file any more</p>`),
    });
    return null;
  }
  const gp = store.game(game.id);
  const linked = game.items.filter((it) => it.guide === guide.id);
  const walk = guide.kind === 'walkthrough';
  const isClass = !walk && game.layout.type === 'loadouts' && game.layout.cards.includes(guide.category);
  const sec = guide.sectionId ? game.sections.find((s) => s.id === guide.sectionId) : null;
  const metaLine = [sec && game.layout.type === 'maps' ? sec.title : guide.category, walk ? `Walkthrough · ${plural(guide.steps.length, 'step')}` : '']
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  let body;
  if (isClass) body = classHTML(game, guide);
  else {
    body = `<article class="guide">
      <h1 class="guide-title" data-title-anchor>${esc(guide.title)}</h1>
      ${metaLine ? `<p class="guide-meta">${metaLine}</p>` : ''}
      ${
        walk
          ? `<div class="walk-summary">${summaryHTML(game, guide)}</div>
            ${guide.intro ? `<div class="md md-guide">${md(game, guide.intro)}</div>` : ''}
            ${guide.steps.length ? `<ol class="steps">${guide.steps.map((s) => stepCard(game, guide, s, gp)).join('')}</ol>` : emptyBox('This walkthrough has no steps yet')}`
          : `<div class="md md-guide">${guide.body ? md(game, guide.body) : '<p class="muted">This guide is empty</p>'}</div>`
      }
    </article>`;
  }
  const showLinked = linked.length && !isClass;
  const main = gamePage(ctx, entry, {
    title: isClass ? parseClass(guide).title : guide.title,
    tab: tabForGuide(game, guide),
    back: guideBack(game, guide),
    cls: 'page-guide',
    body: `${body}${
      showLinked
        ? `<section class="block linked-block">${head('In your checklist', '<span class="linked-count"></span>')}
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

  if (isClass) {
    main.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="built"]');
      if (!b) return;
      const items = (guide.items || []).filter((it) => it.type === 'check');
      const on = !items.every((it) => isDone(store.game(game.id), it));
      for (const it of items) store.setChecked(game.id, it.id, on);
      b.classList.toggle('is-built', on);
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.built-label').textContent = on ? 'Built in Create a Class' : 'Mark as built';
      if (on) {
        buzz();
        pulse(b.querySelector('.box'));
      }
    });
    return null;
  }

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
      if (on) pulse(el.querySelector('.box'));
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
