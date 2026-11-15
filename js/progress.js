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
