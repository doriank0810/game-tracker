// Loads game content from games/*.json, always asking the network for the
// newest copy (the service worker falls back to a saved copy offline).
import { normalizeIndex, normalizeGame } from './content.js';
import { DEFAULT_ACCENT } from './util.js';

const GAMES_DIR = new URL('../games/', import.meta.url);
const INDEX_URL = new URL('index.json', GAMES_DIR);
const gameUrl = (id) => new URL(`${encodeURIComponent(id)}.json`, GAMES_DIR);

let index = null;
let indexLoading = null;
const entries = new Map(); // id → { id, game, errors, warnings, offline, text }
const loading = new Map();
const listeners = new Set();
let lastRefresh = Date.now();
let refreshing = null;

/**
 * Resolve an image path from the content (relative to games/) to a URL.
 * Absolute links must be https:// (anything else gives null).
 */
export function mediaUrl(path) {
  let p = String(path ?? '').trim();
  if (!p) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(p);
  if (scheme) return /^https$/i.test(scheme[1]) ? p : null;
  if (p.startsWith('//')) return null;
  p = p.replace(/^\.?\/+/, '').replace(/^games\//, '');
  try {
    return new URL(p, GAMES_DIR).href;
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  const name = decodeURIComponent(new URL(url).pathname.split('/').slice(-2).join('/'));
  if (!res.ok) {
    if (res.headers.get('X-GT-Source') === 'offline') {
      throw new Error(`Can't reach the server, and ${name} hasn't been saved for offline use yet.`);
    }
    throw new Error(res.status === 404 ? `${name} was not found.` : `${name}: the server answered ${res.status}.`);
  }
  return { text: await res.text(), offline: res.headers.get('X-GT-Source') === 'cache' };
}

function buildIndex({ text, offline }) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`games/index.json is not valid JSON (${err.message}).`);
  }
  const { games, errors, warnings } = normalizeIndex(raw);
  return { games, errors, warnings, offline, text, byId: new Map(games.map((g) => [g.id, g])) };
}

function applyMeta(game, meta) {
  game.title = meta?.title || game.title || game.id;
  game.platform = meta?.platform || '';
  game.accent = meta?.accent || DEFAULT_ACCENT;
  game.cover = meta?.cover || '';
  game.hero = meta?.hero || '';
  game.baseStatus = meta?.status || 'not-started';
  game.order = meta?.order ?? 9999;
  game.listed = !!meta;
}

function buildEntry(id, { text, offline }, meta) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { id, error: `games/${id}.json is not valid JSON (${err.message}).` };
  }
  const { game, errors, warnings } = normalizeGame(raw, id);
  applyMeta(game, meta);
  return { id, game, errors, warnings, offline, text };
}

export function onUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getIndex() {
  if (index) return Promise.resolve(index);
  if (!indexLoading) {
    indexLoading = fetchText(INDEX_URL)
      .then(buildIndex)
      .then((r) => (index = r))
      .finally(() => {
        indexLoading = null;
      });
  }
  return indexLoading;
}

/** Resolves to an entry; never rejects. A failed load is { id, error }. */
export function getGame(id) {
  if (entries.has(id)) return Promise.resolve(entries.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    const idx = await getIndex().catch(() => null);
    const meta = idx?.byId.get(id) || null;
    try {
      const entry = buildEntry(id, await fetchText(gameUrl(id)), meta);
      if (!entry.error) entries.set(id, entry);
      return entry;
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      return {
        id,
        error: offline ? "You're offline and this game hasn't been saved for offline use yet." : err.message,
      };
    } finally {
      loading.delete(id);
    }
  })();
  loading.set(id, p);
  return p;
}

export async function getAllGames() {
  const idx = await getIndex();
  return Promise.all(idx.games.map((g) => getGame(g.id)));
}

export const peekEntry = (id) => entries.get(id) || null;
export const peekGame = (id) => entries.get(id)?.game || null;
export const peekIndex = () => index;

/**
 * Re-download the index and every game loaded so far. Calls onUpdate
 * listeners with the changed ids. Throttled unless force is set.
 */
export function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  if (!force && Date.now() - lastRefresh < 30_000) return Promise.resolve({ changed: [] });
  lastRefresh = Date.now();
  refreshing = (async () => {
    const changed = [];
    if (index) {
      try {
        const res = await fetchText(INDEX_URL);
        if (res.text !== index.text) {
          index = buildIndex(res);
          changed.push('index');
        } else index.offline = res.offline;
      } catch {
        /* offline or broken file: keep what we have */
      }
    }
    await Promise.all(
      [...entries.keys()].map(async (id) => {
        try {
          const res = await fetchText(gameUrl(id));
          const old = entries.get(id);
          if (res.text !== old.text) {
            const next = buildEntry(id, res, index?.byId.get(id));
            if (!next.error) {
              entries.set(id, next);
              changed.push(id);
            }
          } else {
            old.offline = res.offline;
            if (changed.includes('index')) applyMeta(old.game, index?.byId.get(id));
          }
        } catch {
          /* keep the copy we have */
        }
      })
    );
    if (changed.length) for (const fn of listeners) fn(changed);
    return { changed };
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
