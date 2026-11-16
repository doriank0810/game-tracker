// Progress maths. Pure functions: (normalized game content, saved progress
// for that game) → answers. Saved ids that no longer exist in the content
// are simply never looked up, so they are ignored.

export function countValue(gp, item) {
  const v = gp.counts?.[item.id];
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(item.target || 0, Math.floor(v)));
}

export function isDone(gp, item) {
  if (item.type === 'counter') return countValue(gp, item) >= item.target;
  return !!gp.checked?.[item.id];
}

/** { done, total, pct } for a list of items. pct only reaches 100 when all are done. */
export function tally(gp, items) {
  let done = 0;
  for (const it of items) if (isDone(gp, it)) done++;
  const total = items.length;
  return { done, total, pct: total ? Math.floor((done / total) * 100) : 0 };
}

/**
 * The "next session" list: pinned unfinished items first (in the order they
 * were pinned), then unfinished items sorted by priority (lower = sooner;
 * items without a priority come after those with one), then file order.
 */
export function nextItems(game, gp, max = 5) {
  const pinnedIds = Object.entries(gp.pinned || {})
    .filter(([id]) => game.byId.has(id))
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  const out = [];
  const taken = new Set();
  for (const id of pinnedIds) {
    const item = game.byId.get(id);
    if (isDone(gp, item)) continue;
    out.push({ item, pinned: true });
    taken.add(id);
  }
  if (out.length >= max) return out;
  const rest = game.items.filter((it) => !taken.has(it.id) && !isDone(gp, it));
  const pr = (it) => (it.priority == null ? Infinity : it.priority);
  rest.sort((a, b) => {
    const pa = pr(a);
    const pb = pr(b);
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.order - b.order;
  });
  for (const item of rest.slice(0, max - out.length)) out.push({ item, pinned: false });
  return out;
}

/** First unfinished item in file order ("where you are up to"). */
export function firstOpen(game, gp) {
  return game.items.find((it) => !isDone(gp, it)) || null;
}

export function effectiveStatus(baseStatus, gp) {
  return gp.status || baseStatus || 'not-started';
}

// Walkthrough steps --------------------------------------------------------

export function stepDone(gp, guide, step) {
  return !!gp.steps?.[guide.id]?.[step.id];
}

export function guideTally(gp, guide) {
  let done = 0;
  for (const s of guide.steps) if (stepDone(gp, guide, s)) done++;
  const total = guide.steps.length;
  return { done, total, pct: total ? Math.floor((done / total) * 100) : 0 };
}

/** Index of the first unticked step, or -1 when every step is ticked. */
export function firstOpenStep(gp, guide) {
  return guide.steps.findIndex((s) => !stepDone(gp, guide, s));
}

// Guides as things to do ------------------------------------------------------

export const isWalk = (guide) => guide.kind === 'walkthrough' && guide.steps.length > 0;

/**
 * 'done'    every step ticked
 * 'covered' not every step ticked, but every linked checklist item is
 * 'started' some steps ticked
 * 'new'     nothing yet ('page' for reference pages)
 */
export function guideState(gp, guide) {
  if (!isWalk(guide)) return 'page';
  const t = guideTally(gp, guide);
  if (t.done === t.total) return 'done';
  const linked = (guide.items || []).filter((it) => it.type === 'check');
  if (linked.length && linked.every((it) => isDone(gp, it))) return 'covered';
  return t.done ? 'started' : 'new';
}

const open = (gp, g) => {
  const s = guideState(gp, g);
  return s === 'started' || s === 'new';
};

/** First unfinished walkthrough in `list`, preferring ones after `after`. */
export function nextGuideIn(gp, list, after = null) {
  const walks = list.filter(isWalk);
  const i = after ? walks.indexOf(after) : -1;
  return walks.slice(i + 1).find((g) => open(gp, g)) || walks.slice(0, Math.max(0, i)).find((g) => open(gp, g)) || null;
}

/** The unfinished walkthrough with the most recently ticked step. */
export function recentGuide(game, gp) {
  let best = null;
  let bestAt = 0;
  for (const [gid, steps] of Object.entries(gp.steps || {})) {
    const g = game.guideById.get(gid);
    if (!g || !open(gp, g)) continue;
    for (const [sid, at] of Object.entries(steps)) {
      if (at > bestAt && g.stepById.has(sid)) {
        best = g;
        bestAt = at;
      }
    }
  }
  return best;
}

/**
 * Where to pick up in a "maps" game → { section, guide } (guide may be null:
 * "back to this map"), or null when there's nothing to continue.
 */
export function whereToContinue(game, gp) {
  const secById = (id) => game.sections.find((s) => s.id === id) || null;
  const last = gp.lastGuide ? game.guideById.get(gp.lastGuide) : null;
  if (last && open(gp, last)) return { section: secById(last.sectionId), guide: last };
  const recent = recentGuide(game, gp);
  const lastSec = secById(gp.lastSection) || (last && secById(last.sectionId));
  if (recent && (!lastSec || recent.sectionId === lastSec.id)) return { section: secById(recent.sectionId), guide: recent };
  if (lastSec) return { section: lastSec, guide: nextGuideIn(gp, lastSec.guides || [], last) };
  if (recent) return { section: secById(recent.sectionId), guide: recent };
  return null;
}
