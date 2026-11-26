// Content model: turns the raw JSON files in games/ into a safe, indexed
// structure. Bad or missing fields are fixed up or skipped (with a message)
// instead of crashing the app. Pure module (no DOM): tools/validate.mjs
// uses it in Node to check the files.
import { DEFAULT_ACCENT, fold, parseYouTube } from './util.js';

/** How the game page is laid out (top-level "layout" in a game file). */
export const LAYOUTS = ['story', 'maps', 'loadouts'];
const LAYOUT_KEYS = ['type', 'order', 'cards', 'checklist', 'picker'];

export const STATUS_ORDER = ['playing', 'paused', 'not-started', 'done'];
export const STATUS_LABEL = {
  playing: 'Playing',
  paused: 'Paused',
  'not-started': 'Not started',
  done: 'Done',
};

export function normStatus(value) {
  const k = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (k === 'notstarted') return 'not-started';
  return STATUS_ORDER.includes(k) ? k : null;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_GAME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
/** Markdown text: a string, or an array of lines (joined with newlines). */
const text = (v) =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : '';
const isWebUrl = (v) => /^https?:\/\//i.test(v);

/**
 * A picture: a path relative to games/ ("img/my-game/pic.png") or an
 * https:// link. http:// and other schemes are dropped with a warning.
 */
export function imageRef(value, at, warnings) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    warnings.push(`${at}: "image" should be text (a path or an https:// link); ignored.`);
    return '';
  }
  const s = value.trim();
  if (!s || /^https:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) {
    warnings.push(`${at}: picture "${s}" must be a path relative to games/ or an https:// link; ignored.`);
    return '';
  }
  return s;
}

/** Optional one-line text field: a string (or number); anything else is ignored with a warning. */
function lineField(value, name, at, warnings) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    warnings.push(`${at}: "${name}" should be a short text; ignored.`);
    return '';
  }
  return str(value);
}

function list(value, name, warnings) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  warnings.push(`${name} should be an array; it was ignored.`);
  return [];
}

function uniqueId(id, taken) {
  let n = 2;
  while (taken.has(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

/** games/index.json → { games: [{ id, title, platform, status, accent, order }], errors, warnings } */
export function normalizeIndex(raw) {
  const errors = [];
  const warnings = [];
  const arr = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.games) ? raw.games : null;
  if (!arr) {
    errors.push('games/index.json must be a JSON array: [ { "id": ..., "title": ... } ].');
    return { games: [], errors, warnings };
  }
  const seen = new Set();
  const games = [];
  arr.forEach((g, i) => {
    const at = `index.json entry #${i + 1}`;
    if (!isObj(g)) return errors.push(`${at} is not an object; skipped.`);
    const id = str(g.id);
    if (!id) return errors.push(`${at} has no "id"; skipped.`);
    if (!SAFE_GAME_ID.test(id)) {
      return errors.push(`${at}: game id "${id}" may only use letters, numbers, "-", "_" and "."; skipped.`);
    }
    if (seen.has(id)) return errors.push(`Duplicate game id "${id}" in index.json; the second one was skipped.`);
    seen.add(id);
    const status = normStatus(g.status);
    if (g.status != null && !status) {
      warnings.push(`"${id}": unknown status "${g.status}"; using "not-started".`);
    }
    let accent = str(g.accent);
    if (accent && !HEX.test(accent)) {
      warnings.push(`"${id}": accent "${accent}" is not a hex colour like "#3fa9f5"; using the default.`);
      accent = '';
    }
    if (!str(g.title)) warnings.push(`"${id}" has no "title".`);
    games.push({
      id,
      title: str(g.title) || id,
      platform: str(g.platform),
      status: status || 'not-started',
      accent: accent || DEFAULT_ACCENT,
      order: games.length,
    });
  });
  return { games, errors, warnings };
}

function normalizeSteps(g, gid, errors, warnings) {
  const steps = [];
  const stepById = new Map();
  list(g.steps, `"steps" in guide "${gid}"`, warnings).forEach((s, i) => {
    const at = `Guide "${gid}" step #${i + 1}`;
    if (!isObj(s)) return errors.push(`${at} is not an object; skipped.`);
    let sid = str(s.id);
    if (!sid) {
      sid = `step-${i + 1}`;
      if (stepById.has(sid)) sid = uniqueId(sid, stepById);
      warnings.push(`${at} has no "id"; using "${sid}". Give every step a fixed id so ticks survive edits.`);
    }
    if (stepById.has(sid)) return errors.push(`${at}: duplicate step id "${sid}"; skipped.`);
    let video = str(s.video);
    if (video && !isWebUrl(video)) {
      warnings.push(`${at}: "video" must start with http:// or https://; ignored.`);
      video = '';
    }
    const yt = video ? parseYouTube(video) : null;
    if (video && !yt && /youtu\.?be/i.test(video)) {
      warnings.push(`${at}: "video" looks like YouTube but has no video id; it opens as a plain link.`);
    }
    let videoEnd = null;
    if (s.videoEnd != null) {
      const start = yt ? yt.start : 0;
      if (!video) warnings.push(`${at}: "videoEnd" without a "video"; ignored.`);
      else if (typeof s.videoEnd !== 'number' || !Number.isFinite(s.videoEnd)) {
        warnings.push(`${at}: "videoEnd" must be a number of seconds (like 60); ignored.`);
      } else if (s.videoEnd <= start) {
        warnings.push(`${at}: "videoEnd" (${s.videoEnd}) must be greater than the start (${start}s); ignored.`);
      } else videoEnd = s.videoEnd;
    }
    let options = [];
    if (Array.isArray(s.options)) options = s.options.map(text).filter((o) => o.trim());
    else if (typeof s.options === 'string' && s.options.trim()) options = [s.options];
    else if (s.options != null) warnings.push(`${at}: "options" should be an array of strings; ignored.`);
    const step = {
      id: sid,
      title: str(s.title) || `Step ${i + 1}`,
      where: str(s.where),
      text: text(s.text),
      image: imageRef(s.image, at, warnings),
      alt: str(s.alt),
      video,
      // In-app clip: { id, start, end } for YouTube links, else null.
      clip: yt ? { id: yt.id, start: yt.start, end: videoEnd ?? yt.end } : null,
      videoEnd,
      options,
      index: steps.length,
    };
    steps.push(step);
    stepById.set(sid, step);
  });
  return { steps, stepById };
}

/**
 * games/<id>.json → { game, errors, warnings }.
 * errors = something was skipped; warnings = something was fixed up.
 */
export function normalizeGame(raw, expectedId = '') {
  const errors = [];
  const warnings = [];
  if (!isObj(raw)) {
    errors.push('The game file must contain a JSON object: { "id": ..., "sections": [...] }.');
    raw = {};
  }
  const fileId = str(raw.id);
  if (!fileId) warnings.push('The file has no "id".');
  else if (expectedId && fileId !== expectedId) {
    warnings.push(`"id" is "${fileId}" but index.json calls this game "${expectedId}"; using "${expectedId}".`);
  }
  const id = expectedId || fileId;

  // Guides first, so item "guide" links can be checked.
  const guides = [];
  const guideById = new Map();
  list(raw.guides, '"guides"', warnings).forEach((g, i) => {
    const at = `Guide #${i + 1}`;
    if (!isObj(g)) return errors.push(`${at} is not an object; skipped.`);
    const gid = str(g.id);
    if (!gid) return errors.push(`${at} ("${str(g.title)}") has no "id"; skipped.`);
    if (guideById.has(gid)) return errors.push(`Duplicate guide id "${gid}"; the second one was skipped.`);
    if (!str(g.title)) warnings.push(`Guide "${gid}" has no "title".`);
    const kindRaw = str(g.kind).toLowerCase();
    let kind = kindRaw === 'walkthrough' ? 'walkthrough' : 'page';
    if (kindRaw && kindRaw !== 'walkthrough' && kindRaw !== 'page') {
      warnings.push(`Guide "${gid}": unknown kind "${g.kind}"; treated as "page".`);
    }
    if (!kindRaw && Array.isArray(g.steps)) kind = 'walkthrough';
    const guide = {
      id: gid,
      title: str(g.title) || gid,
      category: str(g.category),
      kind,
      body: text(g.body),
      intro: text(g.intro),
      steps: [],
      stepById: new Map(),
      order: guides.length,
    };
    if (kind === 'walkthrough') {
      Object.assign(guide, normalizeSteps(g, gid, errors, warnings));
      if (!guide.intro && guide.body) guide.intro = guide.body;
      if (!guide.steps.length) warnings.push(`Walkthrough "${gid}" has no steps.`);
    } else if (g.steps != null) {
      warnings.push(`Guide "${gid}" has "steps" but is not "kind": "walkthrough"; steps ignored.`);
    }
    guides.push(guide);
    guideById.set(gid, guide);
  });

  const sections = [];
  const items = [];
  const byId = new Map();
  const groupByKey = new Map();
  const sectionIds = new Set();

  list(raw.sections, '"sections"', warnings).forEach((s, si) => {
    if (!isObj(s)) return errors.push(`Section #${si + 1} is not an object; skipped.`);
    let sid = str(s.id);
    if (!sid) {
      sid = `section-${si + 1}`;
      warnings.push(`Section #${si + 1} ("${str(s.title)}") has no "id"; using "${sid}".`);
    }
    if (sectionIds.has(sid)) {
      const n = uniqueId(sid, sectionIds);
      warnings.push(`Duplicate section id "${sid}"; using "${n}".`);
      sid = n;
    }
    sectionIds.add(sid);
    const section = { id: sid, title: str(s.title) || sid, groups: [], items: [] };
    const groupIds = new Set();

    list(s.groups, `"groups" in section "${sid}"`, warnings).forEach((g, gi) => {
      if (!isObj(g)) return errors.push(`Group #${gi + 1} in section "${sid}" is not an object; skipped.`);
      let gid = str(g.id);
      if (!gid) {
        gid = `group-${gi + 1}`;
        warnings.push(`Group #${gi + 1} ("${str(g.title)}") in section "${sid}" has no "id"; using "${gid}".`);
      }
      if (groupIds.has(gid)) {
        const n = uniqueId(gid, groupIds);
        warnings.push(`Duplicate group id "${gid}" in section "${sid}"; using "${n}".`);
        gid = n;
      }
      groupIds.add(gid);
      const gat = `Group "${sid}/${gid}"`;
      const group = {
        id: gid,
        key: `${sid}/${gid}`,
        title: str(g.title) || gid,
        // Optional: heading the group is listed under in a picker ("SMG"),
        // its picture (e.g. a weapon icon) and a one-line note.
        class: lineField(g.class, 'class', gat, warnings),
        image: imageRef(g.image, gat, warnings),
        note: lineField(g.note, 'note', gat, warnings),
        // Optional: a short tip for this group, and the id of a guide shown as a pop-up from its page.
        tip: text(g.tip),
        help: lineField(g.help, 'help', gat, warnings),
        section,
        items: [],
      };

      list(g.items, `"items" in group "${group.key}"`, warnings).forEach((it, ii) => {
        const at = `${group.key} item #${ii + 1}`;
        if (!isObj(it)) return errors.push(`${at} is not an object; skipped.`);
        const iid = str(it.id);
        if (!iid) return errors.push(`${at} ("${str(it.title)}") has no "id"; skipped.`);
        if (byId.has(iid)) {
          return errors.push(`Duplicate item id "${iid}" (${at}); skipped. Item ids must be unique within a game.`);
        }
        let type = str(it.type).toLowerCase() || 'check';
        if (type !== 'check' && type !== 'counter') {
          warnings.push(`Item "${iid}": unknown type "${it.type}"; treated as "check".`);
          type = 'check';
        }
        let target = null;
        if (type === 'counter') {
          const t = Math.floor(Number(it.target));
          if (Number.isFinite(t) && t >= 1) target = t;
          else {
            warnings.push(`Item "${iid}": a counter needs a "target" of 1 or more; treated as "check".`);
            type = 'check';
          }
        }
        let priority = null;
        if (it.priority != null && it.priority !== '') {
          const p = Number(it.priority);
          if (Number.isFinite(p)) priority = p;
          else warnings.push(`Item "${iid}": "priority" must be a number; ignored.`);
        }
        let guide = str(it.guide) || null;
        if (guide && !guideById.has(guide)) {
          warnings.push(`Item "${iid}": guide "${guide}" does not exist; link removed.`);
          guide = null;
        }
        let tags = [];
        if (Array.isArray(it.tags)) tags = it.tags.map(str).filter(Boolean);
        else if (typeof it.tags === 'string' && it.tags.trim()) tags = [it.tags.trim()];
        else if (it.tags != null) warnings.push(`Item "${iid}": "tags" should be an array of strings; ignored.`);
        if (!str(it.title)) warnings.push(`Item "${iid}" has no "title".`);
        const item = {
          id: iid,
          title: str(it.title) || iid,
          detail: text(it.detail),
          priority,
          guide,
          autoComplete: it.autoComplete !== false,
          tags,
          type,
          target,
          image: imageRef(it.image, `Item "${iid}"`, warnings),
          // Optional: one short line saying where or how to do it ("Shipment, Hardpoint").
          tip: lineField(it.tip, 'tip', `Item "${iid}"`, warnings),
          order: items.length,
          section,
          group,
        };
        items.push(item);
        byId.set(iid, item);
        group.items.push(item);
        section.items.push(item);
      });
      section.groups.push(group);
      groupByKey.set(group.key, group);
    });
    sections.push(section);
  });

  // Guides belong to the section whose title (or id) equals their category.
  const catKey = (v) => fold(v).trim();
  for (const sec of sections) {
    const keys = new Set([catKey(sec.title), catKey(sec.id)]);
    sec.guides = guides.filter((g) => g.category && keys.has(catKey(g.category)));
  }
  for (const g of guides) {
    g.sectionId = sections.find((sec) => sec.guides.includes(g))?.id || null;
    g.items = items.filter((it) => it.guide === g.id); // checklist items that point at this guide
  }

  const layout = normalizeLayout(raw.layout, guides, warnings, sections);
  if (layout.type === 'maps' && !layout.guessed) {
    for (const g of guides) {
      if (!g.sectionId) {
        warnings.push(
          `Guide "${g.id}": category "${g.category}" matches no section title, so with "layout": "maps" it only shows under "Other guides".`
        );
      }
    }
  }

  return {
    game: {
      id,
      title: str(raw.title),
      layout,
      sections,
      items,
      byId,
      groupByKey,
      guides,
      guideById,
    },
    errors,
    warnings,
  };
}

/**
 * "layout": "maps" | "loadouts" | "story", or an object
 * { type, order: [categories], cards: [categories], checklist: "label", picker: "label" }.
 */
export function normalizeLayout(raw, guides = [], warnings = [], sections = []) {
  const out = { type: 'story', order: [], cards: null, checklist: '', picker: '', guessed: false };
  if (raw == null) {
    // No "layout": guess. Class/loadout guide categories → loadouts; every
    // section having its own guides (category = section title) → maps.
    out.guessed = true;
    if (guides.some((g) => /class|loadout/i.test(g.category))) out.type = 'loadouts';
    else if (sections.length >= 2 && sections.every((s) => s.guides?.length)) out.type = 'maps';
    return finishLayout(out, guides);
  }
  const obj = typeof raw === 'string' ? { type: raw } : isObj(raw) ? raw : null;
  if (!obj) {
    warnings.push('"layout" should be "story", "maps", "loadouts" or an object with a "type"; ignored.');
    return finishLayout(out, guides);
  }
  const type = str(obj.type).toLowerCase();
  if (!type) warnings.push('"layout" has no "type"; using "story".');
  else if (!LAYOUTS.includes(type)) warnings.push(`Unknown layout type "${obj.type}"; using "story". Use one of: ${LAYOUTS.join(', ')}.`);
  else out.type = type;
  const strList = (v, name) => {
    if (v == null) return null;
    if (!Array.isArray(v)) {
      warnings.push(`"layout.${name}" should be an array of guide categories; ignored.`);
      return null;
    }
    return v.map(str).filter(Boolean);
  };
  out.order = strList(obj.order, 'order') || [];
  out.cards = strList(obj.cards, 'cards');
  if (obj.checklist != null && typeof obj.checklist !== 'string') warnings.push('"layout.checklist" should be a short text; ignored.');
  else out.checklist = str(obj.checklist);
  if (obj.picker != null && typeof obj.picker !== 'string') warnings.push('"layout.picker" should be a short text; ignored.');
  else out.picker = str(obj.picker);
  for (const k of Object.keys(obj)) {
    if (!LAYOUT_KEYS.includes(k)) warnings.push(`"layout.${k}" is not a known layout option; ignored.`);
  }
  const cats = new Set(guides.map((g) => g.category).filter(Boolean));
  for (const [name, list] of [
    ['order', out.order],
    ['cards', out.cards || []],
  ]) {
    for (const c of list) if (!cats.has(c)) warnings.push(`"layout.${name}" names category "${c}", but no guide has that category.`);
  }
  return finishLayout(out, guides);
}

function finishLayout(out, guides) {
  // Default class-card categories: any category with "class" or "loadout" in its name.
  if (!out.cards) {
    out.cards = [...new Set(guides.map((g) => g.category).filter((c) => /class|loadout/i.test(c)))];
  }
  if (!out.checklist) out.checklist = 'Checklist';
  if (!out.picker) out.picker = 'Maps';
  return out;
}

/**
 * Guide categories in display order: layout.order first, then (loadouts)
 * "start…" categories, then class-card categories, then the rest in file order.
 */
export function categoryOrder(game, guides = game.guides) {
  const seen = [];
  for (const g of guides) if (!seen.includes(g.category)) seen.push(g.category);
  const pos = new Map(seen.map((c, i) => [c, i]));
  const base = game.layout.order.length;
  const rank = (c) => {
    const i = game.layout.order.indexOf(c);
    if (i >= 0) return i;
    if (c === '') return base + 100000;
    if (game.layout.type === 'loadouts') {
      if (/^start/i.test(c)) return base + 1;
      if (game.layout.cards.includes(c)) return base + 2;
    }
    return base + 10 + pos.get(c);
  };
  return [...seen].sort((a, b) => rank(a) - rank(b) || pos.get(a) - pos.get(b));
}

/** Folded search text for an item (cached on the item). */
export function itemSearchText(it) {
  if (it._s == null) {
    it._s = fold([it.title, it.detail, it.tags.join(' '), it.group.title, it.group.class, it.section.title].join('\n'));
  }
  return it._s;
}

/** Folded search text for a guide, including walkthrough steps (cached). */
export function guideSearchText(g) {
  if (g._s == null) {
    const steps = g.steps.map((s) => [s.title, s.where, s.text, s.options.join(' ')].join(' '));
    g._s = fold([g.title, g.category, g.body, g.intro, ...steps].join('\n'));
  }
  return g._s;
}
