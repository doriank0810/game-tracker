// Inline SVG icons (stroke style, inherit currentColor).
const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${paths}</svg>`;

export const icons = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>'),
  settings: svg(
    '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'
  ),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', ' stroke-width="3"'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  pin: svg('<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', ' stroke-width="2.4"'),
  minus: svg('<path d="M5 12h14"/>', ' stroke-width="2.4"'),
  book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  steps: svg('<path d="M4 7h4v4H4zM4 15h4v4H4z"/><path d="M12 9h8M12 17h8"/>'),
  mapPin: svg('<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  video: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5"/><path d="M5 4h14"/>'),
  share: svg('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  next: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  prev: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  forward: svg('<path d="M5 5.5v13l8-6.5z"/><path d="M14 5.5v13l7-6.5z"/>'),
  external: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  note: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/><path d="M8.5 9h7M8.5 12.5h4"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
};
