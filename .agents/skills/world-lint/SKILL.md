---
name: world-lint
description: Run, check, validate, and navigate a Nirmata world (worlds/<name>/ markdown cards). Use when asked to run/check/validate/lint a world, find broken links or orphaned cards, get corpus stats, list or search lore/character/setting cards, or confirm an edit did not break the cross-reference web.
---

# world-lint

> Adapted from the original `run-cuntessa-lore` skill. Numeric baselines quoted below (file/link counts) belong to the old private corpus; run `check` on your own world for current numbers.

This unit is **not an application** — it is a 214-file markdown corpus
(characters, plot arcs, world lore, setting parcels) held together by ~1200
relative cross-reference links. There is no `package.json`, no build, no
server, nothing to launch.

"Running" it therefore means **exercising the link graph**. The harness is
[driver.mjs](.agents/skills/world-lint/driver.mjs) — a zero-dependency
Node script that walks every `.md` file, resolves every internal link, and
reports broken links, orphaned cards, and corpus stats. It's also the
navigation tool: `tree`, `show`, `grep`.

**The repo can hold more than one story side by side, under `stories/<name>/`** (e.g.
`stories/story/`), each its own self-contained `characters/lore/plot/setting/chapters/.agents` tree.
Exactly one is *active* at a time (tracked in `stories/.active_story.json`), and all paths below —
`plot/arcs/...`, `.agents/rules/...`, etc. — are relative to **that active story's own root**, not
the repo root. Run every command from the repo root regardless; the driver resolves against the
active story internally. Use `node .agents/skills/world-lint/driver.mjs stories` to list
stories and see which is active (the story-editor's own picker in its header does this same switch
for the UI).

## Prerequisites

Node ≥ 18 (verified on v24.12.0). Nothing else — no install, no
`node_modules`, no network.

```bash
node --version
```

## Run (agent path)

The whole harness in one command. **Run this after any edit to the corpus.**

```bash
node .agents/skills/world-lint/driver.mjs check
```

Exit code `0` = no broken links. Exit `1` = at least one link points at a
file that does not exist. `check` runs `stats`, `links`, and `orphans` in
sequence.

### Individual commands

```bash
node .agents/skills/world-lint/driver.mjs links
```
Resolves every internal markdown link. Prints `BROKEN <file>:<line> -> <target>`
for dead targets (exit 1) and `DIR ...` for links pointing at a directory
rather than a file (exit 0 — those resolve on GitHub but not in an editor).
Current baseline: **1204 links, 0 broken, 1 DIR.**

```bash
node .agents/skills/world-lint/driver.mjs orphans
```
Files nothing links to. Always exits 0 — top-level entry points are
legitimately orphaned. Current baseline is **13**; see Gotchas for which are
real gaps.

```bash
node .agents/skills/world-lint/driver.mjs stats
```
File/word counts per top-level directory, plus any file missing an H1 title.
Current baseline: **214 files, 80,549 words.**

```bash
node .agents/skills/world-lint/driver.mjs tree setting
```
Every file under a subtree with its H1 title — the fastest way to see what
exists in an area before writing a new card. Omit the argument for the whole
corpus.

```bash
node .agents/skills/world-lint/driver.mjs show setting/tavern.md
```
Prints the card, then lists its outbound links with `<-- BROKEN` markers.
Use this instead of plain Read when you care whether a card's references
still resolve.

```bash
node .agents/skills/world-lint/driver.mjs grep snatchel
```
Case-insensitive line search across the corpus with `path:line:` prefixes.
Catches *prose* mentions of a character or place that are not links — the
thing `links` and `orphans` structurally cannot see.

```bash
node .agents/skills/world-lint/driver.mjs context plot/arcs/10_arc_the_remembered_birth.md
node .agents/skills/world-lint/driver.mjs context plot/arcs/49_arc_the_owed_kill.md --depth 3 --max-words 12000 -o stories/story/sanitized_output/ctx.txt
```
Compacts an arc plus the cards it needs into one file, for handing to a
model as drafting context without loading the whole corpus. Follows the
arc's outbound links breadth-first out to `--depth` hops (default `2`).
Each linked card's **weight** is how many distinct files *within this
traversal* link to it, **plus that card's own declared weight, if it has
one** — a `* **Weight:** N` line anywhere in its own Attributes block
(any trailing text after the number is fine). This is opt-in and rare:
use it on a foundational card a lot of prose quietly depends on but that
any one traversal might only reach through a single link and would
otherwise get excerpted as peripheral — a hierarchy/ideology card, not an
ordinary character or arc. Absent the attribute, a card's own contribution
is 0 and only the link count decides its weight.

- weight ≥ 2 ("core") — full text included, and its own outbound links
  keep getting followed out to `--depth`.
- weight == 1 ("peripheral") — only pulled in if reached directly from
  the arc (depth 1); included as an excerpt (H1 + first paragraph)
  rather than full text, and not expanded further.

A card with declared weight ≥ 2 is always "core" the moment a traversal
reaches it at all, even at the deepest hop and even with no other file in
that traversal linking to it — the one place a card's own declared weight
overrides the ordinary depth/link-count cutoff.

**Rules (`.agents/rules/*.md`) report a fixed weight of `1000`** — a
constant, not something any individual rule declares or earns through
link count, and it always wins over any `* **Weight:** N` a rule file
might otherwise carry. This doesn't change what already got a rule
included (that was already unconditional — see `isRule` in the code); it
just makes the *reported* weight match that reality instead of showing a
misleadingly low link-derived number for something that was never
actually optional, and it means rules always sort first in `context`'s
output.

Candidates are then packed into the `--max-words` budget (default
`8000`) highest-weight-first; anything that doesn't fit is listed at the
end under "omitted for space" rather than silently dropped, so you know
what to pull in by hand if it turns out to matter. Prints to stdout by
default; pass `-o <path>` to write a file instead.

## The workflow that matters

Adding or renaming a card is the operation that breaks this repo. Do it in
this order:

1. `tree <area>` — see the naming convention and what's already there.
2. Write/rename the card.
3. Add it to its index (`lore/world/attire/attire_index.md`,
   `lore/world/jobs/jobs_index.md`, or the relevant parent card).
4. `check` — must exit 0, and the new card must **not** appear in `orphans`.

Step 3 is the one that gets skipped, and `orphans` is how you catch it.

## Gotchas

- **`orphans` output is a mix of signal and noise.** Legitimately orphaned:
  `lore/world/world_index.md` (the root lore entry point), `.AGENT/` and `.agents/`
  (agent instructions, outside the story graph). **Genuine gaps** as of this
  writing: five elemental attire cards (`attire_elemental_fire`,
  `_fire_orifice`, `_light`, `_darkness`, `_snow`) exist on disk but are
  missing from `lore/world/attire/attire_index.md`, which does list the
  water/soot/ashes/swamp cards. Arcs `arc_the_sleep_tenancy` /
  `arc_the_two_circles`.
- **Orphaned ≠ unused.** `characters/stock/mudblood_snatchel.md` has no
  inbound *link*, but Snatchel Barkmire appears by name in
  `plot/lore/world/places/the_pens.md` and `setting/parcels/parcel_upland.md`
  — and the latter links him to `the_pens.md` rather than to his own card.
  Always `grep <name>` before concluding a card is dead.
- **`.agents/rules/dark-fantasy.md` has no H1** and shows up in the `stats`
  "no H1 title" list. That's expected for a rules file, not a defect.
- **The driver counts `.AGENT/` and `.agents/` as corpus files** (3 files,
  ~1.3k words) because they are `.md` under the root. Subtract them when
  quoting story word counts. `.git`, `node_modules`, and `.claude` are
  skipped.
- **Links inside backtick code spans are ignored** — the driver strips
  inline code before scanning, so a literal `[x](y.md)` in an example won't
  be reported as broken.
- **This machine's default ICU locale is hi-IN.** A bare
  `Number.toLocaleString()` renders Devanagari digits (`८०,५४९` instead of
  `80,549`). The driver pins `'en-US'`; do the same in any script you add here.
- **Paths contain spaces** (`NSFW chat bots`). Quote the `cd` target in every
  shell command.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `BROKEN ... -> ../foo/bar.md` after a rename | The link is relative to the *linking* file's directory, not the root. `grep <old-basename>` to find every referrer, then fix each. |
| `DIR ... -> .../gestation/` | A link to a folder, not a file. Point it at a specific card (or the folder's index) if you want it to work outside GitHub. |
| New card doesn't appear in `tree` / `stats` | It isn't `.md`, or it landed under `.claude`/`node_modules`/`.git`, all of which the walker skips. |
| `unknown command: <x>` (exit 2) | Valid commands: `check`, `links`, `orphans`, `stats`, `tree`, `show`, `grep`, `context`. |
