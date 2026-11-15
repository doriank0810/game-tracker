// Small shared helpers. No DOM access here, so tools/validate.mjs can use
// the content modules in Node too.

export const DEFAULT_ACCENT = '#5ad1c0';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe use inside HTML text and attribute values. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

export const enc = (value) => encodeURIComponent(String(value));

/** Lowercase and strip accents, so "Gōenji" matches "goenji". */
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function searchTerms(query) {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** True when every search term appears in the (already folded) text. */
export function matchesAll(folded, terms) {
  for (const t of terms) if (!folded.includes(t)) return false;
  return true;
}

export function debounce(fn, ms) {
  let timer = null;
  const run = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  run.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return run;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`;
}

/** "just now", "12 min ago", "today", "yesterday", "3 days ago", "4 Nov". */
export function relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (ts >= today.getTime()) return 'today';
  const days = Math.ceil((today.getTime() - ts) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * CSS custom properties for a game's accent colour. Very dark accents are
 * lightened so they stay visible on the dark background.
 */
export function accentStyle(hex) {
  let rgb = parseHex(hex) || parseHex(DEFAULT_ACCENT);
  for (let i = 0; i < 12 && luminance(rgb) < 0.2; i++) {
    rgb = rgb.map((c) => Math.round(c + (255 - c) * 0.16));
  }
  const ink = luminance(rgb) > 0.36 ? '#0a0d13' : '#ffffff';
  const h = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return `--accent:${h};--accent-rgb:${rgb.join(',')};--accent-ink:${ink}`;
}

export function cssEscape(value) {
  if (globalThis.CSS && typeof CSS.escape === 'function') return CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
