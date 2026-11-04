#!/usr/bin/env node
// Corpus driver for a Nirmata world (worlds/<name>/).
// There is no app here — the "running system" is 200+ interlinked markdown
// cards. This is the harness that reaches into it.
//
// Usage:  node .agents/skills/world-lint/driver.mjs <command> [args]
// Commands: check | links | orphans | stats | tree [dir] | show <path> | grep <term> | context <arc.md> | stories | matrix [target]
//
// Multiple stories can live side by side under stories/<name>/; exactly one
// is active (stories/.active_story.json) and every path/command above is
// relative to that story's own root, not the repo root. `stories` lists
// them and marks the active one.

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// skill dir -> .agents/skills/world-lint -> up 3 = unit root
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Worlds live in <repo>/worlds/<name>/ by default. Point WORLDS_DIR (or the
// legacy STORIES_ROOT, whose `stories/` subfolder is used) at an external
// checkout to author against content kept in its own repo.
function resolveWorldsDir() {
  if (process.env.WORLDS_DIR) return resolve(process.env.WORLDS_DIR);
  if (process.env.STORIES_ROOT) return join(resolve(process.env.STORIES_ROOT), 'stories');
  return join(REPO_ROOT, 'worlds');
}
const STORIES_DIR = resolveWorldsDir();
const ACTIVE_STORY_PATH = join(STORIES_DIR, '.active_story.json');
const DEFAULT_STORY = 'example-world';

// Multiple self-contained stories can live side by side under stories/<name>/
// (each its own characters/lore/plot/setting/chapters/.agents tree) -- ROOT
// is a `let` specifically so switching the active one (setActiveStory below)
// takes effect for every importer immediately, the same live-binding trick
// refreshIndex already relies on for FILES/FILESET.
function listStories() {
  if (!existsSync(STORIES_DIR)) return [];
  return readdirSync(STORIES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
    .map((e) => e.name).sort();
}
function loadActiveStoryName() {
  try {
    const saved = JSON.parse(readFileSync(ACTIVE_STORY_PATH, 'utf8')).name;
    if (saved && listStories().includes(saved)) return saved;
  } catch { /* no pointer file yet, or it's stale */ }
  const stories = listStories();
  return stories.includes(DEFAULT_STORY) ? DEFAULT_STORY : (stories[0] || DEFAULT_STORY);
}
function saveActiveStoryName(name) {
  mkdirSync(STORIES_DIR, { recursive: true });
  writeFileSync(ACTIVE_STORY_PATH, JSON.stringify({ name }, null, 2), 'utf8');
}

let activeStoryName = loadActiveStoryName();
// Falls back to the repo root itself if stories/ doesn't exist at all yet
// (e.g. a checkout from before the multi-story split) rather than crashing
// every command on a missing directory.
let ROOT = existsSync(join(STORIES_DIR, activeStoryName)) ? join(STORIES_DIR, activeStoryName) : REPO_ROOT;

function getActiveStoryName() { return activeStoryName; }

function setActiveStory(name) {
  const target = join(STORIES_DIR, name);
  if (!existsSync(target)) throw new Error(`no such story: ${name}`);
  activeStoryName = name;
  ROOT = target;
  saveActiveStoryName(name);
  refreshIndex();
  return name;
}

// Scaffolds a new, empty story with the standard tree every story needs so
// links, cards, arcs, and chapters all have somewhere to live from the
// first save -- the editor's "New Story" action, not something meant to be
// pre-populated with content.
function createStory(name) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error('story name must be lowercase letters, numbers, - or _, starting with a letter or number');
  const target = join(STORIES_DIR, name);
  if (existsSync(target)) throw new Error(`story already exists: ${name}`);
  for (const dir of ['characters', 'lore/world', 'plot/arcs', 'setting', 'chapters', '.agents/rules']) {
    mkdirSync(join(target, dir), { recursive: true });
  }
  setActiveStory(name);
  return name;
}

// Node has no synchronous sleep; Atomics.wait on a scratch SharedArrayBuffer
// is the standard way to block the thread briefly without a busy-loop --
// used only for the short OneDrive-lock retry backoff below.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Renames a story's folder on disk (stories/<oldName>/ -> stories/<newName>/)
// -- a plain directory rename, not a content rewrite, so every card/chapter
// inside is untouched. If the story being renamed is the active one, the
// active pointer and in-memory ROOT move with it so nothing else has to
// know the rename happened.
function renameStory(oldName, newName) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(newName)) throw new Error('story name must be lowercase letters, numbers, - or _, starting with a letter or number');
  const from = join(STORIES_DIR, oldName);
  const to = join(STORIES_DIR, newName);
  if (!existsSync(from)) throw new Error(`no such story: ${oldName}`);
  if (existsSync(to)) throw new Error(`story already exists: ${newName}`);
  // This repo lives inside OneDrive (see resolveStoriesRoot's own comment),
  // which actively opens/syncs files in the background -- a directory
  // rename can transiently fail with EBUSY/EPERM for that reason alone,
  // nothing to do with anything this app itself has open. Retry a few
  // times with a short pause rather than surfacing what's usually a
  // sub-second race as a hard failure.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      renameSync(from, to);
      break;
    } catch (e) {
      const transient = e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES';
      if (!transient || attempt === MAX_ATTEMPTS) throw e;
      sleepSync(150 * attempt);
    }
  }
  if (activeStoryName === oldName) {
    activeStoryName = newName;
    ROOT = to;
    saveActiveStoryName(newName);
    refreshIndex();
  }
  return newName;
}

const SKIP = new Set(['.git', 'node_modules', '.claude']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

let FILES = walk(ROOT).sort();
let FILESET = new Set(FILES.map(rel));

// Re-walks the corpus and swaps FILES/FILESET in place (mutating the array
// rather than only rebinding the local, so live-binding importers — e.g.
// tools/story_editor/server.mjs, which stays running across file creation —
// see new/removed files without a process restart).
function refreshIndex() {
  FILES = walk(ROOT).sort();
  FILESET = new Set(FILES.map(rel));
  inherentWeightCache.clear(); // a card's declared Weight: may have changed since the last read
  return FILES.length;
}

// [text](target) — skip images, absolute urls, anchors, and inline code spans.
// The bracket text is allowed to contain a newline (but not a blank line —
// [^\]] alone would let one `[...]` swallow up to the next `]` anywhere
// later in the file across a paragraph break) because this corpus's own
// prose convention routinely wraps a link's visible text across a line for
// readability, e.g. "[The Pens' breeding\n  mechanics](...)". A stricter
// [^\]\n] previously made every such link invisible to this function
// entirely -- not reported broken, just never seen, silently undercounting
// inbound links/orphans/context-traversal edges for any file using the
// convention (i.e. most of the corpus's own hand-written prose).
const LINK_RE = /(!)?\[([^\]]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function linksIn(file) {
  const src = readFileSync(file, 'utf8').replace(/`[^`\n]*`/g, '');
  const out = [];
  let m;
  while ((m = LINK_RE.exec(src)) !== null) {
    if (m[1]) continue; // image
    if (/\n\s*\n/.test(m[2])) continue; // bracket text spanning a paragraph break is not a real link
    const target = m[3];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    // Collapse the wrapped whitespace back to single spaces for display/
    // matching purposes (e.g. /api/missing-links/apply's literal text
    // search) -- callers shouldn't have to know the source had a line
    // break in the middle of this link's visible text.
    const text = m[2].replace(/\s+/g, ' ').trim();
    out.push({ text, target, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

function resolveTarget(file, target) {
  const clean = target.split('#')[0];
  if (!clean) return null;
  return rel(resolve(dirname(file), decodeURIComponent(clean)));
}

function isDir(p) {
  try { return statSync(resolve(ROOT, p)).isDirectory(); } catch { return false; }
}

// A resolved target with a leading `..` component escaped the active
// story's own root entirely (e.g. a story-side rule card deliberately
// linking to the repo-level README.md, which lives above stories/<name>/,
// not inside any one story). FILESET only ever holds paths under ROOT, so
// this can never be a FILESET hit even when the file genuinely exists --
// checked directly against disk instead, and reported as its own bucket
// rather than counted as broken.
function isExternalFile(p) {
  if (!p.startsWith('..')) return false;
  try { return statSync(resolve(ROOT, p)).isFile(); } catch { return false; }
}

function checkLinks() {
  const broken = [];
  const dirs = [];
  const external = [];
  let total = 0;
  for (const f of FILES) {
    for (const l of linksIn(f)) {
      const t = resolveTarget(f, l.target);
      if (t === null) continue;
      total++;
      if (FILESET.has(t)) continue;
      if (isExternalFile(t)) { external.push({ from: rel(f), line: l.line, target: l.target, text: l.text }); continue; }
      // A link to an existing directory resolves on GitHub but not in an
      // editor. Reported, but not a failure.
      (isDir(t) ? dirs : broken).push({ from: rel(f), line: l.line, target: l.target, text: l.text });
    }
  }
  return { total, broken, dirs, external };
}

function inbound() {
  const map = new Map(FILES.map((f) => [rel(f), 0]));
  for (const f of FILES) {
    for (const l of linksIn(f)) {
      const t = resolveTarget(f, l.target);
      if (t && map.has(t) && t !== rel(f)) map.set(t, map.get(t) + 1);
    }
  }
  return map;
}

function heading(file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  return null;
}

// Rules carry the highest weight there is — a constant, not something any
// rule declares or earns through link count. A rule's inclusion is already
// unconditional (isRule(f) bypasses the core/peripheral filter entirely at
// both call sites below); this makes its *reported* weight consistent with
// that reality instead of showing a misleadingly low link-derived number
// for something that was never actually optional. Rules never read their
// own inherentWeight — this constant always wins for them, full stop.
const RULE_WEIGHT = 1000;

// A card's own declared pull, independent of how many other files happen
// to link to it in one particular traversal — e.g. `* **Weight:** 3` in a
// card's own Attributes block. Link-count weight (below, in both
// cmds.context and contextData) answers "how many paths in *this*
// traversal converge here"; inherent weight answers "how load-bearing is
// this card on its own merits", for a foundational card (a hierarchy/
// ideology card several arcs quietly depend on, say) that a given
// traversal might only reach through one link and would otherwise get
// excerpted as peripheral. The two add together — see wt() at each call
// site. Absent the attribute, a card's inherent weight is 0: opt-in, not
// a default every card has to declare. Not consulted for rule files at
// all — see RULE_WEIGHT above.
const inherentWeightCache = new Map();
function inherentWeight(f) {
  if (inherentWeightCache.has(f)) return inherentWeightCache.get(f);
  let w = 0;
  try {
    const m = readFileSync(join(ROOT, f), 'utf8').match(/^\s*\*\s*\*\*Weight:\*\*\s*(\d+)/m);
    if (m) w = parseInt(m[1], 10);
  } catch { /* unreadable or already gone — treat as no declared weight */ }
  inherentWeightCache.set(f, w);
  return w;
}

const cmds = {
  stories() {
    const active = getActiveStoryName();
    for (const s of listStories()) console.log(s === active ? `* ${s} (active)` : `  ${s}`);
    return 0;
  },

  links() {
    const { total, broken, dirs, external } = checkLinks();
    console.log(`${total} internal links across ${FILES.length} files`);
    for (const d of dirs) console.log(`DIR      ${d.from}:${d.line} -> ${d.target}  [${d.text}]`);
    for (const e of external) console.log(`EXTERNAL ${e.from}:${e.line} -> ${e.target}  [${e.text}]`);
    for (const b of broken) console.log(`BROKEN   ${b.from}:${b.line} -> ${b.target}  [${b.text}]`);
    if (!broken.length) return console.log(`OK — no broken links (${dirs.length} directory links, ${external.length} outside the story root)`), 0;
    console.log(`\n${broken.length} broken`);
    return 1;
  },

  orphans() {
    const map = inbound();
    const orphans = [...map].filter(([, n]) => n === 0).map(([p]) => p).sort();
    console.log(`${orphans.length} files with no inbound link:`);
    for (const o of orphans) console.log(`  ${o}`);
    return 0; // informational — top-level entry points are legitimately orphaned
  },

  stats() {
    let words = 0;
    const byTop = new Map();
    for (const f of FILES) {
      const w = readFileSync(f, 'utf8').split(/\s+/).filter(Boolean).length;
      words += w;
      const top = rel(f).split('/')[0];
      const cur = byTop.get(top) || { files: 0, words: 0 };
      byTop.set(top, { files: cur.files + 1, words: cur.words + w });
    }
    // en-US pinned: bare toLocaleString() renders Devanagari digits under this
    // machine's default locale (Windows hi-IN ICU).
    console.log(`${FILES.length} files, ${words.toLocaleString('en-US')} words\n`);
    for (const [k, v] of [...byTop].sort((a, b) => b[1].words - a[1].words))
      console.log(`  ${k.padEnd(12)} ${String(v.files).padStart(4)} files  ${String(v.words).padStart(7)} words`);
    const missing = FILES.filter((f) => !heading(f)).map(rel);
    if (missing.length) console.log(`\n${missing.length} files with no H1 title:\n  ${missing.join('\n  ')}`);
    return 0;
  },

  tree(sub = '.') {
    const base = rel(resolve(ROOT, sub));
    const hits = FILES.map(rel).filter((p) => base === '.' || p.startsWith(base + '/') || p === base);
    for (const p of hits) console.log(`${p}  —  ${heading(join(ROOT, p)) ?? '(no title)'}`);
    console.log(`\n${hits.length} files`);
    return 0;
  },

  show(p) {
    if (!p) return console.error('usage: show <path>'), 2;
    const f = resolve(ROOT, p);
    console.log(readFileSync(f, 'utf8'));
    const out = linksIn(f).map((l) => `${l.target}${FILESET.has(resolveTarget(f, l.target)) ? '' : '  <-- BROKEN'}`);
    if (out.length) console.log(`\n--- outbound links (${out.length}) ---\n${out.join('\n')}`);
    return 0;
  },

  grep(term) {
    if (!term) return console.error('usage: grep <term>'), 2;
    const re = new RegExp(term, 'i');
    let n = 0;
    for (const f of FILES) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (re.test(line)) { console.log(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 160)}`); n++; }
      });
    }
    console.log(`\n${n} matches`);
    return 0;
  },

  // Clothes/adornment cards must name an owner; object cards must link a
  // character or CG and explain interaction + why-custom (ADR-0033).
  assets() {
    const bad = [];
    const attr = (t, a) => (new RegExp(`\\b${a}="([^"]*)"`).exec(t) || [])[1] || '';
    const part = (t, a) => (new RegExp(`<${a}>([\\s\\S]*?)</${a}>`).exec(t) || [])[1]?.trim() || '';
    for (const f of FILES) {
      const r = rel(f);
      if (r.includes('_template') || !/(^|\/)(clothes|adornments|objects|attire|accessories)\/[^/]+\.md$/.test(r) || r.endsWith('_card.template.md')) continue;
      const text = readFileSync(f, 'utf8');
      const head = /<card[^>]*>/.exec(text)?.[0] || '';
      const kind = attr(head, 'kind'), name = attr(head, 'name');
      if (kind === 'clothes' || kind === 'adornment') {
        if (!attr(head, 'owner') && !/(^|_)naked$/.test(name.toLowerCase())) bad.push(`${r}: ${kind} has no owner`);
      } else if (kind === 'object') {
        if (!attr(head, 'owners') && !attr(head, 'cgs')) bad.push(`${r}: object links no character or CG`);
        if (!part(text, 'interaction')) bad.push(`${r}: object missing <interaction>`);
        if (!part(text, 'why-custom')) bad.push(`${r}: object missing <why-custom>`);
      }
    }
    console.log(bad.length ? bad.map((b) => `  ${b}`).join('\n') : '  ok');
    return bad.length ? 1 : 0;
  },

  check() {
    let code = 0;
    console.log('== stats ==');   code |= cmds.stats();
    console.log('\n== links ==');  code |= cmds.links();
    console.log('\n== orphans =='); code |= cmds.orphans();
    console.log('\n== asset cards =='); code |= cmds.assets();
    console.log('\n== scene matrix =='); code |= cmds.matrix();
    return code;
  },

  // Validates chapter and VN scene state matrices, confirming card links and state designations.
  matrix(target) {
    const chaptersDir = join(ROOT, 'chapters');
    if (!existsSync(chaptersDir)) {
      console.log('  ok (no chapters directory)');
      return 0;
    }

    const VALID_CHAR_STATES = new Set(['base', 'naked', 'disguised', 'transformed', 'custom']);
    const VALID_CLOTH_STATES = new Set(['intact', 'torn', 'altered', 'soiled', 'discarded']);

    let checked = 0;
    let issues = 0;

    let entries = [];
    try {
      entries = readdirSync(chaptersDir, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.name.endsWith('.md')) continue;
      const chapterName = entry.name.replace(/\.md$/, '');
      if (target && chapterName !== target) continue;

      const chapterCardsDir = join(chaptersDir, chapterName, 'cards');
      if (!existsSync(chapterCardsDir)) continue;

      checked++;
      console.log(`Checking scene matrix for chapter: ${chapterName}`);
      const scopedFiles = walk(chapterCardsDir);
      console.log(`  Found ${scopedFiles.length} chapter-scoped card(s)`);

      const indexFile = join(chapterCardsDir, 'index.md');
      if (existsSync(indexFile)) {
        for (const l of linksIn(indexFile)) {
          const t = resolveTarget(indexFile, l.target);
          if (t && !FILESET.has(t) && !isExternalFile(t)) {
            console.log(`  BROKEN LINK in index.md: ${l.target}`);
            issues++;
          }
        }
      }

      for (const f of scopedFiles) {
        const text = readFileSync(f, 'utf8');
        const stateMatch = text.match(/^\s*(?:-\s*)?(?:state|State):\s*["']?([a-zA-Z_-]+)["']?/m);
        if (stateMatch) {
          const st = stateMatch[1].toLowerCase();
          const isCloth = /(?:attire|clothes)/i.test(f);
          const isChar = /(?:character)/i.test(f);
          if (isCloth && !VALID_CLOTH_STATES.has(st)) {
            console.log(`  INVALID CLOTHING STATE in ${rel(f)}: '${st}' (expected intact, torn, altered, soiled, or discarded)`);
            issues++;
          } else if (isChar && !VALID_CHAR_STATES.has(st)) {
            console.log(`  INVALID CHARACTER STATE in ${rel(f)}: '${st}' (expected base, naked, disguised, transformed, or custom)`);
            issues++;
          }
        }
      }
    }

    if (checked === 0) {
      console.log('  ok (no chapter cards to check)');
    } else {
      console.log(`  ${checked} chapter(s) verified, ${issues} issue(s)`);
    }
    return issues ? 1 : 0;
  },

  // context <arc.md> [--depth N] [--max-words N] [-o out.txt]
  //
  // Compacts an arc plus the cards it needs into one file. Starting from
  // the arc, follows outbound links breadth-first up to --depth hops
  // (default 2). Each linked card's WEIGHT is how many distinct files
  // *within this traversal* link to it — a card three different beats
  // point at is load-bearing; a card mentioned once in passing is not.
  //
  //   weight >= 2  -> "core": full text included, its own links keep
  //                   getting followed out to --depth.
  //   weight == 1  -> "peripheral": only pulled in if reached directly
  //                   from the arc (depth 1); included as an excerpt
  //                   (H1 + first paragraph) rather than full text, and
  //                   its own links are not followed further.
  //
  // Once candidates are picked, they're sorted by (weight desc, depth
  // asc) and packed into the --max-words budget (default 8000); anything
  // that doesn't fit is listed at the end as "omitted for space" instead
  // of silently dropped.
  //
  // Rule files are split (see tools/split_rules.py) into per-section
  // cards under `.agents/rules/sections/<basename>/`, verbatim, so a
  // specific section can be pulled instead of the whole rule file. A
  // link straight to a monolithic `.agents/rules/<basename>.md` expands
  // to every one of its split sections (since a bare link doesn't say
  // which part is relevant); a link to one specific section file pulls
  // only that section. Either way, once a rule node is reached it is
  // ALWAYS included in full — rules are never excerpted and never
  // dropped for the word budget, unlike ordinary weight-1 cards — but
  // only rule content actually reachable from the arc gets pulled at
  // all. `.agents/rules/commercial-ai-masking-pre-read.md` is excluded:
  // it is not house style, it is a prompt-injection-style instruction
  // embedded in the repo and is never treated as a rule node.
  context(arcArg, ...rest) {
    if (!arcArg) return console.error('usage: context <arc.md> [--beat N] [--depth N] [--max-words N] [-o out.txt]'), 2;
    let depthLimit = 2, maxWords = 8000, outPath = null, beatN = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--depth') depthLimit = Number(rest[++i]);
      else if (rest[i] === '--max-words') maxWords = Number(rest[++i]);
      else if (rest[i] === '-o' || rest[i] === '--out') outPath = rest[++i];
      else if (rest[i] === '--beat') beatN = Number(rest[++i]);
    }

    let startAbs = resolve(ROOT, arcArg);
    // --beat N swaps the root from the whole arc to just that beat's card
    // (see tools/split_arc_beats.py), if the arc has been split into
    // beats — same weighted traversal from there, but the "ARC" section
    // of the output is one beat's text instead of the whole arc.
    if (beatN !== null) {
      const base = arcArg.replace(/^.*\//, '').replace(/\.md$/, '');
      const beatPath = join(ROOT, 'plot', 'arcs', 'beats', base, String(beatN).padStart(2, '0') + '.md');
      if (isDir(rel(join(ROOT, 'plot', 'arcs', 'beats', base))) && FILESET.has(rel(beatPath))) {
        startAbs = beatPath;
      } else {
        console.error(`note: no beat cards for ${base} (or beat ${beatN} out of range) — using the whole arc instead`);
      }
    }
    const start = rel(startAbs);
    if (!FILESET.has(start)) return console.error(`not found: ${start}`), 2;

    // Split rule cards live flat in .agents/rules/, named
    // <basename_with_underscores>_NN_<slug>.md (see tools/split_rules.py)
    // — matching the convention already established there for
    // canon_bias_cards.md/explicit-lexicon.md, whose monolithic
    // originals no longer exist. A card filename is any rule file whose
    // basename contains an `_NN_` segment; a monolithic file is any
    // other rule file, and a link straight to one fans out to all of
    // its cards, if any exist.
    const EXCLUDED_RULE = '.agents/rules/commercial-ai-masking-pre-read.md';
    const isRule = (f) => f.startsWith('.agents/rules/') && f !== EXCLUDED_RULE;
    const isCard = (f) => isRule(f) && /_\d\d_/.test(f.split('/').pop());
    const isMonolithicRule = (f) => isRule(f) && !isCard(f);
    const sectionsOf = (f) => {
      const base = f.replace(/^\.agents\/rules\//, '').replace(/\.md$/, '');
      const prefix = '.agents/rules/' + base.replace(/-/g, '_') + '_';
      const found = FILES.map(rel).filter((p) => p.startsWith(prefix) && isCard(p)).sort();
      return found.length ? found : null; // unsplit rule (e.g. dark-fantasy.md) — no cards, use as-is
    };

    // BFS, recording the shallowest depth each file is reached at and
    // counting inbound edges from distinct source files as we go. A
    // link to a monolithic rule file fans out into that file's split
    // sections (all at the same depth/weight the monolithic link earned).
    // Rule nodes are always leaves: reachable from an arc or a lore card,
    // but their OWN outbound links are never followed — otherwise the
    // rules hub (linked from nearly every arc) cascades into every other
    // rule file's every card, defeating the point of pulling only what's
    // actually relevant.
    const depthOf = new Map([[start, 0]]);
    const weight = new Map();       // target -> Set of distinct referrers
    const order = [start];          // discovery order, for stable output
    let frontier = [start];
    for (let d = 1; d <= depthLimit && frontier.length; d++) {
      const next = [];
      for (const f of frontier) {
        if (isRule(f)) continue;
        for (const l of linksIn(join(ROOT, f))) {
          const t0 = resolveTarget(join(ROOT, f), l.target);
          if (!t0 || !FILESET.has(t0) || t0 === start || t0 === EXCLUDED_RULE) continue;
          const targets = isMonolithicRule(t0) ? (sectionsOf(t0) || [t0]) : [t0];
          for (const t of targets) {
            if (!weight.has(t)) weight.set(t, new Set());
            weight.get(t).add(f);
            if (!depthOf.has(t)) {
              depthOf.set(t, d);
              order.push(t);
              next.push(t);
            }
          }
        }
      }
      frontier = next;
    }

    const wt = (f) => isRule(f) ? RULE_WEIGHT : (weight.has(f) ? weight.get(f).size : 0) + inherentWeight(f);
    const isCore = (f) => f === start || wt(f) >= 2;
    // Rule nodes bypass the peripheral filter (depth==1 only) too — once
    // reached at all, at any depth, a rule section is relevant.
    const candidates = order.filter((f) => f === start || isCore(f) || isRule(f) || depthOf.get(f) === 1);

    candidates.sort((a, b) => {
      if (a === start) return -1;
      if (b === start) return 1;
      return (wt(b) - wt(a)) || (depthOf.get(a) - depthOf.get(b));
    });

    const excerpt = (text) => {
      const h1 = (text.match(/^# .+$/m) || [''])[0];
      const para = text.split(/\n\n+/).find((p) => p.trim() && !p.startsWith('#')) || '';
      return [h1, para.trim()].filter(Boolean).join('\n\n');
    };

    let words = 0, included = [], omitted = [];
    for (const f of candidates) {
      // Rules are always full text — never excerpted, never dropped for
      // the word budget, since they're standing house style rather than
      // supplementary lore.
      const full = f === start || isCore(f) || isRule(f);
      const text = readFileSync(join(ROOT, f), 'utf8');
      const body = full ? text.trim() : excerpt(text);
      const w = body.split(/\s+/).filter(Boolean).length;
      if (f !== start && !isRule(f) && words + w > maxWords) { omitted.push(f); continue; }
      words += w;
      included.push({ f, body, full, w });
    }

    const parts = included.map(({ f, body, full }) => {
      const d = depthOf.get(f);
      const tag = f === start ? 'ARC' : isRule(f) ? `depth ${d}, weight ${wt(f)}, RULE` : `depth ${d}, weight ${wt(f)}, ${full ? 'full' : 'excerpt'}`;
      return `### ${f}  [${tag}]\n\n${body}`;
    });
    if (omitted.length) {
      parts.push(`### omitted for space (${omitted.length})\n\n` +
        omitted.map((f) => `- ${f}  (depth ${depthOf.get(f)}, weight ${wt(f)})`).join('\n'));
    }

    const out = parts.join('\n\n---\n\n') + '\n';
    const ruleCount = included.filter((c) => isRule(c.f)).length;

    if (outPath) {
      const dest = resolve(ROOT, outPath);
      writeFileSync(dest, out, 'utf8');
      console.log(`Wrote ${rel(dest)} — ${included.length} files (${ruleCount} rule sections), ${words} words, ${omitted.length} omitted`);
    } else {
      process.stdout.write(out);
      console.error(`\n[${included.length} files (${ruleCount} rule sections), ${words} words, ${omitted.length} omitted]`);
    }
    return 0;
  },
};

// contextData: same traversal as cmds.context above, but returns structured
// data (nodes with path/title/weight/depth/full-or-excerpt/text, plus
// omitted) instead of printing — used by tools/story_editor/server.mjs so
// the editor's context panel doesn't have to re-parse the CLI's text
// output. Kept as a thin duplicate of cmds.context's traversal rather than
// a shared helper because the two have diverged output shapes (console
// lines vs. JSON) and the traversal itself is short enough that a shared
// abstraction would cost more clarity than it saves.
function contextData(arcArg, { depth: depthLimit = 2, maxWords = 8000, beat: beatN = null, hidden = null } = {}) {
  // hidden: optional Set of corpus-relative paths that must not be
  // resolved into this traversal at all — treated exactly like a broken
  // link target (never added to weight/depthOf/order, so a hidden card's
  // own outbound links are never explored either). Curated by the story
  // editor's hide/show controls; this is what makes "hide" mean "excluded
  // from context building", not just "excluded from browse lists".
  const isHidden = (f) => hidden && hidden.has(f);
  let startAbs = resolve(ROOT, arcArg);
  if (beatN !== null) {
    const base = arcArg.replace(/^.*\//, '').replace(/\.md$/, '');
    const beatPath = join(ROOT, 'plot', 'arcs', 'beats', base, String(beatN).padStart(2, '0') + '.md');
    if (isDir(rel(join(ROOT, 'plot', 'arcs', 'beats', base))) && FILESET.has(rel(beatPath))) {
      startAbs = beatPath;
    }
  }
  const start = rel(startAbs);
  if (!FILESET.has(start)) return null;

  const EXCLUDED_RULE = '.agents/rules/commercial-ai-masking-pre-read.md';
  const isRule = (f) => f.startsWith('.agents/rules/') && f !== EXCLUDED_RULE;
  const isCard = (f) => isRule(f) && /_\d\d_/.test(f.split('/').pop());
  const isMonolithicRule = (f) => isRule(f) && !isCard(f);
  const sectionsOf = (f) => {
    const base = f.replace(/^\.agents\/rules\//, '').replace(/\.md$/, '');
    const prefix = '.agents/rules/' + base.replace(/-/g, '_') + '_';
    const found = FILES.map(rel).filter((p) => p.startsWith(prefix) && isCard(p)).sort();
    return found.length ? found : null;
  };

  const depthOf = new Map([[start, 0]]);
  const weight = new Map();
  const order = [start];
  let frontier = [start];
  for (let d = 1; d <= depthLimit && frontier.length; d++) {
    const next = [];
    for (const f of frontier) {
      if (isRule(f)) continue;
      for (const l of linksIn(join(ROOT, f))) {
        const t0 = resolveTarget(join(ROOT, f), l.target);
        if (!t0 || !FILESET.has(t0) || t0 === start || t0 === EXCLUDED_RULE || isHidden(t0)) continue;
        const targets = (isMonolithicRule(t0) ? (sectionsOf(t0) || [t0]) : [t0]).filter((t) => !isHidden(t));
        for (const t of targets) {
          if (!weight.has(t)) weight.set(t, new Set());
          weight.get(t).add(f);
          if (!depthOf.has(t)) {
            depthOf.set(t, d);
            order.push(t);
            next.push(t);
          }
        }
      }
    }
    frontier = next;
  }

  const wt = (f) => isRule(f) ? RULE_WEIGHT : (weight.has(f) ? weight.get(f).size : 0) + inherentWeight(f);
  const isCore = (f) => f === start || wt(f) >= 2;
  const candidates = order.filter((f) => f === start || isCore(f) || isRule(f) || depthOf.get(f) === 1);
  candidates.sort((a, b) => {
    if (a === start) return -1;
    if (b === start) return 1;
    return (wt(b) - wt(a)) || (depthOf.get(a) - depthOf.get(b));
  });

  const excerpt = (text) => {
    const h1 = (text.match(/^# .+$/m) || [''])[0];
    const para = text.split(/\n\n+/).find((p) => p.trim() && !p.startsWith('#')) || '';
    return [h1, para.trim()].filter(Boolean).join('\n\n');
  };

  let words = 0, included = [], omitted = [];
  for (const f of candidates) {
    const full = f === start || isCore(f) || isRule(f);
    const text = readFileSync(join(ROOT, f), 'utf8');
    const body = full ? text.trim() : excerpt(text);
    const w = body.split(/\s+/).filter(Boolean).length;
    if (f !== start && !isRule(f) && words + w > maxWords) { omitted.push({ path: f, depth: depthOf.get(f), weight: wt(f) }); continue; }
    words += w;
    included.push({
      path: f,
      title: heading(join(ROOT, f)) || f,
      depth: depthOf.get(f),
      weight: wt(f),
      role: f === start ? 'root' : isRule(f) ? 'rule' : full ? 'core' : 'peripheral',
      full,
      words: w,
      text: body,
    });
  }

  return { start, included, omitted, totalWords: words };
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === resolve(process.argv[1]); } catch { return false; }
}

if (isMain()) {
  const [cmd = 'check', ...args] = process.argv.slice(2);
  if (!cmds[cmd]) {
    console.error(`unknown command: ${cmd}\navailable: ${Object.keys(cmds).join(' | ')}`);
    process.exit(2);
  }
  process.exit(cmds[cmd](...args) || 0);
}

export {
  ROOT, cmds, contextData, refreshIndex,
  walk, rel, linksIn, resolveTarget, isDir, heading, inbound, checkLinks,
  listStories, getActiveStoryName, setActiveStory, createStory, renameStory,
};
// FILES/FILESET are reassigned by refreshIndex(), so export live accessors
// rather than the bindings themselves — a `let`-bound named export still
// updates for importers, but only functions make that update visible
// mid-request without each call site re-importing.
export const getFiles = () => FILES;
export const getFileSet = () => FILESET;
