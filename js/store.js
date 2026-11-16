// Progress storage: ticks, counters, pins, walkthrough steps, notes, status
// override and "last played", per game. Kept separate from content: saved
// under one localStorage key as versioned JSON, keyed by game id + item id
// (+ guide id + step id). Every storage access is wrapped in try/catch; if
// storage is blocked the app still works in memory for this visit.
//
// Saved shape (schema 1):
// { "schema": 1, "savedAt": 1731650000000, "games": { "<gameId>": {
//     "checked": { "<itemId>": <time ticked> },
//     "counts":  { "<itemId>": 37 },
//     "pinned":  { "<itemId>": <time pinned> },
//     "steps":   { "<guideId>": { "<stepId>": <time ticked> } },
//     "note": "where I left off", "noteAt": <time>,
//     "lastPlayed": <time>, "status": "paused" | null,
//     "starred": { "<sectionId>/<groupId>": <time starred> },   (optional, added later)
//     "lastSection": "<sectionId>" | null, "lastGuide": "<guideId>" | null } } }
// The last three are optional additions: older saves without them load fine,
// so the schema number stays 1.
import { normStatus } from './content.js';

export const STORAGE_KEY = 'gameTracker.progress';
const META_KEY = 'gameTracker.meta';
export const SCHEMA = 1;
export const APP_ID = 'game-tracker';

const EMPTY_GAME = Object.freeze({
  checked: Object.freeze({}),
  counts: Object.freeze({}),
  pinned: Object.freeze({}),
  steps: Object.freeze({}),
  note: '',
  noteAt: null,
  lastPlayed: null,
  status: null,
  starred: Object.freeze({}),
  lastSection: null,
  lastGuide: null,
});

let state = emptyState();
let available = true;
let problem = null;
const listeners = new Set();

function emptyState() {
  return { schema: SCHEMA, games: {} };
}

function emptyGame() {
  return {
    checked: {},
    counts: {},
    pinned: {},
    steps: {},
    note: '',
    noteAt: null,
    lastPlayed: null,
    status: null,
    starred: {},
    lastSection: null,
    lastGuide: null,
  };
}

const shortId = (v) => (typeof v === 'string' && v.trim() ? v.slice(0, 300) : null);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const stamp = (v) => time(v) || 1;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readKey(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    available = false;
    return null;
  }
}

function writeKey(key, value) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function cleanGame(raw) {
  const g = emptyGame();
  if (!isObj(raw)) return g;
  if (isObj(raw.checked)) for (const [k, v] of Object.entries(raw.checked)) if (v) g.checked[k] = stamp(v);
  if (isObj(raw.counts)) {
    for (const [k, v] of Object.entries(raw.counts)) {
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) g.counts[k] = n;
    }
  }
  if (isObj(raw.pinned)) for (const [k, v] of Object.entries(raw.pinned)) if (v) g.pinned[k] = stamp(v);
  if (isObj(raw.steps)) {
    for (const [guideId, steps] of Object.entries(raw.steps)) {
      if (!isObj(steps)) continue;
      const m = {};
      for (const [k, v] of Object.entries(steps)) if (v) m[k] = stamp(v);
      if (Object.keys(m).length) g.steps[guideId] = m;
    }
  }
  if (typeof raw.note === 'string') g.note = raw.note.slice(0, 20000);
  g.noteAt = time(raw.noteAt);
  g.lastPlayed = time(raw.lastPlayed);
  g.status = normStatus(raw.status);
  if (isObj(raw.starred)) for (const [k, v] of Object.entries(raw.starred)) if (v) g.starred[k] = stamp(v);
  g.lastSection = shortId(raw.lastSection);
  g.lastGuide = shortId(raw.lastGuide);
  return g;
}

function cleanState(raw) {
  const s = emptyState();
  if (!isObj(raw)) return s;
  // Future schema migrations go here (if raw.schema < SCHEMA ...).
  if (isObj(raw.games)) for (const [id, g] of Object.entries(raw.games)) s.games[id] = cleanGame(g);
  return s;
}

function emit(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch (err) {
      console.error(err);
    }
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function load() {
  problem = null;
  const s = storage();
  if (!s) available = false;
  else {
    try {
      s.setItem('gameTracker.test', '1');
      s.removeItem('gameTracker.test');
      available = true;
    } catch {
      available = false;
    }
  }
  const raw = readKey(STORAGE_KEY);
  if (raw == null) {
    state = emptyState();
    return;
  }
  try {
    state = cleanState(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy so nothing is lost, then start fresh.
    writeKey(`${STORAGE_KEY}.unreadable.${Date.now()}`, raw);
    state = emptyState();
    problem = 'Saved progress on this device could not be read, so the app started fresh. A copy of the old data was kept in browser storage.';
  }
}

function save() {
  state.savedAt = Date.now();
  const ok = writeKey(STORAGE_KEY, JSON.stringify(state));
  if (!ok) emit({ type: 'save-failed' });
  return ok;
}

function commit(gameId) {
  save();
  emit({ type: 'change', gameId });
}

export const isAvailable = () => available;
export const loadProblem = () => problem;

/** Read-only progress for one game (an empty frozen object if nothing saved). */
export function game(gameId) {
  return state.games[gameId] || EMPTY_GAME;
}

export function savedGameIds() {
  return Object.keys(state.games);
}

function mut(gameId) {
  if (!state.games[gameId]) state.games[gameId] = emptyGame();
  return state.games[gameId];
}

export function setChecked(gameId, itemId, on) {
  const g = mut(gameId);
  if (on) g.checked[itemId] = Date.now();
  else delete g.checked[itemId];
  g.lastPlayed = Date.now();
  commit(gameId);
}

export function setCount(gameId, itemId, value, max) {
  const g = mut(gameId);
  const cap = Number.isFinite(max) ? max : Infinity;
  const n = Math.max(0, Math.min(cap, Math.floor(Number(value) || 0)));
  if (n > 0) g.counts[itemId] = n;
  else delete g.counts[itemId];
  g.lastPlayed = Date.now();
  commit(gameId);
  return n;
}

export function setPinned(gameId, itemId, on) {
  const g = mut(gameId);
  if (on) g.pinned[itemId] = Date.now();
  else delete g.pinned[itemId];
  commit(gameId);
}

export function setStep(gameId, guideId, stepId, on) {
  const g = mut(gameId);
  const m = g.steps[guideId] || (g.steps[guideId] = {});
  if (on) m[stepId] = Date.now();
  else delete m[stepId];
  if (!Object.keys(m).length) delete g.steps[guideId];
  g.lastPlayed = Date.now();
  commit(gameId);
}

export function clearSteps(gameId, guideId) {
  const g = mut(gameId);
  delete g.steps[guideId];
  commit(gameId);
}

export function setNote(gameId, note) {
  const g = mut(gameId);
  if (g.note === note) return;
  g.note = String(note).slice(0, 20000);
  g.noteAt = Date.now();
  g.lastPlayed = Date.now();
  commit(gameId);
}

/** status: one of the status values, or null to follow games/index.json. */
export function setStatus(gameId, status) {
  const g = mut(gameId);
  g.status = status ? normStatus(status) : null;
  commit(gameId);
}

/** Star a checklist group (e.g. a gun you use) so it is listed first. key = "<sectionId>/<groupId>". */
export function setStarred(gameId, key, on) {
  const g = mut(gameId);
  if (on) g.starred[key] = Date.now();
  else delete g.starred[key];
  commit(gameId);
}

/** Remember where the player was (last map/section opened, last guide followed). */
export function setPlace(gameId, { section, guide } = {}) {
  const cur = game(gameId);
  const nextSection = section === undefined ? cur.lastSection : shortId(section);
  const nextGuide = guide === undefined ? cur.lastGuide : shortId(guide);
  if (nextSection === cur.lastSection && nextGuide === cur.lastGuide) return;
  const g = mut(gameId);
  g.lastSection = nextSection;
  g.lastGuide = nextGuide;
  commit(gameId);
}

export function resetGame(gameId) {
  delete state.games[gameId];
  commit(gameId);
}

// Backup ---------------------------------------------------------------------

export function exportData() {
  return {
    app: APP_ID,
    kind: 'progress-backup',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    games: state.games,
  };
}

/** Check a parsed backup file. → { ok, state, count, exportedAt } or { ok: false, error } */
export function parseBackup(obj) {
  if (!isObj(obj)) return { ok: false, error: "This file isn't a Game Tracker backup." };
  if (obj.app && obj.app !== APP_ID) return { ok: false, error: 'This file is from a different app.' };
  if (!isObj(obj.games)) return { ok: false, error: "This file doesn't contain any game progress." };
  const clean = cleanState(obj);
  return {
    ok: true,
    state: clean,
    count: Object.keys(clean.games).length,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
  };
}

export function replaceAll(cleanedState) {
  state = cleanedState;
  save();
  emit({ type: 'import' });
}

// Small app metadata (not part of backups) ----------------------------------

export function getMeta() {
  try {
    const m = JSON.parse(readKey(META_KEY) || '{}');
    return isObj(m) ? m : {};
  } catch {
    return {};
  }
}

export function setMeta(patch) {
  writeKey(META_KEY, JSON.stringify({ ...getMeta(), ...patch }));
}

// Another tab changed the saved progress: reload it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      load();
      emit({ type: 'external' });
    }
  });
}
