// A small, safe Markdown renderer. All text is HTML-escaped first; only this
// subset becomes markup (documented in games/README.md):
//   # headings, **bold**, *italic*, ~~strike~~, `code`, ``` code blocks ```,
//   - and 1. lists (nest by indenting 2+ spaces), > quotes, --- rules,
//   | tables |, [links](https://...), bare https:// links,
//   [guide links](guide:guide-id), ![images](img/my-game/pic.png).
// A single line break inside a paragraph is kept as a line break.
//
// ctx (optional): { guideHref(id) → href|null, imageSrc(path) → url|null }
import { esc } from './util.js';

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const QUOTE_RE = /^\s{0,3}>/;
const URL_PART = '[^\\s()<>]+(?:\\([^\\s()<>]*\\)[^\\s()<>]*)*';
const TITLE_PART = '(?:\\s+(?:"[^"]*"|\'[^\']*\'))?';
const IMG_RE = new RegExp(`!\\[([^\\]\\n]*)\\]\\(\\s*<?(${URL_PART})>?${TITLE_PART}\\s*\\)`, 'g');
const LINK_RE = new RegExp(`\\[([^\\]\\n]+)\\]\\(\\s*<?(${URL_PART})>?${TITLE_PART}\\s*\\)`, 'g');
const AUTOLINK_RE = /\bhttps?:\/\/[^\s<>\u0001\u0002]*[^\s<>\u0001\u0002.,;:!?'")\]]/g;

const indentOf = (line) => line.match(/^ */)[0].length;
const isOrderedMarker = (marker) => /\d/.test(marker);

export function renderMarkdown(src, ctx = {}) {
  const lines = String(src ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');
  return renderBlocks(lines, ctx);
}

function isTableStart(lines, i) {
  const next = lines[i + 1];
  return (
    lines[i].includes('|') && next != null && next.includes('|') && next.includes('-') && TABLE_SEP_RE.test(next)
  );
}

function startsBlock(lines, i) {
  const line = lines[i];
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    isTableStart(lines, i) ||
    LIST_RE.test(line)
  );
}

function renderBlocks(lines, ctx) {
  let out = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m = FENCE_RE.exec(line);
    if (m) {
      const fence = m[1];
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    m = HEADING_RE.exec(line);
    if (m) {
      const level = Math.min(6, m[1].length + (ctx.headingShift ?? 1));
      out += `<h${level}>${renderInline(m[2], ctx)}</h${level}>`;
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      out += '<hr>';
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const buf = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      out += `<blockquote>${renderBlocks(buf, ctx)}</blockquote>`;
      continue;
    }
    if (isTableStart(lines, i)) {
      const r = renderTable(lines, i, ctx);
      out += r.html;
      i = r.next;
      continue;
    }
    if (LIST_RE.test(line)) {
      const r = renderList(lines, i, ctx);
      out += r.html;
      i = r.next;
      continue;
    }
    const buf = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) buf.push(lines[i++].trim());
    out += `<p>${buf.map((l) => renderInline(l, ctx)).join('<br>')}</p>`;
  }
  return out;
}

function dedent(lines) {
  const ind = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0));
}

function renderList(lines, start, ctx) {
  const first = LIST_RE.exec(lines[start]);
  const base = first[1].length;
  const ordered = isOrderedMarker(first[2]);
  const startNum = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let sawBlank = false;
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length) {
        i = j;
        break;
      }
      const ind = indentOf(lines[j]);
      const m = LIST_RE.exec(lines[j]);
      const sameLevelItem = m && ind >= base && ind - base < 2 && isOrderedMarker(m[2]) === ordered;
      if (ind - base >= 2 || sameLevelItem) {
        sawBlank = true;
        i = j;
        continue;
      }
      break;
    }
    const ind = indentOf(line);
    const m = LIST_RE.exec(line);
    if (ind < base) break;
    if (m && ind - base < 2) {
      if (isOrderedMarker(m[2]) !== ordered) break;
      items.push({ text: [m[3]], sub: [] });
      sawBlank = false;
      i++;
      continue;
    }
    if (ind - base >= 2) {
      const cur = items[items.length - 1];
      if (m || cur.sub.length || sawBlank) cur.sub.push(line);
      else cur.text.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const lis = items
    .map((it) => {
      const head = it.text.map((t) => renderInline(t, ctx)).join('<br>');
      const sub = it.sub.length ? renderBlocks(dedent(it.sub), ctx) : '';
      return `<li>${head}${sub}</li>`;
    })
    .join('');
  return { html: `<${tag}${startAttr}>${lis}</${tag}>`, next: i };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') {
      cur += '|';
      k++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function renderTable(lines, start, ctx) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((c) => {
    const l = c.startsWith(':');
    const r = c.endsWith(':');
    return l && r ? 'c' : r ? 'r' : '';
  });
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
  const cell = (tag, c, k) =>
    `<${tag}${aligns[k] ? ` class="al-${aligns[k]}"` : ''}>${renderInline(c ?? '', ctx)}</${tag}>`;
  const thead = `<tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr>`;
  const tbody = rows
    .map((r) => `<tr>${head.map((_, k) => cell('td', r[k], k)).join('')}</tr>`)
    .join('');
  return {
    html: `<div class="table-wrap"><table><thead>${thead}</thead>${tbody ? `<tbody>${tbody}</tbody>` : ''}</table></div>`,
    next: i,
  };
}

function safeHref(raw, ctx) {
  const url = raw.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return url;
  const name = scheme[1].toLowerCase();
  if (name === 'guide') {
    let id = url.slice(6);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep as is */
    }
    return ctx.guideHref ? ctx.guideHref(id) : null;
  }
  if (name === 'http' || name === 'https' || name === 'mailto') return url;
  return null;
}

function imageSrc(raw, ctx) {
  const url = raw.trim();
  if (ctx.imageSrc) return ctx.imageSrc(url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!scheme) return url;
  return /^https?$/i.test(scheme[1]) ? url : null;
}

function emphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?!\*)/g, (_, pre, body = '') => `${pre}<em>${body}</em>`)
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)?_(?!\w)/g, (_, pre, body = '') => `${pre}<em>${body}</em>`)
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
}

export function renderInline(src, ctx = {}) {
  const held = [];
  const hold = (html) => `\u0001${held.push(html) - 1}\u0002`;
  let s = String(src ?? '').replace(/[\u0001\u0002]/g, '');
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
  s = s.replace(IMG_RE, (_, alt, url) => {
    const src2 = imageSrc(url, ctx);
    if (!src2) return hold(esc(alt));
    return hold(
      `<img class="md-img" src="${esc(src2)}" alt="${esc(alt)}" loading="lazy" decoding="async" data-zoom>`
    );
  });
  s = s.replace(LINK_RE, (_, label, url) => {
    const inner = emphasis(esc(label));
    const href = safeHref(url, ctx);
    if (!href) return hold(inner);
    const external = /^(https?:|mailto:)/i.test(href);
    return hold(`<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`);
  });
  s = s.replace(AUTOLINK_RE, (url) => hold(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`));
  s = emphasis(esc(s));
  for (let n = 0; n < 5 && s.includes('\u0001'); n++) {
    s = s.replace(/\u0001(\d+)\u0002/g, (_, k) => held[Number(k)] ?? '');
  }
  return s;
}
