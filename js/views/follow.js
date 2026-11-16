// Follow mode: one walkthrough step per screen, made to be glanced at next to
// the console. Reads top to bottom: where, the clip, a short text, Done.
// Resumes at the first unticked step and keeps the screen awake while open.
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, enc, plural } from '../util.js';
import { guideTally, stepDone, firstOpenStep, nextGuideIn, isWalk } from '../progress.js';
import { errorBox, emptyBox, md, followHref, setStepDone, lightboxOpen, openSheet, closeSheet, sheetOpen } from '../ui.js';
import { stepImageHTML, whereChip, optionsHTML, stepClipHTML, guideBack } from './guide.js';
import { warmUp, prefetchPoster } from '../clip.js';
import { icons } from '../icons.js';
import { replaceQuiet, goBack, navigate } from '../router.js';

const prefetched = new Set();

function keepAwake() {
  let lock = null;
  let closed = false;
  const request = async () => {
    if (closed || lock || document.visibilityState !== 'visible') return;
    try {
      if (!('wakeLock' in navigator)) return;
      const l = await navigator.wakeLock.request('screen');
      if (closed) {
        l.release().catch(() => {});
        return;
      }
      lock = l;
      lock.addEventListener?.('release', () => {
        lock = null;
      });
    } catch {
      /* not allowed or not supported: fine */
    }
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') request();
  };
  document.addEventListener('visibilitychange', onVis);
  request();
  return () => {
    closed = true;
    document.removeEventListener('visibilitychange', onVis);
    lock?.release().catch(() => {});
    lock = null;
  };
}

export async function render(ctx) {
  const { gameId, guideId, stepId } = ctx.route;
  const entry = await data.getGame(gameId);
  if (!ctx.isCurrent()) return null;
  const closeBtn = (fallback, label = 'Close') =>
    `<button type="button" class="icon-btn" data-nav="back" data-fallback="${esc(fallback)}" aria-label="${label}">${icons.close}</button>`;
  const gameHref = `#/game/${enc(gameId)}`;
  if (entry.error) {
    ctx.mount(`<div class="follow"><header class="follow-top">${closeBtn(gameHref)}</header><main class="page">${errorBox(
      "Couldn't open this game",
      entry.error
    )}</main></div>`);
    return null;
  }
  const { game } = entry;
  const guide = game.guideById.get(guideId);
  if (!guide || !isWalk(guide)) {
    ctx.mount(
      `<div class="follow"><header class="follow-top">${closeBtn(gameHref)}</header><main class="page">${emptyBox(
        '<p class="empty-title">Nothing to follow</p><p>This guide has no steps.</p>'
      )}</main></div>`,
      { accent: game.accent }
    );
    return null;
  }

  const steps = guide.steps;
  const backHref = guideBack(game, guide);
  const section = guide.sectionId ? game.sections.find((s) => s.id === guide.sectionId) : null;
  const siblings = section ? section.guides : game.guides.filter((g) => g.category === guide.category);
  const gp0 = store.game(game.id);
  let index = stepId && guide.stepById.has(stepId) ? guide.stepById.get(stepId).index : firstOpenStep(gp0, guide);
  if (index < 0) index = 0;
  store.setPlace(game.id, { guide: guide.id, ...(section ? { section: section.id } : {}) });
  if (steps.some((s) => s.clip)) warmUp();

  const segmented = steps.length <= 24;
  ctx.mount(
    `<div class="follow">
      <header class="follow-top">
        ${closeBtn(backHref, 'Close follow mode')}
        <div class="follow-head">
          <div class="follow-guide">${esc(guide.title)}</div>
          <div class="follow-step-n" aria-live="polite"></div>
        </div>
        <button type="button" class="icon-btn" data-act="steps" aria-label="All steps" aria-haspopup="dialog">${icons.list}</button>
      </header>
      <div class="follow-bar${segmented ? ' is-seg' : ''}" aria-hidden="true">${
        segmented ? steps.map(() => '<span></span>').join('') : '<span class="fill"></span>'
      }</div>
      <main class="follow-main"></main>
      <footer class="follow-actions">
        <button type="button" class="btn big follow-prev" data-act="prev" aria-label="Previous step">${icons.prev}<span>Back</span></button>
        <button type="button" class="btn big primary follow-done" data-act="done"></button>
      </footer>
    </div>`,
    { accent: game.accent }
  );
  document.title = `${guide.title} · Follow`;
  const root = ctx.root.querySelector('.follow');
  const mainEl = root.querySelector('.follow-main');
  const stepN = root.querySelector('.follow-step-n');
  const barEl = root.querySelector('.follow-bar');
  const prevBtn = root.querySelector('.follow-prev');
  const doneBtn = root.querySelector('.follow-done');

  const drawBar = (gp) => {
    if (segmented) {
      [...barEl.children].forEach((seg, i) => {
        seg.className = `${stepDone(gp, guide, steps[i]) ? 'done' : ''}${i === index ? ' cur' : ''}`;
      });
    } else barEl.querySelector('.fill').style.width = `${guideTally(gp, guide).pct}%`;
  };

  let nextGuide = null;

  const draw = () => {
    const gp = store.game(game.id);
    const t = guideTally(gp, guide);
    drawBar(gp);
    prevBtn.disabled = index === 0;

    if (index >= steps.length) {
      stepN.textContent = 'Finished';
      const open = steps.filter((s) => !stepDone(gp, guide, s));
      nextGuide = nextGuideIn(gp, siblings, guide);
      mainEl.innerHTML = `<div class="follow-finish">
        <div class="finish-mark${open.length ? '' : ' all'}">${icons.check}</div>
        <h2 class="follow-title">${open.length ? 'End of the guide' : 'All steps done'}</h2>
        <p class="follow-sub">${t.done} of ${t.total} steps ticked.</p>
        ${
          nextGuide
            ? `<a class="finish-next" href="${followHref(game, nextGuide)}" data-replace><span class="label">Up next${
                section ? ` in ${esc(section.title)}` : ''
              }</span><span class="finish-next-title">${esc(nextGuide.title)}</span><span class="finish-next-meta">${plural(
                nextGuide.steps.length,
                'step'
              )}</span></a>`
            : ''
        }
        ${
          open.length
            ? `<div class="label finish-label">Not ticked yet</div><div class="link-list">${open
                .map(
                  (s) =>
                    `<button type="button" class="link-row" data-act="jump" data-i="${s.index}"><span class="link-main"><span class="link-title">Step ${
                      s.index + 1
                    }: ${esc(s.title)}</span></span>${icons.chevron}</button>`
                )
                .join('')}</div>`
            : ''
        }
        <p><a class="text-btn" href="${esc(backHref)}" data-nav="back" data-fallback="${esc(backHref)}">${icons.back}<span>Back to ${esc(
          section ? section.title : game.title
        )}</span></a></p>
      </div>`;
      doneBtn.dataset.act = nextGuide ? 'next-guide' : 'finish';
      doneBtn.innerHTML = nextGuide ? `<span>Next guide</span>${icons.next}` : `<span>Close</span>`;
      return;
    }

    const step = steps[index];
    const done = stepDone(gp, guide, step);
    stepN.textContent = `Step ${index + 1} of ${steps.length}`;
    const clip = step.clip || step.video ? stepClipHTML(step, { big: true }) : '';
    const img = stepImageHTML(data.mediaUrl(step.image), step.alt || step.title, { lazy: false });
    mainEl.innerHTML = `<article class="follow-step${done ? ' is-done' : ''}">
      ${whereChip(step.where, true)}
      <h2 class="follow-title">${esc(step.title)}</h2>
      ${clip}
      ${clip ? '' : img}
      ${step.text ? `<div class="md md-follow">${md(game, step.text)}</div>` : ''}
      ${clip ? img : ''}
      ${optionsHTML(game, step)}
      <div class="follow-tick-row">${
        done
          ? `<span class="done-badge">${icons.check}Done</span><button type="button" class="text-btn" data-act="untick">Untick</button>`
          : '<button type="button" class="text-btn" data-act="skip">Skip for now</button>'
      }</div>
    </article>`;
    const last = index === steps.length - 1;
    doneBtn.dataset.act = 'done';
    doneBtn.innerHTML = done
      ? `<span>${last ? 'Finish' : 'Next step'}</span>${icons.next}`
      : `${icons.check}<span>${last ? 'Done, finish' : 'Done, next'}</span>`;
    prefetchPoster(steps[index + 1]?.clip);
  };

  const go = (i) => {
    index = Math.max(0, Math.min(steps.length, i));
    const step = steps[Math.min(index, steps.length - 1)];
    replaceQuiet(followHref(game, guide, step));
    draw();
    window.scrollTo(0, 0);
  };

  draw();

  // Save every step picture for offline use (the service worker caches them).
  if (!prefetched.has(`${game.id}/${guide.id}`)) {
    prefetched.add(`${game.id}/${guide.id}`);
    for (const s of steps) {
      const src = data.mediaUrl(s.image);
      if (src) {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
      }
    }
  }

  const openSteps = () => {
    const gp = store.game(game.id);
    const body = openSheet({
      title: guide.title,
      html: `<ol class="step-list">${steps
        .map(
          (s, i) => `<li><button type="button" class="step-pick${i === index ? ' is-cur' : ''}${
            stepDone(gp, guide, s) ? ' is-done' : ''
          }" data-i="${i}"><span class="step-pick-n">${stepDone(gp, guide, s) ? icons.check : i + 1}</span><span class="step-pick-main"><span class="step-pick-title">${esc(
            s.title
          )}</span>${s.where ? `<span class="step-pick-where">${esc(s.where)}</span>` : ''}</span></button></li>`
        )
        .join('')}</ol>`,
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('.step-pick');
      if (!b) return;
      closeSheet();
      go(Number(b.dataset.i) || 0);
    });
    body.querySelector('.is-cur')?.scrollIntoView({ block: 'center' });
  };

  const act = (name, el) => {
    const step = steps[index];
    switch (name) {
      case 'done':
        if (!stepDone(store.game(game.id), guide, step)) setStepDone(game, guide, step, true);
        go(index + 1);
        break;
      case 'skip':
        go(index + 1);
        break;
      case 'prev':
        if (index > 0) go(index - 1);
        break;
      case 'untick':
        setStepDone(game, guide, step, false);
        draw();
        break;
      case 'jump':
        go(Number(el.dataset.i) || 0);
        break;
      case 'steps':
        openSteps();
        break;
      case 'next-guide':
        if (nextGuide) navigate(followHref(game, nextGuide), { replace: true });
        break;
      case 'finish':
        goBack(backHref);
        break;
      default:
    }
  };
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && root.contains(el)) act(el.dataset.act, el);
  });

  const onKey = (e) => {
    if (lightboxOpen() || sheetOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (e.key === 'ArrowRight') act('skip');
    else if (e.key === 'ArrowLeft') act('prev');
    else if (e.key === 'Escape') goBack(backHref);
    else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') act(index >= steps.length ? 'finish' : 'done');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  // Swipe left/right to move between steps (without ticking).
  let sx = 0;
  let sy = 0;
  let tracking = false;
  const onStart = (e) => {
    // Leave sideways-scrolling content (wide tables, code) and the clip alone.
    if (e.touches.length !== 1 || e.target.closest?.('.table-wrap, pre, .clip')) return;
    tracking = true;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  };
  const onEnd = (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) act(dx < 0 ? 'skip' : 'prev');
  };
  mainEl.addEventListener('touchstart', onStart, { passive: true });
  mainEl.addEventListener('touchend', onEnd, { passive: true });

  const release = keepAwake();
  return () => {
    release();
    document.removeEventListener('keydown', onKey);
  };
}
