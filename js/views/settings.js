// Settings: backup (export / import), reset one game, content check, about.
import * as data from '../data.js';
import * as store from '../store.js';
import { esc, relTime, plural } from '../util.js';
import { topBar, toast } from '../ui.js';
import { resetGameUI, resetAllUI } from '../state.js';
import { icons } from '../icons.js';

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function backupFile() {
  return {
    json: JSON.stringify(store.exportData(), null, 2),
    name: `game-tracker-backup-${localDate()}.json`,
  };
}

function shareSupported() {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] })
    );
  } catch {
    return false;
  }
}

function savedSummary(gameId) {
  const gp = store.game(gameId);
  const ticks = Object.keys(gp.checked).length;
  const counts = Object.keys(gp.counts).length;
  const steps = Object.values(gp.steps).reduce((n, m) => n + Object.keys(m).length, 0);
  const parts = [];
  if (ticks) parts.push(plural(ticks, 'tick'));
  if (counts) parts.push(plural(counts, 'counter'));
  if (steps) parts.push(plural(steps, 'guide step'));
  if (gp.note) parts.push('a note');
  return parts.length ? parts.join(', ') : 'Nothing saved yet';
}

function resetListHTML(index) {
  const listed = index?.games || [];
  const ids = new Set(listed.map((g) => g.id));
  const orphans = store.savedGameIds().filter((id) => !ids.has(id));
  const rows = [
    ...listed.map((g) => ({ id: g.id, title: g.title, extra: '' })),
    ...orphans.map((id) => ({ id, title: id, extra: ' (no longer in the game list)' })),
  ];
  if (!rows.length) return '<p class="muted small">No games yet.</p>';
  return rows
    .map(
      (r) => `<div class="reset-row">
        <div class="reset-text"><div class="reset-title">${esc(r.title)}${esc(r.extra)}</div><div class="muted small">${esc(
          savedSummary(r.id)
        )}</div></div>
        <button type="button" class="btn danger small" data-act="reset" data-game="${esc(r.id)}" data-title="${esc(r.title)}">Reset</button>
      </div>`
    )
    .join('');
}

function reportHTML(index, entries) {
  const out = [];
  const block = (title, errors, warnings, okText) => {
    if (!errors.length && !warnings.length) {
      return `<div class="report-row ok"><span class="report-title">${esc(title)}</span><span class="muted small">${esc(okText)}</span></div>`;
    }
    const list = [
      ...errors.map((m) => `<li class="err">${esc(m)}</li>`),
      ...warnings.map((m) => `<li>${esc(m)}</li>`),
    ].join('');
    const summary = [errors.length && plural(errors.length, 'problem'), warnings.length && plural(warnings.length, 'warning')]
      .filter(Boolean)
      .join(', ');
    return `<details class="report-row${errors.length ? ' bad' : ''}"><summary><span class="report-title">${esc(
      title
    )}</span><span class="small">${esc(summary)}</span></summary><ul>${list}</ul></details>`;
  };
  if (!index) return '<p class="muted small">Could not load games/index.json.</p>';
  out.push(block('games/index.json', index.errors, index.warnings, plural(index.games.length, 'game')));
  for (const e of entries) {
    if (e.error) {
      out.push(`<div class="report-row bad"><span class="report-title">games/${esc(e.id)}.json</span><span class="small">${esc(e.error)}</span></div>`);
      continue;
    }
    const g = e.game;
    const steps = g.guides.reduce((n, x) => n + x.steps.length, 0);
    const ok = `${plural(g.items.length, 'item')}, ${plural(g.guides.length, 'guide')}${steps ? `, ${plural(steps, 'step')}` : ''}`;
    out.push(block(`games/${g.id}.json`, e.errors, e.warnings, ok));
  }
  return out.join('');
}

async function appVersion() {
  try {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.startsWith('gt-shell-'));
    return shell ? shell.slice('gt-shell-'.length) : null;
  } catch {
    return null;
  }
}

export async function render(ctx) {
  const index = await data.getIndex().catch(() => null);
  if (!ctx.isCurrent()) return null;
  const meta = store.getMeta();
  const canShare = shareSupported();
  ctx.mount(`${topBar({ title: 'Settings', back: '#/', noSettings: true })}
    <main class="page page-settings">
      ${store.isAvailable() ? '' : `<div class="notice">This browser isn't letting the app save anything (private browsing?). Your ticks will be lost when you close it.</div>`}
      ${store.loadProblem() ? `<div class="notice">${esc(store.loadProblem())}</div>` : ''}
      <section class="card-block">
        <h2 class="label">Backup</h2>
        <p class="muted">Your progress is saved in this browser, on this device only. Export a backup now and then, and to move to another phone or computer.</p>
        <p class="muted small last-export">${meta.lastExport ? `Last backup ${relTime(meta.lastExport)}.` : 'No backup made yet.'}</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-act="export">${icons.download}<span>Export backup</span></button>
          ${canShare ? `<button type="button" class="btn" data-act="share">${icons.share}<span>Share backup</span></button>` : ''}
          <label class="btn">${icons.upload}<span>Import backup</span><input type="file" class="import-file sr-only" accept="application/json,.json"></label>
        </div>
      </section>
      <section class="card-block">
        <h2 class="label">Reset a game</h2>
        <p class="muted">Clears ticks, counters, pins, guide steps and the note for one game. This can't be undone, so export a backup first if you're not sure.</p>
        <div class="reset-list">${resetListHTML(index)}</div>
      </section>
      <section class="card-block">
        <h2 class="label">Game files</h2>
        <p class="muted">The app loads the newest game files each time you open it while online.</p>
        <div class="btn-row"><button type="button" class="btn" data-act="refresh">${icons.refresh}<span>Check for new content</span></button></div>
        <div class="report"><p class="muted small">Checking files…</p></div>
      </section>
      <section class="card-block">
        <h2 class="label">About</h2>
        <p class="muted small about">Game Tracker</p>
      </section>
    </main>`);
  document.title = 'Settings · Game Tracker';
  const main = ctx.root.querySelector('main');

  const fillReport = async () => {
    const idx = data.peekIndex() || index;
    const entries = idx ? await data.getAllGames().catch(() => []) : [];
    if (!ctx.isCurrent()) return;
    main.querySelector('.report').innerHTML = reportHTML(idx, entries);
  };
  fillReport();

  appVersion().then((v) => {
    if (!ctx.isCurrent()) return;
    const offline = navigator.serviceWorker?.controller
      ? 'Works offline on this device.'
      : 'Offline mode is not active here (it needs https:// or localhost).';
    main.querySelector('.about').textContent = `Game Tracker${v ? ` · version ${v}` : ''}. ${offline}`;
  });

  const markExported = () => {
    store.setMeta({ lastExport: Date.now() });
    main.querySelector('.last-export').textContent = 'Last backup just now.';
  };

  main.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'export': {
        const { json, name } = backupFile();
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        markExported();
        toast(`Backup saved as ${name}`);
        break;
      }
      case 'share': {
        const { json, name } = backupFile();
        try {
          await navigator.share({ files: [new File([json], name, { type: 'application/json' })], title: 'Game Tracker backup' });
          markExported();
        } catch (err) {
          if (err?.name !== 'AbortError') toast("Couldn't share the file. Use Export backup instead.");
        }
        break;
      }
      case 'reset': {
        const id = el.dataset.game;
        const title = el.dataset.title || id;
        if (!confirm(`Reset all progress for “${title}”?\n\nThis clears ticks, counters, pins, guide steps and your note for this game. It can't be undone.`)) return;
        store.resetGame(id);
        resetGameUI(id);
        main.querySelector('.reset-list').innerHTML = resetListHTML(data.peekIndex() || index);
        toast(`Progress for ${title} was reset.`);
        break;
      }
      case 'refresh': {
        if (navigator.onLine === false) {
          toast("You're offline. Try again when you're connected.");
          return;
        }
        el.disabled = true;
        const { changed } = await data.refresh({ force: true });
        el.disabled = false;
        toast(changed.length ? 'Loaded the newest game files.' : 'Everything is up to date.');
        fillReport();
        break;
      }
      default:
    }
  });

  main.querySelector('.import-file').addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      toast("That file isn't a valid backup (not JSON).");
      return;
    }
    const res = store.parseBackup(obj);
    if (!res.ok) {
      toast(res.error);
      return;
    }
    const date = res.exportedAt ? new Date(res.exportedAt) : null;
    const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'an unknown date';
    if (!confirm(`Replace all your current progress with this backup?\n\nBackup from ${when}, with progress for ${plural(res.count, 'game')}.`)) return;
    store.replaceAll(res.state);
    resetAllUI();
    toast('Backup restored.');
  });
  return null;
}
