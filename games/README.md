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

A JSON array, one object per game, in the order you like. The home screen shows
the game played most recently (among those you're playing) as a wide banner on
top, with what to do next; the others sit on a shelf of box art below it,
grouped by status (playing, paused, not started, done; most recently played
first within a group).

```json
[
  { "id": "inazuma-eleven-victory-road", "title": "Inazuma Eleven: Victory Road",
    "platform": "Switch", "status": "playing", "accent": "#3fa9f5",
    "cover": "https://cdn.akamai.steamstatic.com/steam/apps/2799860/library_600x900.jpg",
    "hero": "https://cdn.akamai.steamstatic.com/steam/apps/2799860/library_hero.jpg" }
]
```

| Field      | Required | Meaning |
|------------|----------|---------|
| `id`       | yes | Must match the file name: `games/<id>.json`. Letters, numbers, `-`, `_`, `.` only. **Never change it** once used (progress is keyed by it). |
| `title`    | yes | Shown on the home screen and the game's banner. (Wins over a `title` inside the game file.) |
| `platform` | no  | Small grey text, e.g. `"PS5"`. |
| `status`   | no  | `"playing"`, `"paused"`, `"not-started"` (default) or `"done"`. The player can override it in the game menu (**⋯**); this is the default. |
| `accent`   | no  | Hex colour (`"#3fa9f5"` or `"#3af"`): the game's one accent (its tab bar, progress, ticks, main buttons). Very dark colours are lightened automatically. Default `#5ad1c0`. |
| `cover`    | no  | Portrait box art, about **600x900** (2:3), e.g. Steam's `library_600x900.jpg`. Shown on the home shelf. An `https://` link (or a path relative to `games/`, png/jpg/webp/gif/avif). |
| `hero`     | no  | Wide art without text works best, e.g. Steam's `library_hero.jpg` (about 3:1). Shown as the home banner when this is the game played last, and as the banner at the top of the game's tabs. Same rules as `cover`. |

A game can have both pictures, only one, or none:

- Only `cover`: the game's banner crops the cover (keeping its top third); the
  home banner shows it whole over a blurred copy of itself.
- Only `hero`: the shelf shows the hero whole over a blurred copy of itself.
- Neither: plain tiles with the title.

Anything that isn't an `https://` link or a local picture path is ignored with a
warning. A picture that fails to load is hidden. Pictures from other sites are
saved on the device the first time they're shown (see section 5), so the home
screen works offline after one visit.

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
| `layout`   | no  | Which tabs the game gets: `"story"`, `"maps"` or `"loadouts"`, or an object with options. See **2b** below. |
| `sections` | no  | Array of sections (checklist). |
| `guides`   | no  | Array of guides (see section 3). |

### 2b. `layout`: the game's tabs

Inside a game, a **tab bar** at the bottom of the screen (always visible,
in reach of the thumb) switches between the game's areas. The tabs come from
`layout` and from what the file contains; a tab only appears when it has
something to show. The app remembers the last tab opened in each game and
opens on it next time (the first tab the very first time). Each tab's page starts with the game's banner (the
`hero` or `cover` from `index.json`, the title, and the "where I left off"
note if there is one).

Pages opened from a tab (a weapon's camos, a guide, a map) slide in on top
with a back button named after the tab, and the tab stays lit. Back returns
to the same place on the tab. Tapping the lit tab on such a page goes
straight back to the tab; tapping it on the tab itself scrolls to the top.
Follow mode is full screen, without the tab bar.

The **⋯** button (top right) opens the game menu: status, the "where I left
off" note, the full checklist and all guides (when they aren't tabs), search
and settings.

| `layout` | Good for | Tabs |
|----------|----------|------|
| `"story"` (default) | Linear games (Inazuma Eleven) | **Next**: the next item big, with its details, clip links and a big **Done** button (with Undo), then the 4 after it, guides in progress and what you ticked this session. **Checklist** (named by `checklist`): every section and group, with search and All / To do / Done. **Guides**: every guide by category, with search. |
| `"maps"` | Zombies, anything split into maps/areas/regions | **Continue**: the map you're on (the one with the guide you followed last, or the last map opened): a Start/Continue card straight into Follow mode, the map's reference pages ("Session plan"), its walkthroughs in file order as numbered rows (tap = Follow mode), its checklist, and a **Change map** button. **Maps** (named by `picker`): one tile per section, the current one marked; a tile opens that map on top. **Checklist**: the whole checklist. **Guides**: only if some guides belong to no map. The game opens on Continue once you've opened a map, on Maps before that. |
| `"loadouts"` | Shooters (Modern Warfare 4, Black Ops 2) | **Classes**: the class cards (see below) as tiles with the weapon's picture, or as rows with a "built" tick. **Camos** (named by `checklist`): the checklist group picker, straight away: a search box, filter chips (All, Starred, then one per `class`), the groups as picture tiles under their `class` heading with **stars** (starred groups stay on top), and a **Guides** button for guides whose category equals the checklist name (e.g. the levelling guide). A group whose items have pictures opens as a **picture page** (see "Picture lists" below). **Maps**: guides whose category contains "map" ("By map"); a single page guide is shown right on the tab. **Tips**: the "Start here" guides and any other category. The checklist tab is left out when every checklist item is a "built" tick of a class card (Black Ops 2). |

Short form: `"layout": "maps"`. Long form, with options:

```json
"layout": {
  "type": "loadouts",
  "order": ["Start here", "Meta loadouts", "By map"],
  "cards": ["Meta loadouts"],
  "checklist": "Camos",
  "picker": "Maps"
}
```

| Option | Applies to | Meaning |
|--------|-----------|---------|
| `type` | all | `"story"`, `"maps"` or `"loadouts"`. |
| `order` | all | Guide categories in the order to show them (on the tabs and the guide lists). Categories not listed follow in file order. Default for `"loadouts"`: categories starting with "Start", then the class-card categories, then the rest. |
| `cards` | `loadouts` | Guide categories shown as **class cards** (the Classes tab). Default: every category whose name contains "class" or "loadout" (so `"Classes"` and `"Meta loadouts"` work without this option). |
| `checklist` | all | Name of the checklist tab (default `"Checklist"`), e.g. `"Camos"`. Keep it short: it is a tab label. In `"loadouts"`, guides whose `category` equals this name are listed behind that tab's **Guides** button (e.g. a camo table guide with category `"Camos"`). |
| `picker` | `maps` | Name of the map picker tab (default `"Maps"`), e.g. `"Regions"`. |

**No `layout`?** The app guesses: `"loadouts"` if any guide category contains
"class" or "loadout"; `"maps"` if there are 2+ sections and every section has
guides whose category is that section's title; otherwise `"story"`. Writing
`layout` explicitly is clearer and lets the validator check it.

**`"maps"`: how guides find their map.** A guide belongs to the section whose
`title` (or `id`) equals its `category` (case and accents ignored). Keep guides
in **play order** in the file: that is the order on the map page and what
"Continue"/"Next guide" follow. Reference pages (no steps) in a map, such as a
"Session plan", appear above the walkthroughs. Checklist items whose `guide` is
one of the map's walkthroughs are tucked into "All checklist items" (they tick
themselves when the guide is finished); the other items are listed openly.
The validator warns about guides whose category matches no section.

**`"loadouts"`: class card shape.** A class card reads the guide `body`:

```markdown
**Tier S** · SMG · Best for: Hardpoint, Domination, small maps

## ISO Nightshade
| Slot | Attachment |
|---|---|
| Muzzle | FSS Crackdown |
| Barrel | ZLR Carbon-900 |

## Rest of the class
| | |
|---|---|
| Perks | Quick Fix, Blood Rush, Battle Hardened |
| Equipment | Flash Grenade, Frag Grenade |
| Field upgrade | Portable Radar |
```

- First line `**Tier X** · type · Best for: …` → a tier badge, the weapon
  type and a "best for" line. A trailing `(…, tier X)` in the guide title is
  then hidden on the card.
- The first `## heading` names the weapon. When a checklist group with an
  `image` has that name (e.g. the camo group "ISO Nightshade (SMG)"), its
  picture becomes the card's picture: the Classes tab then shows tiles with
  the weapon, and the class page shows it on top. Without pictures the tab
  shows rows.
- Opening a card shows the class page: every **two-column table** becomes a
  label/value list (header row skipped), headed by its `##` heading. Other
  tables and text render normally below. A line like `*Meta as of 14
  November 2026 …*` also shows as "As of 14 November 2026" next to the
  Classes heading.
- Checklist items whose `guide` points at a class card get a round tick on
  its row ("built"), tappable without opening it, and a **Mark as built**
  button on the class page.

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
| `class`  | no (group) | Short text, e.g. `"SMG"`. In a group picker, groups are listed under one heading per class (in file order), each with how many of that class are finished. A trailing `(SMG)` in the title that repeats the class is hidden there and on the group page. |
| `image`  | no (group) | The group's picture, e.g. a weapon icon: a path relative to `games/` or an `https://` link (see section 5). Shown on its picker tile and at the top of the group page, in a wide box (14:5; wide pictures with a dark background look best). |
| `note`   | no (group) | One short line under the name on the group page, e.g. `"Max weapon level 72"`. |
| `tip`    | no (group or item) | On an item: one short line saying where or how to do it (`"Shipment, Hardpoint. Aim at the hill."`), shown under the challenge. On a group: a short markdown tip shown at the top of the group's help pop-up. |
| `help`   | no (group) | Id of a guide. The group page shows a button with that guide's title; tapping it opens the guide as a pop-up. |

Use sections for the big split (Story, Side quests, Collectibles, Camos,
Easter eggs, Reference…) and groups for chapters, maps, weapons, regions…

```json
{ "id": "w-iso-nightshade", "title": "ISO Nightshade (SMG)", "class": "SMG",
  "image": "https://img.example.com/iso-nightshade.png", "note": "Max weapon level 64",
  "items": [ … ] }
```

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
| `image`        | no  | The item's picture, e.g. a camo swatch: a path relative to `games/` or an `https://` link. When any item of a group has one, that group's page becomes a picture page (below). |

### Picture lists (e.g. one weapon's camos)

When items in a group have an `image`, the group page shows, instead of a
list of tick boxes:

1. A header: the group's `image` large, its name, `class`, `note`, and
   done/total with a strip (one cell per item), then the `help` button.
2. A two-way switch that stays at the top while you scroll: **Do now** and
   **All camos** (named after the checklist; "Everything" by default). The
   app remembers which one you used last. Groups without level steps or a
   chain only have the grid.
3. **Do now**: the next level to reach, every unfinished challenge, and the
   next chain item, each as a card with the challenge in big text and a big
   **Done** button. A chain item whose prerequisite isn't met yet shows as
   locked, with its prerequisite line and an **I have it** button.
4. **All camos**: a **picture grid** of every item, in sections by each
   item's **first tag** (in order of appearance, capitalised: `"military"`
   → Military). Done items are in full colour with a tick; missing ones are
   greyed out with their level (or a lock). Tapping a picture opens a sheet
   with the picture, the full challenge and **Done** ("I already have this"
   when it shows as locked) or "Mark as not done".

**Ticking adds up.** Marking an item done also marks everything that must
have come before it in the group, and the message says what else was ticked,
with one **Undo** that puts every item back exactly as it was:

- a level step ticks the lower level steps;
- a challenge with `Opens at weapon level N` ticks the level steps up to N;
- a chain item ticks every level step and every open challenge of the group
  and the chain items before it: Gold ticks the 8 military and 3 special
  camos, Platinum also ticks Gold, Harmonic Break ticks all 13 before it.

Marking an item as not done only changes that one item.

The item `detail` is read paragraph by paragraph (separate paragraphs with a
blank line, `\n\n` in JSON); the markdown itself is shown as written:

| Paragraph | Read as |
|-----------|---------|
| `Reach weapon level 26.` (or `Reach level 26.`) | A **level step**. Levels add up (see above); the lowest unticked one is "Do now". |
| `**Multiplayer:** 50 Player Kills while Aiming Down Sights` | A **challenge line**. The first one is shown big; the others (e.g. `**DMZ:** …`) smaller underneath. |
| `Opens at weapon level 46.` | Shown as a note on the challenge (and as `Lv 46` on the greyed picture). Ticking the challenge also ticks the level steps up to 46. |
| First paragraph starting with `First …` (`First unlock this weapon's 3 special camos.`) | A **prerequisite**: the item is part of a **chain** unlocked in file order. The first chain item waits for every other non-level item of the group (e.g. the 3 special camos); each next one waits for the one before. When the line names a number ("First get Gold on 8 Assault Rifles", "on all 33 weapons", "on both shotguns"), the app also counts how many groups of the same `class` (or of the whole section, for a bigger number) have the previous chain item ticked: "3/8". Locks are a guide only: everything can still be ticked, directly ("I have it"), and ticking it also ticks what comes before it. |
| Anything else | Shown as normal text in the sheet. |

```json
{ "id": "iso-nightshade-sp-1", "title": "Asphalt", "tags": ["special"],
  "image": "https://img.example.com/asphalt.webp", "guide": "camo-ladder",
  "detail": "**Multiplayer:** 50 Player Kills while Aiming Down Sights\n\n**DMZ:** 125 Kills while Aiming Down Sights" }
```

A group whose pictured items have no level steps and no chain (e.g. a
collectibles list with photos) gets the header and the picture grid only.
Groups without any item pictures keep the normal list.

### How the "Next" list is chosen

The story layout's **Up next** card and the 4 items after it (and the "Next"
line on the home screen) come from this list:

1. Items the player **pinned**, in the order they were pinned (not done ones only).
2. Then unfinished items sorted by `priority` (lower first; items without a
   priority come after every item that has one), then by **file order**.

So for a story game you can leave `priority` out entirely and just keep the
file in play order. Add `priority` only to pull something forward (a missable,
a time-limited event, "do this before the boss").

The Up next card names the item's group and how far you are in it
("Chapter 3 · 5/21").

---

## 3. Guides

Every guide has `id` (unique within the game), `title`, and optional
`category` (guides are grouped by category; with `"layout": "maps"` the
category is the map's section title, with `"loadouts"` it decides class card
vs. page, see 2b). There are two kinds.

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
      "video": "https://www.youtube.com/watch?v=XXXXXXXXXXX&t=95s", "videoEnd": 118,
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
| `video`   | no  | A YouTube link **with the start time**: `https://www.youtube.com/watch?v=<11-character id>&t=<seconds>s` (`youtu.be/<id>?t=95` and `&t=1m35s` also work). It plays **inside the app** as a clip that starts there. Any other `https://` link is shown as an **Open clip** button that leaves the app. |
| `videoEnd` | no | Number of seconds (a JSON number, not a string): the position **in the whole video** where the useful part ends, e.g. `"video": "…&t=95s", "videoEnd": 118` plays 1:35 to 1:58 (23 s). Must be greater than the start; the validator warns otherwise. Leave it out and the clip plays on from the start. |
| `options` | no  | Array of markdown strings: alternative spots / spawn locations, shown as an "Other spots" list. |

How clips play: each step shows a light poster (the video thumbnail, a play
button and the clip length). One tap plays just that segment, **muted** (phones
only autoplay muted; the player's own button unmutes), inline on the page. At
the end the clip stops and offers **Replay** and **Keep watching** (continues
past `videoEnd`). A small "Open in YouTube" link stays under every clip for
videos whose owner blocks embedding. Nothing loads from YouTube until a clip is
played, apart from the thumbnails. Clips need an internet connection; they are
never saved for offline use.

What the player gets:

- Guide page: progress (3/9), a big **Follow guide** button, then every step as a card with its own tick box, its clip and a "Follow from here" link.
- **Follow mode**: one step per screen, read top to bottom as *where* (big location chip), the title, the **clip**, the short text, then the picture and other spots. Big **Back** and **Done, next** buttons at the bottom, a segment per step in the progress bar, a step list behind the list button, swipe left/right to move between steps, the screen kept awake while it's open. It opens at the first unticked step. After the last step it offers the **next guide** of the same map (or category).
- When the last step is ticked, linked checklist items tick themselves (see `autoComplete`).
- Walkthroughs that are started but not finished appear under "Guides in progress" on the Next tab (story) or on the tab that lists them.

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
| `[▶ Watch this match](https://www.youtube.com/watch?v=<id>&t=6625s)` | A **YouTube link becomes a clip button**: tapping it opens the player right under that line, inside the app, starting at `t`. A leading ▶ in the text is dropped (the button has its own icon). Add `&end=<seconds>` to stop the clip there, like `videoEnd`. |
| `https://example.com` | Bare links become clickable (bare YouTube links become clip buttons) |
| `[text](guide:guide-id)` | Link to another guide in the same game |
| `![description](img/game-id/pic.png)` | Picture (see below) |

A single line break inside a paragraph is kept as a line break. A blank line
starts a new paragraph. In JSON, write line breaks as `\n`.

---

## 5. Pictures

- Put them in `games/img/<game-id>/` and refer to them **relative to the
  `games/` folder**: `"image": "img/bo3-origins/shield-1.jpg"` or
  `![Map](img/bo3-origins/map.png)`. (A leading `games/` or `/` is tolerated.)
- Or use a full **`https://`** link to a picture on another site, anywhere a
  picture is allowed (step `image`, group `image`, item `image`, `![…](…)`,
  and `cover` / `hero` in `index.json`).
  `http://` links and other schemes are ignored (the validator warns), and the
  page never sends its address to the other site (no referrer).
- Local files: png, jpg, webp, gif, svg or avif. Keep them reasonably small
  (around 1200 px wide, under ~300 KB) so they load fast on a phone.
- They never overflow the screen and load lazily. Step and markdown pictures
  open full screen when tapped (tap again to zoom in); group and item pictures
  sit in fixed-size boxes so nothing jumps while they load.
- A missing or broken picture is hidden (step and markdown pictures) or
  replaced by a placeholder with the name's initials (group and item pictures).
- Offline: each picture is saved the first time it's viewed. Starting Follow
  mode saves every picture of that walkthrough in the background. Pictures
  from other sites are saved too (up to 400, oldest dropped first) and shown
  from the saved copy from then on, so a weapon's camo grid is instant on
  reopen and works on a bad connection. YouTube clips and posters are never
  saved.

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
      "lastPlayed": 1731664800000, "status": null,
      "starred": { "camos/w-m4": 1731664800000 },
      "lastSection": "der-eisendrache", "lastGuide": "de-bow-guide"
    }
  }
}
```

Numbers are timestamps (milliseconds). `status: null` means "use the status
from index.json". `starred` (checklist groups starred in a picker, keyed
`<sectionId>/<groupId>`), `lastSection` (last map opened) and `lastGuide` (last
walkthrough followed) were added later and are optional: older saves and
backups without them load as before, so the schema is still 1.

The last tab opened in each game is kept separately, in `gameTracker.meta`
(`"tabs": { "<gameId>": "<tab>" }`, with the last backup date). It is not
part of backups: losing it only means a game opens on its first tab.

---

## 8. The sample game

`sample-game.json` is a made-up game ("Sample Quest") that uses every feature:
checks, counters, priorities, tags, page guides with tables and pictures,
`guide:` links, and a walkthrough with placeholder pictures in
`img/sample-game/`. Remove it from `index.json` (and delete the files) when the
real games are in.
