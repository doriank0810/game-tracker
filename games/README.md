# Game content format

Everything the app shows comes from the JSON files in this folder. The app never
writes here: ticks, counters, pins, notes and walkthrough progress live in the
browser (localStorage) and are matched to content **by id**. So you can edit,
extend and reorder these files at any time without losing anyone's progress,
as long as ids stay the same.

```
games/
  index.json              the list of games (home screen)
  <game-id>.json          one file per game
  img/<game-id>/...       pictures used by that game's guides (optional)
```

Check your files before publishing:

```
node tools/validate.mjs
```

It uses the same rules as the app and also checks that pictures exist and that
`guide:` links point at real guides. "Problems" mean something will be skipped;
"warnings" mean something was fixed up automatically.

---

## 1. `games/index.json`

A JSON array, one object per game, in the order you like (the home screen groups
them by status: playing, paused, not started, done; most recently played first
within a group).

```json
[
  { "id": "inazuma-eleven-victory-road", "title": "Inazuma Eleven: Victory Road",
    "platform": "Switch", "status": "playing", "accent": "#3fa9f5" }
]
```

| Field      | Required | Meaning |
|------------|----------|---------|
| `id`       | yes | Must match the file name: `games/<id>.json`. Letters, numbers, `-`, `_`, `.` only. **Never change it** once used (progress is keyed by it). |
| `title`    | yes | Shown on the home card and the game page. (Wins over a `title` inside the game file.) |
| `platform` | no  | Small grey text, e.g. `"PS5"`. |
| `status`   | no  | `"playing"`, `"paused"`, `"not-started"` (default) or `"done"`. The player can override it on the game page; this is the default. |
| `accent`   | no  | Hex colour (`"#3fa9f5"` or `"#3af"`) that tints the game's page. Very dark colours are lightened automatically. Default `#5ad1c0`. |

A game listed here whose file is missing or broken shows an error card; nothing else breaks.

---

## 2. `games/<game-id>.json`

```json
{
  "id": "sample-game",
  "title": "Sample Quest (demo)",
  "sections": [
    { "id": "story", "title": "Story", "groups": [
      { "id": "ch1", "title": "Chapter 1", "items": [
        { "id": "ch1-a", "title": "Talk to Grandma", "detail": "She's in the **kitchen**.", "priority": 1 }
      ]}
    ]}
  ],
  "guides": [
    { "id": "boss-cheatsheet", "title": "Boss cheat sheet", "category": "Reference", "body": "| Boss | Weak to |\n|---|---|\n| Golem | Ice |" }
  ]
}
```

| Field      | Required | Meaning |
|------------|----------|---------|
| `id`       | yes | Same as in `index.json` (if they differ, the index id is used). |
| `title`    | no  | Only used if the game isn't in `index.json`. |
| `sections` | no  | Array of sections (checklist). |
| `guides`   | no  | Array of guides (see section 3). |

### Sections and groups

Checklist = sections → groups → items. Each section and group gets a
"done/total" count. Groups start collapsed, except the one holding the next
thing to do.

| Field    | Required | Meaning |
|----------|----------|---------|
| `id`     | yes | Unique among sections (for a section) or within its section (for a group). Used to remember which groups are open. |
| `title`  | yes | Shown as the heading. |
| `groups` | (section) | Array of groups. |
| `items`  | (group)   | Array of items. |

Use sections for the big split (Story, Side quests, Collectibles, Camos,
Easter eggs, Reference…) and groups for chapters, maps, weapons, regions…

### Items

| Field          | Required | Meaning |
|----------------|----------|---------|
| `id`           | yes | **Unique within the game** (across all sections). Progress is saved under it. Never reuse an id for something different. Prefer short readable ids: `"ch3-boss"`, `"m4-gold"`. |
| `title`        | yes | One line, what to do: "Beat the Moss Golem". |
| `detail`       | no  | Markdown shown when the item is opened (tips, location, requirements). Keep it short; long text belongs in a guide. A string, or an array of lines. |
| `type`         | no  | `"check"` (default, a tick box) or `"counter"`. |
| `target`       | counter only | Whole number ≥ 1. A counter is done when its count reaches the target (e.g. 37/100 kills). The player taps − / + or types the number. A counter without a valid target becomes a check. |
| `priority`     | no  | Number, lower = sooner. Items with a priority come before items without one in the "Next" list (see below). |
| `guide`        | no  | Id of a guide in this file. Shows a "Guide" badge and a button to open it. If the guide is a walkthrough, the button is **Follow guide** (or "Continue at step N") and the badge shows step progress. |
| `autoComplete` | no  | Only for items linked to a walkthrough. Default `true`: the item ticks itself when every step of that walkthrough is ticked. Set `false` to stop that. (Counters never auto-complete.) |
| `tags`         | no  | Array of short strings shown as chips and searchable: `["missable", "chapter 2"]`. |

### How the "Next" list is chosen

The Next tab shows about 5 things for this session:

1. Items the player **pinned**, in the order they were pinned (not done ones only).
2. Then unfinished items sorted by `priority` (lower first; items without a
   priority come after every item that has one), then by **file order**.

So for a story game you can leave `priority` out entirely and just keep the
file in play order. Add `priority` only to pull something forward (a missable,
a time-limited event, "do this before the boss").

"Up to: Section › Group" on the game page is the group of the first unfinished
item in file order.

---

## 3. Guides

Every guide has `id` (unique within the game), `title`, and optional
`category` (guides are grouped by category on the Guides tab). There are two
kinds.

### 3a. Reference page (default)

```json
{ "id": "boss-cheatsheet", "title": "Boss cheat sheet", "category": "Reference",
  "body": "markdown…" }
```

| Field  | Meaning |
|--------|---------|
| `kind` | Leave out, or `"page"`. |
| `body` | Markdown (string or array of lines). Rendered as a readable page. |

The guide page also lists every checklist item whose `guide` points at it,
with tick boxes.

### 3b. Walkthrough (follow-along steps)

For anything done step by step next to the console: Easter eggs, buildables,
routes, puzzle solutions.

```json
{
  "id": "origins-shield", "title": "Build the Zombie Shield", "category": "Buildables",
  "kind": "walkthrough",
  "intro": "Three parts. Each part has 3 possible spots.",
  "steps": [
    { "id": "visor", "title": "Part 1: Visor", "where": "Tank Station, by Generator 2",
      "text": "Look on the crates **left** of the generator.",
      "image": "img/origins/shield-visor.jpg", "alt": "Visor on a crate next to Generator 2",
      "video": "https://www.youtube.com/watch?v=XXXX&t=95s",
      "options": ["Inside the tank station, on the table", "Behind the **workbench**"] }
  ]
}
```

| Field   | Required | Meaning |
|---------|----------|---------|
| `kind`  | yes | `"walkthrough"` (a guide with a `steps` array and no `kind` is also treated as one). |
| `intro` | no  | Markdown shown above the steps (what you need, how long it takes). |
| `steps` | yes | Array of steps, in order. |

Step fields:

| Field     | Required | Meaning |
|-----------|----------|---------|
| `id`      | yes | Unique **within this guide**. Step ticks are saved under game id + guide id + step id, so keep ids stable (a missing id falls back to `step-<n>` with a warning, which breaks if steps are reordered). |
| `title`   | yes | Short: "Part 1: Visor". |
| `where`   | no  | Location, shown as a big location chip. Plain text. |
| `text`    | no  | Markdown: what to do. Write for someone holding a controller: short sentences, button names in `code` (`` `R2` ``). |
| `image`   | no  | Picture shown large (tap to zoom full screen). Path relative to `games/` (see section 5). |
| `alt`     | no  | Describes the picture (shown in the zoom view). Defaults to the step title. |
| `video`   | no  | `https://` link, shown as an **Open clip** button. Use a timestamped link so it opens at the right moment (YouTube: `&t=95s`). |
| `options` | no  | Array of markdown strings: alternative spots / spawn locations, shown as an "Other spots" list. |

What the player gets:

- Guide page: progress (3/9), a big **Follow guide** button, then every step as a card with its own tick box and a "Follow from here" link.
- **Follow mode**: one step per screen, large text, big **Back** and **Done, next** buttons, the picture shown large, swipe left/right to move between steps, the screen kept awake while it's open. It opens at the first unticked step.
- When the last step is ticked, linked checklist items tick themselves (see `autoComplete`).
- Walkthroughs that are started but not finished appear under "Guides in progress" on the Next tab.

---

## 4. Markdown

Used in item `detail`, guide `body`, walkthrough `intro`, step `text` and step
`options`. HTML is never rendered (it shows as text), so it's always safe.

| Write | Get |
|-------|-----|
| `# Heading` … `###### Heading` | Headings (`#` is the biggest; the guide title is above it) |
| `**bold**`, `*italic*` or `_italic_`, `~~strike~~` | Emphasis |
| `` `R2 + Square` `` | Inline code (good for buttons and menu paths) |
| `- item` / `* item`, `1. item` | Lists. Indent by 2+ spaces to nest. |
| `> Tip: …` | Highlighted quote box |
| `---` | Divider |
| ```` ``` ```` fenced block | Code block (shown as is) |
| `\| a \| b \|` + `\|---\|:---:\|` | Table (header row, separator row with optional `:` for alignment; scrolls sideways on phones if wide). Use `\|` for a literal pipe in a cell. |
| `[text](https://…)` | Link (opens in a new tab). Only `http`, `https`, `mailto` and relative links work. |
| `https://example.com` | Bare links become clickable |
| `[text](guide:guide-id)` | Link to another guide in the same game |
| `![description](img/game-id/pic.png)` | Picture (see below) |

A single line break inside a paragraph is kept as a line break. A blank line
starts a new paragraph. In JSON, write line breaks as `\n`.

---

## 5. Pictures

- Put them in `games/img/<game-id>/` and refer to them **relative to the
  `games/` folder**: `"image": "img/bo3-origins/shield-1.jpg"` or
  `![Map](img/bo3-origins/map.png)`. (A leading `games/` or `/` is tolerated.)
  Full `https://` URLs also work but are not saved for offline use.
- png, jpg, webp, gif, svg or avif. Keep them reasonably small (around 1200 px
  wide, under ~300 KB) so they load fast on a phone.
- They never overflow the screen, load lazily, and open full screen when tapped
  (tap again to zoom in).
- A missing or broken picture is simply hidden; the rest of the step still shows.
- Offline: each picture is saved the first time it's viewed. Starting Follow
  mode saves every picture of that walkthrough in the background.

---

## 6. Changing content safely

- **Add** items, steps, guides, sections: always safe.
- **Reorder** anything: safe (ticks follow ids, not positions).
- **Edit** titles, details, text, pictures: safe.
- **Remove** an item / step / guide: its saved tick is ignored (kept in storage,
  harmless; it comes back if the id comes back).
- **Rename an id**: the old tick is lost for that item. Don't, unless intended.
- **Turn a check into a counter** (or back): saved ticks/counts for the other type are ignored.

Ids are case-sensitive and must be unique where stated: game ids across
`index.json`, item ids across the whole game file, guide ids within the game,
step ids within their guide, section ids within the game, group ids within their
section. Duplicates are skipped (the first one wins) and reported by the validator.

The app loads the newest game files whenever it's opened online (and checks
again when it comes back to the foreground), so content updates need no other
step. Only when the **app itself** changes (HTML/CSS/JS/icons) bump `VERSION`
at the top of `sw.js` so installed copies pick up the new app.

---

## 7. Where progress lives (for reference)

Progress is in the browser's localStorage under `gameTracker.progress`, and the
Settings → Export backup file has the same shape:

```json
{
  "app": "game-tracker", "kind": "progress-backup", "schema": 1,
  "exportedAt": "2026-11-15T10:00:00.000Z",
  "games": {
    "sample-game": {
      "checked": { "ch1-wake": 1731664800000 },
      "counts":  { "grind-slimes": 37 },
      "pinned":  { "side-raft": 1731664800000 },
      "steps":   { "rainbow-raft": { "log-1": 1731664800000 } },
      "note": "Saved at the inn", "noteAt": 1731664800000,
      "lastPlayed": 1731664800000, "status": null
    }
  }
}
```

Numbers are timestamps (milliseconds). `status: null` means "use the status
from index.json".

---

## 8. The sample game

`sample-game.json` is a made-up game ("Sample Quest") that uses every feature:
checks, counters, priorities, tags, page guides with tables and pictures,
`guide:` links, and a walkthrough with placeholder pictures in
`img/sample-game/`. Remove it from `index.json` (and delete the files) when the
real games are in.
