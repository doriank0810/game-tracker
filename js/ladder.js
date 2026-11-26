// Picture groups ("ladders"): a checklist group whose items have pictures,
// e.g. one weapon's camos. Pure functions, no DOM (usable in Node).
//
// How an item's `detail` is read (paragraphs are split on blank lines; the
// markdown itself is never rewritten):
//   "Reach weapon level 26."          a level step. Levels are cumulative:
//                                     ticking one also ticks the lower ones.
//   "**Multiplayer:** 20 kills …"     a challenge line. The first one is the
//   "**DMZ:** 75 kills …"             main line, the others are secondary.
//   "Opens at weapon level 25."       when the challenge becomes available.
//   "First unlock … / First get …"    a prerequisite (first paragraph): the
//                                     item is part of a chain unlocked in
//                                     order (Gold → Platinum → Harmonic Break).
// Everything else is "open": it can be worked on right away.
import { fold } from './util.js';
import { isDone } from './progress.js';

const LEVEL_RE = /^reach\s+(?:weapon\s+)?level\s+(\d+)\s*\.?$/i;
const OPENS_RE = /^opens\s+at\s+(?:weapon\s+)?level\s+(\d+)\s*\.?$/i;
const PREREQ_RE = /^first\b/i;
// "**Multiplayer:** text" or "**Multiplayer**: text"
const LABEL_RE = /^\*\*\s*([^*\n]+?)\s*(?::\s*\*\*|\*\*\s*:)\s*([\s\S]+)$/;

export const hasPictures = (group) => group.items.some((it) => it.image);

/** { level, levelText, opensAt, prereq, lines: [{ label, text }], rest: [markdown] } (cached). */
export function readItem(item) {
  if (item._lad) return item._lad;
  const out = { level: null, levelText: '', opensAt: null, prereq: '', lines: [], rest: [] };
  for (const para of item.detail.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const p = para.trim();
    if (!p) continue;
    let m;
    if (out.level == null && (m = LEVEL_RE.exec(p))) {
      out.level = Number(m[1]);
      out.levelText = p;
    } else if (out.opensAt == null && (m = OPENS_RE.exec(p))) out.opensAt = Number(m[1]);
    else if (!out.prereq && !out.lines.length && !out.rest.length && PREREQ_RE.test(p)) out.prereq = p;
    else if ((m = LABEL_RE.exec(p))) out.lines.push({ label: m[1].trim(), text: m[2].trim() });
    else out.rest.push(p);
  }
  item._lad = out;
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The group's structure (cached):
 *   levels  level steps, lowest level first
 *   chain   items with a prerequisite, in file order
 *   open    everything else
 *   parts   grid sections by first tag, in order of appearance: [{ title, items }]
 *   isLadder  true when there are levels or a chain (then "Do now" makes sense)
 */
export function ladderOf(group) {
  if (group._lad) return group._lad;
  const levels = [];
  const chain = [];
  const open = [];
  for (const it of group.items) {
    const r = readItem(it);
    if (it.type !== 'check') open.push(it);
    else if (r.level != null) levels.push(it);
    else if (r.prereq) chain.push(it);
    else open.push(it);
  }
  levels.sort((a, b) => readItem(a).level - readItem(b).level || a.order - b.order);
  const parts = [];
  const byTag = new Map();
  for (const it of group.items) {
    const tag = it.tags[0] || '';
    const k = fold(tag);
    let p = byTag.get(k);
    if (!p) {
      p = { title: tag ? cap(tag) : 'Other', items: [] };
      byTag.set(k, p);
      parts.push(p);
    }
    p.items.push(it);
  }
  group._lad = { levels, chain, open, parts, isLadder: levels.length > 0 || chain.length > 0 };
  return group._lad;
}

/** "Special" and "1 of 3" for an item, from its grid section. */
export function placeOf(group, item) {
  const part = ladderOf(group).parts.find((p) => p.items.includes(item));
  if (!part) return { part: '', n: 0, of: 0 };
  return { part: part.title, n: part.items.indexOf(item) + 1, of: part.items.length };
}

/** What a chain item waits for: the open challenges (or the levels when there are none). */
const chainBase = (L) => (L.open.length ? L.open : L.levels);

/** True when a chain item's prerequisite (inside this group) isn't met yet. */
export function isLocked(group, item, gp) {
  const L = ladderOf(group);
  const k = L.chain.indexOf(item);
  if (k < 0) return false;
  if (k > 0) return !isDone(gp, L.chain[k - 1]);
  return !chainBase(L).every((it) => isDone(gp, it));
}

/** The level step to reach next (lowest unticked level), or null. */
export function nextLevel(group, gp) {
  return ladderOf(group).levels.find((it) => !isDone(gp, it)) || null;
}

/**
 * What to work on right now, in order: the next level, every unfinished
 * open challenge, then the next chain item (possibly still locked).
 * → [{ item, kind: 'level' | 'open' | 'chain', locked }]
 */
export function doNow(group, gp) {
  const L = ladderOf(group);
  const out = [];
  const lvl = nextLevel(group, gp);
  if (lvl) out.push({ item: lvl, kind: 'level', locked: false });
  for (const it of L.open) if (!isDone(gp, it)) out.push({ item: it, kind: 'open', locked: false });
  const c = L.chain.find((it) => !isDone(gp, it));
  if (c) out.push({ item: c, kind: 'chain', locked: isLocked(group, c, gp) });
  return out;
}

/**
 * Everything in the group that must already be done when `item` is done
 * (in file order). Ticking `item` ticks these too:
 *   - a level step: the lower level steps (levels add up)
 *   - a challenge that "Opens at weapon level N": the level steps up to N
 *   - a chain item (Gold, Platinum, Harmonic Break…): every level step and
 *     every open challenge of the group (e.g. 8 military + 3 special camos)
 *     and the chain items before it (Platinum also ticks Gold)
 */
export function prerequisites(group, item) {
  const L = ladderOf(group);
  const r = readItem(item);
  const need = new Set();
  if (L.chain.includes(item)) {
    for (const it of L.levels) need.add(it);
    for (const it of L.open) need.add(it);
    for (const it of L.chain) {
      if (it === item) break;
      need.add(it);
    }
  } else if (r.level != null && item.type === 'check') {
    for (const it of L.levels) if (it !== item && readItem(it).level <= r.level) need.add(it);
  } else if (r.opensAt != null) {
    for (const it of L.levels) if (readItem(it).level <= r.opensAt) need.add(it);
  }
  return group.items.filter((it) => need.has(it));
}

/** The prerequisites of `item` that aren't done yet (what ticking it adds). */
export function alsoTicks(group, item, gp) {
  return prerequisites(group, item).filter((it) => !isDone(gp, it));
}

/**
 * Short text for a set of items of one group: "8 military, 3 special and Gold".
 * Items are counted per grid section; one or two are named.
 */
export function describeItems(group, items) {
  const L = ladderOf(group);
  const phrases = [];
  for (const p of L.parts) {
    const mine = p.items.filter((it) => items.includes(it));
    if (!mine.length) continue;
    const named = mine.filter((it) => L.chain.includes(it) || mine.length <= 2);
    const counted = mine.filter((it) => !named.includes(it));
    if (counted.length) phrases.push(`${counted.length} ${p.title.toLowerCase()}`);
    for (const it of named) phrases.push(it.title);
  }
  if (phrases.length <= 1) return phrases.join('');
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/**
 * Progress towards a chain item's prerequisite → { done, of } or null.
 * First chain item: the open challenges of this group ("2/3 specials").
 * Later ones: when the line names a number ("First get Gold on 8 Assault
 * Rifles", "on all 33 weapons", "on both shotguns"), counts sibling groups of
 * the same class (or the whole section when the number is bigger) whose item
 * with the previous chain title (e.g. "Gold") is ticked.
 */
export function prereqTally(group, item, gp) {
  const L = ladderOf(group);
  const k = L.chain.indexOf(item);
  if (k < 0) return null;
  if (k === 0) {
    const base = chainBase(L);
    return base.length ? { done: base.filter((it) => isDone(gp, it)).length, of: base.length } : null;
  }
  const m = /\bon\s+(?:all\s+)?(\d+|both)\b/i.exec(readItem(item).prereq);
  if (!m) return null;
  const need = /both/i.test(m[1]) ? 2 : Number(m[1]);
  if (!need) return null;
  const prev = fold(L.chain[k - 1].title);
  const all = group.section.groups.filter((g) => g.items.length);
  const same = group.class ? all.filter((g) => fold(g.class) === fold(group.class)) : all;
  const pool = need > same.length ? all : same;
  let done = 0;
  for (const g of pool) {
    const it = g.items.find((x) => fold(x.title) === prev);
    if (it && isDone(gp, it)) done++;
  }
  return { done: Math.min(done, need), of: need };
}

/** "ISO Nightshade (SMG)" with class "SMG" → "ISO Nightshade". */
export function displayTitle(group) {
  if (!group.class) return group.title;
  const m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(group.title);
  return m && fold(m[2]).trim() === fold(group.class).trim() ? m[1] : group.title;
}

/** Two letters to show while a picture loads or when it's missing. */
export function initials(text) {
  const words = String(text).split(/[\s\-–.]+/).filter(Boolean);
  if (words.length < 2) return String(text).slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}
