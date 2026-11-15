#!/usr/bin/env node
// Check the game files before publishing them.
//
//   node tools/validate.mjs            (checks this app's games/ folder)
//   node tools/validate.mjs path/to/Game\ Tracker
//
// Uses the same rules as the app (js/content.js). Also checks that pictures
// exist and that [text](guide:id) links point at real guides.
// Exit code 1 when something would be skipped by the app.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeIndex, normalizeGame } from '../js/content.js';

const appDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gamesDir = path.join(appDir, 'games');

let errorCount = 0;
let warningCount = 0;
const report = (file, errors, warnings) => {
  errorCount += errors.length;
  warningCount += warnings.length;
  const status = errors.length ? 'PROBLEMS' : warnings.length ? 'warnings' : 'ok';
  console.log(`\n${file}: ${status}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  for (const w of warnings) console.log(`  ! ${w}`);
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text);
}

const IMG_MD = /!\[[^\]\n]*\]\(\s*<?([^\s()<>]+)/g;
const GUIDE_LINK = /\]\(\s*guide:([^\s)]+)\s*\)/g;

function markdownSources(game) {
  const out = [];
  for (const it of game.items) if (it.detail) out.push([`item "${it.id}"`, it.detail]);
  for (const g of game.guides) {
    if (g.body) out.push([`guide "${g.id}"`, g.body]);
    if (g.intro) out.push([`guide "${g.id}" intro`, g.intro]);
    for (const s of g.steps) {
      if (s.text) out.push([`guide "${g.id}" step "${s.id}"`, s.text]);
      s.options.forEach((o, i) => out.push([`guide "${g.id}" step "${s.id}" option ${i + 1}`, o]));
    }
  }
  return out;
}

async function checkMedia(game, warnings) {
  const pics = [];
  for (const [where, src] of markdownSources(game)) {
    for (const m of src.matchAll(IMG_MD)) pics.push([where, m[1]]);
    for (const m of src.matchAll(GUIDE_LINK)) {
      if (!game.guideById.has(decodeURIComponent(m[1]))) warnings.push(`${where}: link to unknown guide "${m[1]}".`);
    }
  }
  for (const g of game.guides) for (const s of g.steps) if (s.image) pics.push([`guide "${g.id}" step "${s.id}"`, s.image]);
  for (const [where, src] of pics) {
    if (/^https?:\/\//i.test(src)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      warnings.push(`${where}: picture "${src}" must be a relative path or an https:// link.`);
      continue;
    }
    const rel = src.replace(/^\.?\/+/, '').replace(/^games\//, '');
    if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(rel)) warnings.push(`${where}: "${src}" is not a png/jpg/webp/gif/svg/avif file.`);
    if (!(await exists(path.join(gamesDir, decodeURI(rel))))) warnings.push(`${where}: picture not found: games/${rel}`);
  }
}

async function main() {
  console.log(`Checking ${gamesDir}`);
  let rawIndex;
  try {
    rawIndex = await readJson(path.join(gamesDir, 'index.json'));
  } catch (err) {
    report('games/index.json', [`Can't read: ${err.message}`], []);
    process.exit(1);
  }
  const index = normalizeIndex(rawIndex);
  report('games/index.json', index.errors, index.warnings);

  for (const meta of index.games) {
    const rel = `games/${meta.id}.json`;
    let raw;
    try {
      raw = await readJson(path.join(gamesDir, `${meta.id}.json`));
    } catch (err) {
      report(rel, [err.code === 'ENOENT' ? 'File not found.' : `Not valid JSON: ${err.message}`], []);
      continue;
    }
    const { game, errors, warnings } = normalizeGame(raw, meta.id);
    await checkMedia(game, warnings);
    report(rel, errors, warnings);
    const steps = game.guides.reduce((n, g) => n + g.steps.length, 0);
    console.log(
      `  ${game.sections.length} sections, ${game.items.length} items, ${game.guides.length} guides${steps ? `, ${steps} walkthrough steps` : ''}`
    );
  }
  console.log(`\nDone: ${errorCount} problem(s), ${warningCount} warning(s).`);
  process.exit(errorCount ? 1 : 0);
}

main();
