// In-app video clips, so the player never has to leave for YouTube.
//
// A clip starts as a light poster (thumbnail + play button). Tapping it puts a
// youtube-nocookie.com embed in its place that plays only start..end, muted
// (muted autoplay is the only kind phones allow after one tap, and the point
// is the path, not the commentary; the player's own button unmutes).
// Replay / Keep watching work with plain iframe URLs. The YouTube IFrame API
// is loaded lazily on the first play, only to notice when a clip ends or
// refuses to embed; if it fails to load, everything above still works.
import { esc, clock, parseYouTube } from './util.js';
import { icons } from './icons.js';

const EMBED = 'https://www.youtube-nocookie.com/embed/';
const API_URL = 'https://www.youtube.com/iframe_api';
const ORIGINS = ['https://www.youtube-nocookie.com', 'https://i.ytimg.com', 'https://www.youtube.com'];

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
export const watchUrl = (id, at = 0) =>
  `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${at > 0 ? `&t=${Math.floor(at)}s` : ''}`;

const lenText = (clip) => (clip.end ? clock(clip.end - clip.start) : clip.start ? `from ${clock(clip.start)}` : '');

/**
 * Poster markup for a clip { id, start, end }. opts.title names it for screen
 * readers; opts.big makes the controls larger (Follow mode).
 */
export function clipHTML(clip, { title = '', big = false, fromLink = '' } = {}) {
  if (!clip?.id) return '';
  const len = lenText(clip);
  const label = `Play clip${title ? `: ${title}` : ''}${clip.end ? ` (${clip.end - clip.start} seconds)` : ''}`;
  return `<div class="clip${big ? ' clip-big' : ''}" data-clip="${esc(clip.id)}" data-start="${clip.start || 0}"${
    clip.end ? ` data-end="${clip.end}"` : ''
  } data-title="${esc(title)}"${fromLink ? ` data-from-link="${esc(fromLink)}"` : ''}>
    <div class="clip-frame">${posterInner(clip, label, len)}</div>
    <div class="clip-bar">
      <button type="button" class="clip-btn" data-clip-act="replay" hidden>${icons.replay}<span>Replay</span></button>
      <button type="button" class="clip-btn" data-clip-act="more" hidden>${icons.forward}<span>Keep watching</span></button>
      <a class="clip-yt" href="${esc(watchUrl(clip.id, clip.start))}" target="_blank" rel="noopener noreferrer">Open in YouTube${icons.external}</a>
    </div>
  </div>`;
}

function posterInner(clip, label, len) {
  return `<button type="button" class="clip-poster" data-clip-act="play" aria-label="${esc(label)}">
      <img class="clip-thumb" src="${esc(thumbUrl(clip.id))}" alt="" loading="lazy" decoding="async">
      <span class="clip-play">${icons.play}</span>
      ${len ? `<span class="clip-len">${esc(len)}</span>` : ''}
    </button>`;
}

/**
 * Markdown hook: a YouTube link becomes a button that opens the clip inline
 * (returns null for any other link, which then renders normally).
 */
export function videoLinkHTML(href, innerHTML) {
  const yt = parseYouTube(href);
  if (!yt) return null;
  const label = String(innerHTML).replace(/^\s*(?:[▶►▷⏵]️?)\s*/, '') || 'Watch';
  return `<a class="md-clip" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-clip-link="${esc(yt.id)}" data-start="${
    yt.start
  }"${yt.end ? ` data-end="${yt.end}"` : ''} aria-expanded="false">${icons.play}<span>${label}</span></a>`;
}

// Playing --------------------------------------------------------------------

const states = new WeakMap(); // .clip element → { id, start, end, player, ready }

function readClip(el) {
  const start = Number(el.dataset.start) || 0;
  const end = Number(el.dataset.end) || null;
  return { id: el.dataset.clip, start, end: end && end > start ? end : null };
}

function embedSrc(id, from, to) {
  const p = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    enablejsapi: '1',
    start: String(Math.max(0, Math.floor(from))),
  });
  if (to) p.set('end', String(Math.floor(to)));
  if (/^https?:$/.test(location.protocol)) p.set('origin', location.origin);
  return `${EMBED}${encodeURIComponent(id)}?${p}`;
}

/** Put the player in place of the poster (or restart it) for from..to. */
function mount(el, from, to) {
  stopOthers(el);
  const clip = readClip(el);
  const frame = el.querySelector('.clip-frame');
  if (navigator.onLine === false) {
    frame.querySelector('.clip-offline')?.remove();
    frame.insertAdjacentHTML('beforeend', '<p class="clip-offline">No internet right now. Clips need a connection.</p>');
    return;
  }
  const title = el.dataset.title || 'Clip';
  frame.innerHTML = `<iframe class="clip-iframe" src="${esc(embedSrc(clip.id, from, to))}" title="${esc(
    title
  )}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><div class="clip-over" hidden></div>`;
  el.classList.add('is-playing');
  el.querySelector('.clip-bar [data-clip-act="replay"]').hidden = false;
  // "Keep watching" only means something when the clip has an end.
  el.querySelector('.clip-bar [data-clip-act="more"]').hidden = !clip.end;
  const st = { ...clip, player: null, ready: false };
  states.set(el, st);
  attachApi(el, frame.querySelector('iframe'), st);
}

/** Back to the poster (only one clip plays at a time). */
export function resetClip(el) {
  const clip = readClip(el);
  const st = states.get(el);
  try {
    st?.player?.destroy?.();
  } catch {
    /* already gone */
  }
  states.delete(el);
  el.classList.remove('is-playing', 'is-over');
  const len = lenText(clip);
  el.querySelector('.clip-frame').innerHTML = posterInner(clip, `Play clip${el.dataset.title ? `: ${el.dataset.title}` : ''}`, len);
  el.querySelectorAll('[data-clip-act="replay"], [data-clip-act="more"]').forEach((b) => {
    b.hidden = true;
  });
}

function stopOthers(el) {
  document.querySelectorAll('.clip.is-playing').forEach((other) => {
    if (other !== el) resetClip(other);
  });
}

function overlay(el, kind) {
  const over = el.querySelector('.clip-over');
  if (!over) return;
  if (!kind) {
    over.hidden = true;
    over.innerHTML = '';
    el.classList.remove('is-over');
    return;
  }
  const clip = readClip(el);
  over.innerHTML =
    kind === 'error'
      ? `<p>This video can't play inside the app.</p><a class="clip-over-btn" href="${esc(
          watchUrl(clip.id, clip.start)
        )}" target="_blank" rel="noopener noreferrer">${icons.external}<span>Open in YouTube</span></a>`
      : `<button type="button" class="clip-over-btn primary" data-clip-act="replay">${icons.replay}<span>Replay</span></button>
         ${clip.end ? `<button type="button" class="clip-over-btn" data-clip-act="more">${icons.forward}<span>Keep watching</span></button>` : ''}`;
  over.hidden = false;
  el.classList.add('is-over');
}

function replay(el) {
  const st = states.get(el);
  overlay(el, null);
  if (st?.ready && typeof st.player?.loadVideoById === 'function') {
    try {
      st.player.loadVideoById({ videoId: st.id, startSeconds: st.start, ...(st.end ? { endSeconds: st.end } : {}) });
      return;
    } catch {
      /* fall back to reloading the frame */
    }
  }
  const clip = readClip(el);
  mount(el, clip.start, clip.end);
}

function keepWatching(el) {
  const st = states.get(el);
  const clip = readClip(el);
  let from = clip.end || clip.start;
  overlay(el, null);
  if (st?.ready && typeof st.player?.loadVideoById === 'function') {
    try {
      const t = Number(st.player.getCurrentTime?.()) || 0;
      if (t > clip.start + 1) from = Math.floor(t);
      st.player.loadVideoById({ videoId: st.id, startSeconds: from });
      return;
    } catch {
      /* fall back */
    }
  }
  mount(el, from, null);
}

// Lazy IFrame API (optional) ----------------------------------------------------

let apiPromise = null;
let apiFailedAt = 0;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  if (Date.now() - apiFailedAt < 60_000) return Promise.reject(new Error('YouTube API unavailable'));
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {
        /* someone else's callback */
      }
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = API_URL;
    s.async = true;
    s.onerror = () => reject(new Error('YouTube API failed to load'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube API timed out')), 12_000);
  }).catch((err) => {
    apiPromise = null;
    apiFailedAt = Date.now();
    throw err;
  });
  return apiPromise;
}

function attachApi(el, iframe, st) {
  loadApi()
    .then((YT) => {
      if (!iframe.isConnected || states.get(el) !== st) return;
      st.player = new YT.Player(iframe, {
        host: 'https://www.youtube-nocookie.com',
        events: {
          onReady: () => {
            st.ready = true;
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) overlay(el, 'ended');
            else if (e.data === YT.PlayerState.PLAYING) overlay(el, null);
          },
          onError: (e) => {
            // 100: removed/private, 101/150/153: embedding not allowed.
            if ([2, 5, 100, 101, 150, 153].includes(Number(e.data))) overlay(el, 'error');
          },
        },
      });
    })
    .catch(() => {
      /* plain iframe keeps working */
    });
}

/** Make the first tap faster: open connections to YouTube ahead of time. */
let warmed = false;
export function warmUp() {
  if (warmed || typeof document === 'undefined') return;
  warmed = true;
  for (const href of ORIGINS) {
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = href;
    l.crossOrigin = '';
    document.head.appendChild(l);
  }
}

/** Fetch a clip's poster in the background (e.g. the next step's). */
export function prefetchPoster(clip) {
  if (!clip?.id || navigator.onLine === false) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = thumbUrl(clip.id);
}

// Taps ------------------------------------------------------------------------

function toggleLinkClip(a) {
  const key = `${a.dataset.clipLink}@${a.dataset.start || 0}`;
  const block = a.closest('.table-wrap') || a.closest('li, p, blockquote, td') || a;
  const anchor = block.closest('td') ? block.closest('.table-wrap') || block : block;
  const existing = anchor.nextElementSibling;
  if (existing?.matches?.('.clip') && existing.dataset.fromLink === key) {
    resetClip(existing);
    existing.remove();
    a.setAttribute('aria-expanded', 'false');
    return;
  }
  const clip = { id: a.dataset.clipLink, start: Number(a.dataset.start) || 0, end: Number(a.dataset.end) || null };
  anchor.insertAdjacentHTML('afterend', clipHTML(clip, { title: a.textContent.trim(), fromLink: key }));
  const el = anchor.nextElementSibling;
  a.setAttribute('aria-expanded', 'true');
  mount(el, clip.start, clip.end);
  el.scrollIntoView?.({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

let inited = false;
/** Install the click handling for every clip in the app (call once). */
export function initClips() {
  if (inited) return;
  inited = true;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[data-clip-link]');
    if (link) {
      e.preventDefault();
      warmUp();
      toggleLinkClip(link);
      return;
    }
    const btn = e.target.closest('[data-clip-act]');
    if (!btn) return;
    const el = btn.closest('.clip');
    if (!el) return;
    e.preventDefault();
    const act = btn.dataset.clipAct;
    if (act === 'play') {
      const clip = readClip(el);
      mount(el, clip.start, clip.end);
    } else if (act === 'replay') replay(el);
    else if (act === 'more') keepWatching(el);
  });
}
