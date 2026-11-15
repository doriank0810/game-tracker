// In-memory UI state for this visit (open groups, filters, search text...).
// Not saved: it only makes going back and forth between pages feel stable.

export const openItems = new Set();
const games = new Map();

export const okey = (gameId, itemId) => `${gameId}\u0000${itemId}`;

export function gameUI(gameId) {
  let s = games.get(gameId);
  if (!s) {
    s = {
      filter: 'all',
      query: '',
      resultLimit: 0,
      openGroups: new Set(),
      closedSections: new Set(),
      listInited: false,
      autoOpened: false,
      sessionDone: [],
      guideQuery: '',
    };
    games.set(gameId, s);
  }
  return s;
}

export function resetGameUI(gameId) {
  games.delete(gameId);
  for (const k of [...openItems]) if (k.startsWith(`${gameId}\u0000`)) openItems.delete(k);
}

export function resetAllUI() {
  games.clear();
  openItems.clear();
}
