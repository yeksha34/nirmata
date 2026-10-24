#!/usr/bin/env node
// Local authoring editor for the corpus: storyboard/arc/card browser,
// compacted-context panel, preview reader, an AI-operations queue
// (extract-cards / contradiction checks — see ops/README below), and
// read-mostly git integration. Backed by the same traversal logic as
// .agents/skills/world-lint/driver.mjs (imported as a module).
//
// Usage: node tools/story_editor/server.mjs [--port 8787]
// Then open http://localhost:8787/ in a browser.
//
// Write surface:
//  - /api/ops/create just writes a JSON job file under
//    state/<story>/ops/queue/ — no corpus file is touched.
//  - /api/ops/apply-card creates a NEW file only, only under
//    characters|lore|setting|plot/arcs, and refuses to overwrite.
//  - /api/save writes an EXISTING corpus .md file's content — this is the
//    point of the tool (correct a card/chapter in place with its context
//    on screen), so it's intentionally not path-restricted beyond "must
//    already be a real corpus file"; it's local-only, single-user, and
//    every write is one you triggered by clicking Save.
//  - /api/git/stage runs `git add`; /api/git/commit runs `git add` + `git
//    commit` — both only in direct response to a button click in the UI,
//    i.e. an explicit local user action, never triggered automatically.
// Everything else is read-only.

import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir, networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  ROOT, contextData, refreshIndex, getFiles, getFileSet,
  rel, linksIn, resolveTarget, heading, inbound, checkLinks,
  listStories, getActiveStoryName, setActiveStory, createStory, renameStory,
} from '../../.agents/skills/world-lint/driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, 'assets');
mkdirSync(ASSETS_DIR, { recursive: true });
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

// --- Mistral live prose integration ---
// Used ONLY for the two prose-writing ops (draft-chapter, reformat) — never
// for extract-cards/contradictions-*, which stay on the manual Claude-worker
// queue per ops/README.md. Credentials live in a gitignored local file
// (never commit an API key) or the MISTRAL_API_KEY/MISTRAL_AGENT_ID env
// vars, which take precedence when set.
const MISTRAL_CONFIG_PATH = join(HERE, 'state', 'mistral.local.json');
const MISTRAL_AGENTS_API = 'https://api.mistral.ai/v1/agents/completions';
let mistralConfig = null;
function loadMistralConfig() {
  let fromFile = null;
  try { fromFile = JSON.parse(readFileSync(MISTRAL_CONFIG_PATH, 'utf8')); } catch { /* no local config yet */ }
  mistralConfig = {
    apiKey: process.env.MISTRAL_API_KEY || fromFile?.apiKey || null,
    agentId: process.env.MISTRAL_AGENT_ID || fromFile?.agentId || null,
  };
}
loadMistralConfig();
function mistralReady() { return !!(mistralConfig?.apiKey && mistralConfig?.agentId); }

// Cumulative usage this server process — Mistral has no account-quota
// endpoint, so this is a running total of what's actually been spent since
// the server started, which is what the header indicator shows.
const mistralUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, lastError: null, lastAt: null };

async function callMistralAgent(userContent) {
  if (!mistralReady()) throw new Error('Mistral not configured — see tools/story_editor/state/mistral.local.json');
  let resp, data;
  try {
    resp = await fetch(MISTRAL_AGENTS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mistralConfig.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: mistralConfig.agentId, messages: [{ role: 'user', content: userContent }] }),
    });
    data = await resp.json();
  } catch (e) {
    mistralUsage.lastError = e.message; mistralUsage.lastAt = new Date().toISOString();
    throw e;
  }
  if (!resp.ok) {
    const msg = data?.message || data?.error?.message || `Mistral HTTP ${resp.status}`;
    mistralUsage.lastError = msg; mistralUsage.lastAt = new Date().toISOString();
    throw new Error(msg);
  }
  const usage = data.usage || {};
  mistralUsage.promptTokens += usage.prompt_tokens || 0;
  mistralUsage.completionTokens += usage.completion_tokens || 0;
  mistralUsage.totalTokens += usage.total_tokens || 0;
  mistralUsage.calls += 1;
  mistralUsage.lastError = null;
  mistralUsage.lastAt = new Date().toISOString();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Mistral returned no content');
  return (typeof content === 'string' ? content : String(content)).trim();
}

// Local model fine-tuned only on stories-repo's .agents/rules cards (see
// the sibling rules-gatekeeper repo) — never on chapters or other cards.
// Served through Ollama the same way tools/rewrite_chapter_mistral.py's
// query_ollama() does, under the model name `ollama create` registers it as.
const RULES_MODEL_API = process.env.RULES_MODEL_API || 'http://localhost:11434/api/generate';
const RULES_MODEL_NAME = process.env.RULES_MODEL_NAME || 'rules-gatekeeper';
// /api/chat sibling of RULES_MODEL_API, for the decomposed (multi-turn)
// judge mode -- see callJudgeModelChat() and runRulesEnsemble's
// `decomposed` option.
const RULES_MODEL_CHAT_API = process.env.RULES_MODEL_CHAT_API || RULES_MODEL_API.replace(/\/api\/generate$/, '/api/chat');

// Node's built-in fetch (backed by undici) applies a default 5-minute
// headers timeout that a plain fetch() call cannot override without
// pulling in the 'undici' package as a dependency -- this project is
// deliberately zero-dependency. Confirmed by testing: a real judge call on
// a large card (~9k tokens, decomposed mode) took 521s on this CPU-only
// hardware and fetch() killed it as "fetch failed" even though the model
// was still working -- the same request via curl (no default timeout)
// succeeds. This helper uses node:http directly, which has no default
// timeout, to avoid that ceiling for the judge-model calls specifically.
function postJson(url, bodyObj, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = httpRequest({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = { error: `non-JSON response: ${raw.slice(0, 200)}` }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed });
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`request timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callRulesModel(instruction) {
  let resp, data;
  try {
    resp = await fetch(RULES_MODEL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: RULES_MODEL_NAME, prompt: instruction, stream: false }),
    });
    data = await resp.json();
  } catch (e) {
    throw new Error(`rules-gatekeeper unreachable at ${RULES_MODEL_API}: ${e.message}`);
  }
  if (!resp.ok) throw new Error(data?.error || `rules-gatekeeper HTTP ${resp.status}`);
  if (!data.response) throw new Error('rules-gatekeeper returned no content');
  return data.response.trim();
}

// Strips the reasoning/meta wrapper some Mistral agents emit before the
// actual answer, mirroring tools/rewrite_chapter_mistral.py's strip_wrapper.
function stripMistralWrapper(raw) {
  return raw
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/^<think>[\s\S]*/i, '')
    .replace(/^(Here is|Here's|Rewrite|Output|Done\.?)\s*:?\s*\n?/im, '')
    .replace(/^```(?:markdown)?\n/, '')
    .replace(/\n```$/, '')
    .trim();
}

// --- per-story tool state ---
// hidden.json, board_layout.json, and the ops queue are all *tool* state
// about a specific story (which cards are hidden, where board nodes sit,
// pending drafting jobs), not corpus content -- so each lives under its
// own story's namespace here rather than one shared file the active story
// happens to overwrite when you switch. Computed as functions (not
// constants) because the active story can change mid-process via
// /api/stories/select.
const STATE_DIR = join(HERE, 'state');
function storyStateDir() { return join(STATE_DIR, getActiveStoryName()); }
function hiddenPath() { return join(storyStateDir(), 'hidden.json'); }
function remarksPath() { return join(storyStateDir(), 'remarks.json'); }
function loadRemarks() { try { return JSON.parse(readFileSync(remarksPath(), 'utf8')); } catch { return {}; } }
function boardLayoutPath() { return join(storyStateDir(), 'board_layout.json'); }
function queueDir() { const d = join(storyStateDir(), 'ops', 'queue'); mkdirSync(d, { recursive: true }); return d; }
function resultsDir() { const d = join(storyStateDir(), 'ops', 'results'); mkdirSync(d, { recursive: true }); return d; }

// --- hidden registry ---
// Curated exclusion list: hidden items drop out of browse listings AND,
// critically, out of context-building (contextData's `hidden` option,
// wired in below) -- a hidden card is invisible to the weighted traversal
// even though other cards still literally link to it, same as if the link
// were broken. Direct access (loading it by path, editing, un-hiding it)
// still works; it's excluded from discovery and from link resolution, not
// deleted or made inert.
let hiddenSet = new Set();
function loadHidden() {
  try { hiddenSet = new Set(JSON.parse(readFileSync(hiddenPath(), 'utf8')).paths || []); }
  catch { hiddenSet = new Set(); }
}
function saveHidden() {
  mkdirSync(storyStateDir(), { recursive: true });
  writeFileSync(hiddenPath(), JSON.stringify({ paths: [...hiddenSet].sort() }, null, 2), 'utf8');
}
loadHidden();

// --- storyboard graph layout ---
// Node x/y are purely a visualization convenience (the board's own saved
// canvas positions), tracked in the tool's local dir, not the corpus --
// dragging a node around never touches a corpus file. Only *drawing a new
// connection* (see /api/relations/add below) writes anything real, because
// a connection is a claim about the corpus's actual link graph, which is
// exactly what /api/context traverses.
function loadBoardLayout() {
  try { return JSON.parse(readFileSync(boardLayoutPath(), 'utf8')); }
  catch { return { positions: {} }; }
}
function saveBoardLayout(layout) {
  mkdirSync(storyStateDir(), { recursive: true });
  writeFileSync(boardLayoutPath(), JSON.stringify(layout, null, 2), 'utf8');
}

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i !== -1 ? Number(process.argv[i + 1]) : 8787;
})();
// Off by default (repeated test runs from a dev shell shouldn't pop a
// browser tab each time) — start_editor.bat passes --open explicitly so
// the double-click launcher needs only one window total: this process
// opens the browser itself once it's actually listening, instead of the
// .bat guessing a delay and spawning a second window to do it.
const AUTO_OPEN = process.argv.includes('--open');

// The address to type into the mobile app's "Sync with desktop editor"
// field (see LanSync.kt there) -- this server already listens on all
// interfaces (server.listen(PORT) with no host arg defaults to that), so
// the only missing piece is telling the user which LAN IP that actually
// is. Picks the first non-internal IPv4 -- good enough for the common
// single-NIC-on-Wi-Fi case this feature is for; a machine with several
// active adapters may need the other one instead.
function lanAddress() {
  const nets = networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4' && !iface.internal) return `${iface.address}:${PORT}`;
    }
  }
  return null;
}

const ARC_ORDER_RE = /^(\d+(?:\.\d+)?)_/;

// Directories a new card is allowed to be created in via /api/ops/apply-card.
const CREATABLE_DIRS = ['characters/', 'lore/', 'setting/', 'plot/arcs/'];

// Grabs the text under a "## <heading>" line up to the next "## " heading
// (or end of file). Line-index based rather than a lookahead regex because
// this corpus uses CRLF and a naive `$`/lookahead regex treats a blank
// line as satisfying the "end" condition too early.
function extractSection(text, headingName) {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim() === `## ${headingName}`);
  if (startIdx === -1) return '';
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  return lines.slice(startIdx + 1, endIdx).join('\n').trim();
}
// ---- portrait/emotion box ----
// A character's expression is chosen from the text actually on screen, not
// fixed per file. assets/portraits/<character-slug>/<emotion>.<ext> holds
// one image per expression for that character; which character and which
// expression get picked is worked out fresh from whatever prose/card is
// currently loaded.
const PORTRAITS_DIR = join(ASSETS_DIR, 'portraits');
mkdirSync(PORTRAITS_DIR, { recursive: true });

// Lexical scoring, same spirit as the highlight heuristic elsewhere in this
// file: count hits per category, highest wins, ties/all-zero -> neutral.
// Categories match the art actually provided per character (see
// assets/portraits/cuntessa_cuntswell/) rather than an invented taxonomy —
// add a category here only once there's a file for it somewhere, otherwise
// it can only ever lose to something with real art behind it.
const EMOTION_LEXICON = {
  angry: ['snarl', 'seethe', 'rage', 'fury', 'furious', 'spat', 'spit', 'shaking with anger', 'struck', 'backhand', 'shouted', 'roared'],
  sneer: ['sneer', 'contempt', 'beneath her', 'disdain', 'scorn', 'curled her lip', 'a look reserved for', 'imperious', 'command'],
  amused: ['smirk', 'amused', 'chuckle', 'laugh', 'wry', 'quirked', 'dry amusement', 'raised an eyebrow'],
  sulky: ['pout', 'pouted', 'sulk', 'sulky', 'sulking', 'petulant', 'crossed her arms', 'muttered sourly'],
  afraid: ['afraid', 'fear', 'terror', 'trembling', 'flinched back', 'eyes wide with fear', 'dread', 'cowered'],
  pained: ['wince', 'winced', 'flinch', 'flinched', 'cried out in pain', 'ached', 'throbbed with pain', 'hissed in pain', 'gritted her teeth'],
  aroused: ['wet', 'ache', 'aching', 'breath caught', 'hungry', 'want', 'hips', 'flushed', 'dripping', 'moan'],
  aroused_crying: ['tears slipping', 'sobbed as she came', 'crying out as', 'overwhelmed, tears', 'tears streaking'],
  sad_crying: ['sob', 'sobbing', 'weep', 'weeping', 'tears', 'cried', 'crying', 'choked back a sob'],
  joy_crying: ['tears of joy', 'laughing through tears', 'overjoyed', 'wept with relief', 'happy tears'],
  ahegao: ['eyes rolled back', 'tongue lolling', 'mindless with pleasure', 'drooling', 'fucked stupid', 'utterly undone'],
};

function scoreEmotions(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [emotion, words] of Object.entries(EMOTION_LEXICON)) {
    let n = 0;
    for (const w of words) {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      n += (lower.match(re) || []).length;
    }
    if (n) scores[emotion] = n;
  }
  return scores;
}

// Tittiana's own persona, selected by which of her forms the loaded text
// is actually describing — kitsune / wyvern / chimera / the held
// human-seeming default — per Lineage & Forms
// (characters/tittiana_forms.md). Distinct axis from Cuntessa's
// emotion-based selection below: Cuntessa is a mood responding to the
// text, Tittiana is a body, and which body she's in is what the art
// needs to track for her.
const TITTIANA_SLUG = 'tittiana_titsworth';
const TITTIANA_FORM_LEXICON = {
  chimera: ['chimera', 'all three', 'natural state', 'unbound', 'binding thinned', 'binding eased'],
  wyvern: ['wyvern', 'wings', 'winged', 'hind legs', 'talons', 'draconic', 'leathery', 'serpentine scaling', 'scales'],
  kitsune: ['kitsune', 'muzzle', 'fox ears', 'vixen', 'fangs', 'tail flicked', 'kitsune tail'],
};
function scoreForms(text, lexicon) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [form, words] of Object.entries(lexicon)) {
    let n = 0;
    for (const w of words) {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      n += (lower.match(re) || []).length;
    }
    if (n) scores[form] = n;
  }
  return scores;
}
// No standalone art for the held human-seeming default yet, so
// kitsune-upright — closest to how she actually stands day to day —
// is the stand-in until a dedicated default portrait exists.
function resolveTittianaPortrait(text) {
  const scores = scoreForms(text, TITTIANA_FORM_LEXICON);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const form = ranked.length ? ranked[0][0] : 'default';
  const base = form === 'default' ? `${TITTIANA_SLUG}_kitsune_upright` : `${TITTIANA_SLUG}_${form}`;
  const found = findAssetFile(`portraits/${TITTIANA_SLUG}/${base}`)
    || findAssetFile(`portraits/${TITTIANA_SLUG}/${TITTIANA_SLUG}`);
  let url = found ? `/assets/${found}` : null;
  if (!url) {
    try {
      const dir = join(PORTRAITS_DIR, TITTIANA_SLUG);
      const any = readdirSync(dir).find((f) => IMAGE_EXTS.includes(('.' + f.split('.').pop()).toLowerCase()));
      if (any) url = `/assets/portraits/${TITTIANA_SLUG}/${any}`;
    } catch { /* no art yet */ }
  }
  if (!url) return null;
  return { url, character: 'Tittiana Titsworth', slug: TITTIANA_SLUG, form, scores, hasFormArt: !!found };
}

function portraitCharacters() {
  let dirs;
  try { dirs = readdirSync(PORTRAITS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()); }
  catch { return []; }
  return dirs.map((d) => {
    const slug = d.name;
    const match = getFiles().map(rel).find((f) => f.startsWith('characters/') && f.replace(/^.*\//, '').replace(/\.md$/, '') === slug);
    const name = match ? (heading(join(ROOT, match)) || slug) : slug.replace(/_/g, ' ');
    return { slug, name, cardPath: match || null };
  });
}

// Which of the characters with a portrait set is this text actually about
// — the one whose name (first-name-only match is enough; "Cuntessa" hits
// "Cuntessa Cuntswell") appears most.
// A single incidental mention (e.g. "Cuntswell" pulling in Cuntessa
// Cuntswell just because the house is named after her, on a card that
// isn't about her at all) shouldn't be enough to put her portrait up --
// with only one or two characters having art so far, that made it look
// like whichever of them happens to be namesake-adjacent was "responding"
// on nearly every card in the corpus. Require a minimum mention count
// before attributing the box to anyone specific; below that, it's nobody
// (falls through to the generic default).
const MIN_MENTIONS_TO_DETECT = 3;

function detectCharacter(text, characters) {
  const lower = text.toLowerCase();
  let best = null, bestCount = 0;
  for (const c of characters) {
    const firstName = c.name.split(/\s+/)[0].toLowerCase();
    const re = new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const n = (lower.match(re) || []).length;
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return (best && bestCount >= MIN_MENTIONS_TO_DETECT) ? { ...best, mentions: bestCount } : null;
}

// Generic placeholder at assets/portraits/_default.<ext> — the terminal
// fallback for resolvePortrait below. Whatever reason a specific portrait
// couldn't be resolved (no character detected, or a detected character
// with no art at all yet), a null url falls through to this rather than
// the box just hiding, as long as this file exists.
// Cuntessa is the tool's persistent default persona — the portrait box
// shows her (neutral) whenever nothing more specific is detected, rather
// than a generic placeholder. assets/portraits/_default.* still overrides
// this if ever wanted; without it, falls through to her folder directly.
const DEFAULT_PERSONA_SLUG = 'cuntessa_cuntswell';
const DEFAULT_PERSONA_NAME = 'Cuntessa Cuntswell';

function defaultAvatar() {
  const explicit = findAssetFile('portraits/_default');
  if (explicit) return { url: `/assets/${explicit}`, character: null, emotion: null, hasEmotionArt: false };
  const neutral = findAssetFile(`portraits/${DEFAULT_PERSONA_SLUG}/neutral`);
  if (neutral) return { url: `/assets/${neutral}`, character: DEFAULT_PERSONA_NAME, slug: DEFAULT_PERSONA_SLUG, emotion: 'neutral', hasEmotionArt: true };
  try {
    const dir = join(PORTRAITS_DIR, DEFAULT_PERSONA_SLUG);
    const any = readdirSync(dir).find((f) => IMAGE_EXTS.includes(('.' + f.split('.').pop()).toLowerCase()));
    if (any) return { url: `/assets/portraits/${DEFAULT_PERSONA_SLUG}/${any}`, character: DEFAULT_PERSONA_NAME, slug: DEFAULT_PERSONA_SLUG, emotion: null, hasEmotionArt: false };
  } catch { /* persona folder doesn't exist yet */ }
  return { url: null, character: null, emotion: null, hasEmotionArt: false };
}

// Cuntessa is the persistent default persona responding to whatever's
// being written or read — the portrait falls back to her, by emotion,
// whenever nothing more specific is detected. Tittiana is the one
// character promoted past that default: when detectCharacter() finds the
// loaded text is actually about her, the box switches personas entirely
// and resolves by *form* instead of emotion, per
// resolveTittianaPortrait() above. Any other character in
// portraitCharacters() with an art folder but no dedicated resolver here
// still falls through to Cuntessa, same as before this existed.
function resolvePortrait(corpusPath) {
  const text = readFileSync(join(ROOT, corpusPath), 'utf8');

  const detected = detectCharacter(text, portraitCharacters());
  if (detected && detected.slug === TITTIANA_SLUG) {
    const tittiana = resolveTittianaPortrait(text);
    if (tittiana) return tittiana;
    // Detected her but no art resolved (folder missing/empty) — fall
    // through to Cuntessa rather than showing nothing.
  }

  const scores = scoreEmotions(text);
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const emotion = ranked.length ? ranked[0][0] : 'neutral';

  const dir = join(PORTRAITS_DIR, DEFAULT_PERSONA_SLUG);
  const found = findAssetFile(`portraits/${DEFAULT_PERSONA_SLUG}/${emotion}`)
    || findAssetFile(`portraits/${DEFAULT_PERSONA_SLUG}/neutral`);
  let url = found ? `/assets/${found}` : null;
  if (!url) {
    // No file for the chosen emotion or neutral — grab whatever's there so
    // the box still shows her rather than nothing.
    try {
      const any = readdirSync(dir).find((f) => IMAGE_EXTS.includes(('.' + f.split('.').pop()).toLowerCase()));
      if (any) url = `/assets/portraits/${DEFAULT_PERSONA_SLUG}/${any}`;
    } catch { /* persona folder doesn't exist yet */ }
  }
  if (!url) return { ...defaultAvatar(), reason: 'no persona art available yet' };
  return { url, character: DEFAULT_PERSONA_NAME, slug: DEFAULT_PERSONA_SLUG, emotion, scores, hasEmotionArt: !!found };
}

// Image box lookup: tools/story_editor/assets/ mirrors the corpus tree —
// a picture for characters/tittiana_titsworth.md lives at
// assets/characters/tittiana_titsworth.<ext>. Nothing has to be
// registered anywhere; drop a file at the matching path and it shows up.
// Falls back to assets/<top-level-dir>/_default.<ext> (e.g.
// assets/characters/_default.png) so the box still shows *something*
// contextual — "this is a character" — even before art exists for that
// specific card, then to assets/_default.<ext> for anything outside a
// known top-level dir.
function findAssetFile(baseNoExt) {
  for (const ext of IMAGE_EXTS) {
    const p = join(ASSETS_DIR, baseNoExt + ext);
    if (existsSync(p)) return baseNoExt + ext;
  }
  return null;
}
function resolveImage(corpusPath) {
  const base = corpusPath.replace(/\.md$/, '');
  const specific = findAssetFile(base);
  if (specific) return { url: `/assets/${specific}`, specific: true };
  const top = corpusPath.split('/')[0];
  const topDefault = findAssetFile(`${top}/_default`);
  if (topDefault) return { url: `/assets/${topDefault}`, specific: false, category: top };
  const rootDefault = findAssetFile('_default');
  if (rootDefault) return { url: `/assets/${rootDefault}`, specific: false, category: null };
  return { url: null };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'draft';
}
const arcFiles = () => getFiles().map(rel).filter((p) => p.startsWith('plot/arcs/') && !p.startsWith('plot/arcs/beats/'));
const arcKey = (p) => {
  const m = ARC_ORDER_RE.exec(p.split('/').pop());
  return m ? parseFloat(m[1]) : Infinity;
};

// --- word/name index for cross-highlighting loaded context against prose ---
function candidateNames(node) {
  const names = new Set();
  const base = node.title.replace(/\s*[—-].*$/, '').trim();
  if (base) names.add(base);
  const aliasLine = node.text.match(/\*\*Aliases?:?\*\*\s*(.+)/i);
  if (aliasLine) {
    for (const a of aliasLine[1].split(/[,;]/)) {
      const t = a.trim();
      if (t) names.add(t);
    }
  }
  return [...names].filter((n) => n.length >= 3);
}

function highlightMatches(prose, nodes) {
  const hits = [];
  for (const node of nodes) {
    const names = candidateNames(node);
    let found = false;
    for (const name of names) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (prose.match(re)) { found = true; break; }
    }
    hits.push({ path: node.path, title: node.title, role: node.role, matched: found, names });
  }
  return hits;
}

// --- git (read-mostly) ---
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function gitStatus() {
  const raw = git(['status', '--porcelain=v1']);
  return raw.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3).replace(/^"|"$/g, ''),
  }));
}
function gitLog(path, limit = 20) {
  const args = ['log', `-n${limit}`, '--pretty=format:%h|%ad|%s', '--date=short'];
  if (path) args.push('--', path);
  try {
    const raw = git(args);
    return raw ? raw.split('\n').map((l) => {
      const [hash, date, ...msg] = l.split('|');
      return { hash, date, message: msg.join('|') };
    }) : [];
  } catch { return []; }
}
// A file's content as of a given ref ("HEAD", a commit hash, "HEAD^", ...),
// or '' if the file didn't exist yet at that point -- same fallback the
// Android app's CorpusGit.getFileContent()/.getOrNull() ?: "" uses, so a
// brand-new file's "before" side renders as an all-green add, not an error.
function gitFileAt(ref, path) {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return '';
  }
}
// Old/new content pair for the two diff views the editor shows -- working
// tree (uncommitted edits: HEAD vs disk) and a specific past commit (that
// commit vs its parent). Sending raw content rather than a pre-rendered
// unified diff lets the client compute its own paired-line-number diff
// (see computeLineDiff in app.js), matching the Android app's
// computeSideBySideDiff/SideBySideDiffViewer instead of a plain +/- blob.
function gitContentPair(path, commit) {
  if (commit) {
    return { oldContent: gitFileAt(`${commit}^`, path), newContent: gitFileAt(commit, path) };
  }
  const oldContent = gitFileAt('HEAD', path);
  const abs = join(ROOT, path);
  const newContent = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  return { oldContent, newContent };
}

// --- missing links: cards mentioned by name in a file's prose but not
// actually linked from it. Context building only ever follows real
// markdown links (see driver.mjs's contextData) — creating a card for a
// name that already appears elsewhere as plain text does NOT retroactively
// make that other file's context include it. This is the mechanical (not
// AI) fix: find candidate cards whose title appears as a literal
// whole-word match in the text, that this file doesn't already link to
// anywhere, and offer to insert the link at its first occurrence. ---
const MISSING_LINK_DIRS = ['characters/', 'lore/', 'setting/', 'plot/arcs/'];

function findMissingLinks(corpusPath) {
  const abs = join(ROOT, corpusPath);
  const text = readFileSync(abs, 'utf8');
  const alreadyLinked = new Set(
    linksIn(abs).map((l) => resolveTarget(abs, l.target)).filter(Boolean)
  );
  const ownTitle = heading(abs) || '';
  const ownName = ownTitle.replace(/\s*[—-].*$/, '').trim();
  const candidates = [];
  for (const f of getFiles().map(rel)) {
    if (f === corpusPath || hiddenSet.has(f) || alreadyLinked.has(f)) continue;
    if (f.includes('/beats/')) continue; // generated per-beat copies of an arc, not real standalone cards
    if (!MISSING_LINK_DIRS.some((d) => f.startsWith(d))) continue;
    const title = heading(join(ROOT, f));
    if (!title) continue;
    // Strip " — subtitle" / " - subtitle" trailers (card titles like
    // "Nesta Cradlemire — Gestation-Midwife") down to the actual name,
    // and skip anything too short/generic to avoid noisy false positives.
    const name = title.replace(/\s*[—-].*$/, '').trim();
    if (name.length < 4) continue;
    // A card's own H1 naturally contains its own name — that's not a
    // "missing link", it's the file talking about itself.
    if (name === ownName || ownName.startsWith(name) || name.startsWith(ownName)) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = text.match(re);
    if (m) candidates.push({ path: f, title, name, matchIndex: m.index });
  }
  candidates.sort((a, b) => a.matchIndex - b.matchIndex);
  return candidates;
}

// --- broken links: existing links that point at a target that isn't
// actually there. Distinct from /api/missing-links above (which finds
// cards mentioned but never linked at all) — this is the opposite
// direction, fixing what's already linked but wrong. Corpus-wide, not
// scoped to one file, since checkLinks() is cheap and 30+ pre-existing
// breaks are worth surfacing in one pass rather than file by file. Most
// breakage in this corpus turns out to be one of two things: a stale
// filename after a rename, or a relative-path depth mistake (the exact
// bug this session's own edits produced and fixed a few times) — both
// resolve to "does a file with this basename exist somewhere else", so
// that's the one heuristic this tries before giving up on a suggestion. ---
function findBrokenLinkFixes() {
  const { broken } = checkLinks();
  const basenameIndex = new Map(); // basename -> [corpus-relative paths]
  for (const f of getFiles().map(rel)) {
    const base = f.split('/').pop();
    if (!basenameIndex.has(base)) basenameIndex.set(base, []);
    basenameIndex.get(base).push(f);
  }
  return broken.map((b) => {
    const targetPath = b.target.split('#')[0];
    const anchor = b.target.includes('#') ? '#' + b.target.split('#').slice(1).join('#') : '';
    const basename = targetPath.split('/').pop();
    const matches = basenameIndex.get(basename) || [];
    let suggestion = null;
    if (matches.length === 1) {
      const fromAbs = join(ROOT, b.from);
      const newRel = relative(dirname(fromAbs), join(ROOT, matches[0])).split(sep).join('/') + anchor;
      suggestion = { newTarget: newRel, resolvedPath: matches[0] };
    }
    return { from: b.from, line: b.line, text: b.text, target: b.target, matchCount: matches.length, suggestion };
  });
}

// --- ops queue: file-based job hand-off. The server only ever *writes the
// request*; a human (or the assistant, working the queue directly with its
// own file tools) reads ops/queue/<id>.json, does the actual reasoning —
// extracting a new card from prose, spotting a contradiction — and writes
// ops/results/<id>.json. This process has no model call of its own to make;
// it packages exactly the input an LLM needs and gets out of the way. See
// ops/README.md for the schema. ---
function gatherLinkedContext(path, { hops = 1 } = {}) {
  const abs = join(ROOT, path);
  const seen = new Set([path]);
  let frontier = [path];
  const cards = [];
  for (let h = 0; h < hops && frontier.length; h++) {
    const next = [];
    for (const f of frontier) {
      const fAbs = join(ROOT, f);
      for (const l of linksIn(fAbs)) {
        const t = resolveTarget(fAbs, l.target);
        if (!t || seen.has(t) || !getFileSet().has(t)) continue;
        seen.add(t);
        const text = readFileSync(join(ROOT, t), 'utf8');
        cards.push({ path: t, title: heading(join(ROOT, t)) || t, text });
        next.push(t);
      }
    }
    frontier = next;
  }
  return cards;
}

function writeJob(type, input) {
  const id = randomUUID();
  const job = { id, type, createdAt: new Date().toISOString(), status: 'pending', input };
  writeFileSync(join(queueDir(), `${id}.json`), JSON.stringify(job, null, 2), 'utf8');
  return job;
}

function listJobs() {
  const queued = readdirSync(queueDir()).filter((f) => f.endsWith('.json'));
  return queued.map((f) => {
    const job = JSON.parse(readFileSync(join(queueDir(), f), 'utf8'));
    const resultPath = join(resultsDir(), f);
    const hasResult = existsSync(resultPath);
    return {
      id: job.id, type: job.type, createdAt: job.createdAt,
      status: hasResult ? 'done' : 'pending',
      inputSummary: summarizeInput(job.type, job.input),
    };
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function summarizeInput(type, input) {
  if (type === 'draft-chapter') return `${input.arcPath} -> ${input.suggestedDraftPath}`;
  if (type === 'reformat') return input.path;
  if (type === 'intensify-chapter') return input.path;
  if (type === 'extract-cards') return input.path;
  if (type === 'contradictions-context') return input.path;
  if (type === 'contradictions-chapters') return `${input.pathA} vs ${input.pathB}`;
  return '';
}

// Files carrying `trigger: always_on` in their frontmatter — standing house
// rules/world facts (nudity/submission baseline, lexicon, content
// boundaries, etc.) meant to apply regardless of whether a given chapter
// happens to link to them, for ops like intensify-chapter that need those
// facts present even when the prose itself is silent on them. De-dupes the
// same way tools/rewrite_chapter_mistral.py's load_rules() does: a split
// card (name_NN_slug.md) is skipped if its monolithic original (name.md) is
// also in the always-on set, since loading both doubles the same rule.
function alwaysOnContext() {
  const all = getFiles().map(rel).filter((f) => f.endsWith('.md'));
  const isAlwaysOn = (f) => {
    try {
      // \r? tolerates CRLF -- these rule files are CRLF on disk and a bare
      // \n here silently fails to match, misreading nearly every
      // always_on file as not always_on (confirmed: 13 of 14 canon-bias
      // cards were being skipped by every consumer of this function).
      const m = readFileSync(join(ROOT, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      return !!(m && /trigger:\s*always_on/.test(m[1]));
    } catch { return false; }
  };
  const candidates = all.filter(isAlwaysOn);
  const baseNames = new Set(candidates.map((f) => f.split('/').pop()));
  const cardRe = /^(.+?)_\d\d_.*\.md$/;
  return candidates.filter((f) => {
    const m = cardRe.exec(f.split('/').pop());
    if (!m) return true;
    return !baseNames.has(m[1].replace(/_/g, '-') + '.md');
  });
}

// --- tiny JSON helpers ---
function send(res, code, body, type = 'application/json') {
  const buf = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type + (type === 'application/json' ? '; charset=utf-8' : ''), 'Access-Control-Allow-Origin': '*' });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
// Binary counterpart of readBody -- for a zip upload, where concatenating
// as a string (readBody's approach) would corrupt every non-ASCII byte.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Streams a file back as a download (Content-Disposition: attachment)
// rather than something the browser tries to render inline, then deletes
// it -- every caller below builds its export into a tmpdir() scratch file
// first, so this is always the last step, not something a client can point
// at an arbitrary path.
function sendFileDownload(res, filePath, downloadName, mimeType) {
  const buf = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': buf.length,
    'Content-Disposition': `attachment; filename="${downloadName.replace(/"/g, '')}"`,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
  try { unlinkSync(filePath); } catch {}
}

// --- peer sync: request/approve state (see the /api/sync/* routes) ---
const syncRequests = new Map(); // requestId -> { direction: 'push'|'pull', fromLabel, status, createdAt }
const SYNC_REQUEST_TTL_MS = 2 * 60 * 1000;
function pruneSyncRequests() {
  const now = Date.now();
  for (const [id, r] of syncRequests) if (now - r.createdAt > SYNC_REQUEST_TTL_MS) syncRequests.delete(id);
}
// Local button clicks (Export .zip / Import .zip) hit these same routes
// from this same machine -- that IS the user's consent, nothing further
// needed. A call arriving from anywhere else is a peer, who has to have
// gone through an accepted /api/sync/request first.
function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
// direction from the SERVER's point of view: 'pull' means the peer is
// taking data out of here (so /api/export/zip requires it), 'push' means
// the peer is putting data in (so /api/import/zip requires it). Single-use
// -- the entry is consumed here so replaying the same requestId fails.
function authorizePeerRequest(url, requiredDirection) {
  const requestId = url.searchParams.get('requestId');
  const r = requestId && syncRequests.get(requestId);
  if (!r || r.status !== 'accepted' || r.direction !== requiredDirection) {
    return { error: 'not authorized -- the other device must accept a sync request first' };
  }
  syncRequests.delete(requestId);
  return { ok: true };
}

function cardPayload(p) {
  const abs = join(ROOT, p);
  const text = readFileSync(abs, 'utf8');
  const links = linksIn(abs).map((l) => {
    const t = resolveTarget(abs, l.target);
    return { text: l.text, target: l.target, resolved: t, exists: t ? getFileSet().has(t) : false };
  });
  return { path: p, title: heading(abs) || p, text, links };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Peer sync (see /api/sync/* below) is the first thing here that calls
  // fetch() cross-origin -- another device's own editor, a different
  // port -- with a JSON Content-Type, which browsers preflight with an
  // OPTIONS request before the real one. Every other route so far only
  // ever got same-origin calls, so nothing needed this until now.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (p === '/' || p === '/index.html') {
      return send(res, 200, readFileSync(join(HERE, 'index.html'), 'utf8'), 'text/html');
    }
    if (p === '/app.js') {
      return send(res, 200, readFileSync(join(HERE, 'app.js'), 'utf8'), 'text/javascript');
    }
    if (p === '/msgbus.js') {
      // Shared cross-window bus -- see the file's own header comment.
      // Served to the editor, the storyboard, and (via reader_head.html's
      // --head injection) the published reader itself.
      return send(res, 200, readFileSync(join(HERE, 'msgbus.js'), 'utf8'), 'text/javascript');
    }

    if (p === '/board' || p === '/board.html') {
      return send(res, 200, readFileSync(join(HERE, 'board.html'), 'utf8'), 'text/html');
    }
    if (p === '/board.js') {
      return send(res, 200, readFileSync(join(HERE, 'board.js'), 'utf8'), 'text/javascript');
    }

    if (p === '/api/board/layout') {
      if (req.method === 'GET') return send(res, 200, loadBoardLayout());
      if (req.method === 'POST') {
        const { positions } = await readBody(req);
        if (!positions || typeof positions !== 'object') return send(res, 400, { error: 'positions required' });
        saveBoardLayout({ positions });
        return send(res, 200, { ok: true });
      }
    }

    // Draws a real connection: appends a markdown link from `from`'s own
    // Relations section to `to`, the same section every card in this corpus
    // already uses for its outbound references -- this is deliberately the
    // only board action that touches a corpus file, because a drawn
    // connection is a claim about the link graph /api/context actually
    // traverses, not just a visual arrangement.
    if (p === '/api/relations/add' && req.method === 'POST') {
      const { from, to } = await readBody(req);
      if (!from || !to) return send(res, 400, { error: 'from and to required' });
      if (!getFileSet().has(from) || !getFileSet().has(to)) return send(res, 404, { error: 'not found' });
      if (from === to) return send(res, 400, { error: 'cannot link a card to itself' });
      const fromAbs = join(ROOT, from);
      const alreadyLinked = linksIn(fromAbs).map((l) => resolveTarget(fromAbs, l.target)).filter(Boolean);
      if (alreadyLinked.includes(to)) return send(res, 200, { ok: true, alreadyLinked: true });
      const relPath = relative(dirname(fromAbs), join(ROOT, to)).split(sep).join('/');
      const toTitle = heading(join(ROOT, to)) || to.split('/').pop().replace(/\.md$/, '');
      const line = `* See [${toTitle}](${relPath}).`;
      let text = readFileSync(fromAbs, 'utf8');
      const lines = text.split(/\r?\n/);
      const relIdx = lines.findIndex((l) => l.trim() === '## Relations');
      if (relIdx === -1) {
        text = text.replace(/\s*$/, '') + `\n\n## Relations\n${line}\n`;
      } else {
        let insertAt = lines.length;
        for (let i = relIdx + 1; i < lines.length; i++) {
          if (/^##\s/.test(lines[i])) { insertAt = i; break; }
        }
        lines.splice(insertAt, 0, line);
        text = lines.join('\n');
      }
      writeFileSync(fromAbs, text, 'utf8');
      refreshIndex();
      return send(res, 200, { ok: true, inserted: line });
    }

    // Served at a URL path that mirrors the file's actual disk location
    // (tools/twine/reader.html) rather than at the shorter '/reader' -- the
    // reader's own image references are relative ('../story_editor/assets/...')
    // so it can also be opened directly off disk with no server at all
    // (see build_twine.py/reader_head.html); that only works if the served
    // URL's directory depth matches the file's real directory depth, which
    // '/reader' alone doesn't. '/reader' and '/reader.html' redirect here
    // for anything with the old, shorter link saved.
    if (p === '/tools/twine/reader.html' || p === '/tools/twine/reader') {
      // Build is an inherent step here, not an optional one -- reader.html
      // is a generated artifact of chapters/*.md and goes stale the moment
      // any chapter changes, so every visit rebuilds first rather than
      // risking a stale read or requiring a manual `python tools/build_twine.py`.
      const readerPath = join(HERE, '..', 'twine', 'reader.html');
      const toolsDir = join(HERE, '..');
      try {
        execFileSync('python', [join(toolsDir, 'build_twine.py')], { cwd: toolsDir, stdio: 'pipe' });
      } catch (e) {
        if (!existsSync(readerPath)) {
          return send(res, 500, 'Reader build failed and no prior build exists:\n' + (e.stderr || e.message), 'text/plain');
        }
        // Fall through and serve the last successful build rather than
        // blocking the reader entirely over a build error.
      }
      if (!existsSync(readerPath)) {
        return send(res, 404, 'Reader not built yet — run: python tools/build_twine.py', 'text/plain');
      }
      return send(res, 200, readFileSync(readerPath, 'utf8'), 'text/html');
    }
    // Same shape as the reader route above, but for the standalone build --
    // every visible image embedded inline (base64) so the single output
    // file has zero external dependencies, at the cost of a much heavier
    // build (all 19-odd background images) and a much larger response
    // (~72MB as of this writing). Rebuilt on every visit for the same
    // staleness reason as the plain reader.
    if (p === '/tools/twine/reader_standalone.html' || p === '/tools/twine/reader-standalone') {
      const readerPath = join(HERE, '..', 'twine', 'reader_standalone.html');
      const toolsDir = join(HERE, '..');
      try {
        execFileSync('python', [join(toolsDir, 'build_twine_standalone.py')], { cwd: toolsDir, stdio: 'pipe', maxBuffer: 1024 * 1024 * 10 });
      } catch (e) {
        if (!existsSync(readerPath)) {
          return send(res, 500, 'Standalone reader build failed and no prior build exists:\n' + (e.stderr || e.message), 'text/plain');
        }
        // Fall through and serve the last successful build rather than
        // blocking entirely over a build error.
      }
      if (!existsSync(readerPath)) {
        return send(res, 404, 'Standalone reader not built yet — run: python tools/build_twine_standalone.py', 'text/plain');
      }
      return send(res, 200, readFileSync(readerPath, 'utf8'), 'text/html');
    }
    if (p === '/reader-standalone' || p === '/reader_standalone.html') {
      res.writeHead(302, { Location: '/tools/twine/reader_standalone.html' });
      return res.end();
    }
    if (p === '/reader' || p === '/reader.html') {
      res.writeHead(302, { Location: '/tools/twine/reader.html' });
      return res.end();
    }
    // ---- stories: load/create/switch which stories/<name>/ tree is active ----
    if (p === '/api/stories') {
      return send(res, 200, { active: getActiveStoryName(), stories: listStories() });
    }
    if (p === '/api/lan-address') {
      return send(res, 200, { address: lanAddress() });
    }
    if (p === '/api/stories/select' && req.method === 'POST') {
      const { name } = await readBody(req);
      if (!name) return send(res, 400, { error: 'name required' });
      try {
        setActiveStory(name);
        loadHidden(); // this story's own hidden set, not the previous story's
        return send(res, 200, { ok: true, active: getActiveStoryName() });
      } catch (e) { return send(res, 404, { error: e.message }); }
    }
    if (p === '/api/stories/create' && req.method === 'POST') {
      const { name } = await readBody(req);
      if (!name) return send(res, 400, { error: 'name required' });
      try {
        createStory(name);
        loadHidden(); // fresh story has no hidden set of its own yet
        return send(res, 200, { ok: true, active: getActiveStoryName() });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    if (p === '/api/stories/rename' && req.method === 'POST') {
      const { oldName, newName } = await readBody(req);
      if (!oldName || !newName) return send(res, 400, { error: 'oldName and newName required' });
      try {
        renameStory(oldName, newName);
        return send(res, 200, { ok: true, active: getActiveStoryName() });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    if (p === '/api/rescan' && req.method === 'POST') {
      // Manual re-scan for files created/removed outside the editor (e.g.
      // by another tool, or git). The index is otherwise only refreshed
      // after a write the editor itself made (save/rename/apply-card), so
      // an externally-added arc/chapter is invisible until either this
      // fires or the server process restarts.
      refreshIndex();
      return send(res, 200, { ok: true, files: getFiles().length });
    }

    if (p === '/api/stats') {
      const inb = inbound();
      const orphans = [...inb].filter(([, n]) => n === 0).map(([f]) => f).sort();
      let words = 0;
      const byTop = new Map();
      for (const f of getFiles()) {
        const w = readFileSync(f, 'utf8').split(/\s+/).filter(Boolean).length;
        words += w;
        const top = rel(f).split('/')[0];
        const cur = byTop.get(top) || { files: 0, words: 0 };
        byTop.set(top, { files: cur.files + 1, words: cur.words + w });
      }
      return send(res, 200, {
        files: getFiles().length, words,
        byTop: [...byTop].map(([k, v]) => ({ dir: k, ...v })).sort((a, b) => b.words - a.words),
        orphanCount: orphans.length, orphans,
      });
    }

    // Remarks: reviewer notes pinned to quoted text in a chapter. Kept in
    // the story's state dir, never in the .md, so the draft is untouched.
    if (p === '/api/remarks') {
      const all = loadRemarks();
      if (req.method === 'GET') {
        const target = url.searchParams.get('path');
        return send(res, 200, target ? (all[target] || []) : all);
      }
      if (req.method === 'POST') {
        const { path: target, remarks } = await readBody(req);
        if (!target || !Array.isArray(remarks)) return send(res, 400, { error: 'path and remarks[] required' });
        if (remarks.length) all[target] = remarks; else delete all[target];
        mkdirSync(storyStateDir(), { recursive: true });
        writeFileSync(remarksPath(), JSON.stringify(all, null, 2), 'utf8');
        return send(res, 200, { ok: true, count: remarks.length });
      }
    }

    if (p === '/api/hidden') return send(res, 200, [...hiddenSet].sort());

    if (p === '/api/hidden/toggle' && req.method === 'POST') {
      const { path: target } = await readBody(req);
      if (!target) return send(res, 400, { error: 'path required' });
      const nowHidden = !hiddenSet.has(target);
      if (nowHidden) hiddenSet.add(target); else hiddenSet.delete(target);
      saveHidden();
      return send(res, 200, { path: target, hidden: nowHidden });
    }

    if (p === '/api/missing-links') {
      const target = url.searchParams.get('path');
      if (!target || !getFileSet().has(target)) return send(res, 404, { error: 'not found' });
      return send(res, 200, findMissingLinks(target));
    }

    if (p === '/api/missing-links/apply' && req.method === 'POST') {
      const { path: source, target, name } = await readBody(req);
      if (!source || !target || !name) return send(res, 400, { error: 'path, target, and name required' });
      if (!getFileSet().has(source) || !getFileSet().has(target)) return send(res, 404, { error: 'not found' });
      const abs = join(ROOT, source);
      const text = readFileSync(abs, 'utf8');
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const m = text.match(re);
      if (!m) return send(res, 404, { error: 'name no longer found in text — file may have changed' });
      const rel2 = relative(dirname(abs), join(ROOT, target)).split(sep).join('/');
      const newText = text.slice(0, m.index) + `[${m[0]}](${rel2})` + text.slice(m.index + m[0].length);
      writeFileSync(abs, newText, 'utf8');
      return send(res, 200, { ok: true, inserted: `[${m[0]}](${rel2})` });
    }

    if (p === '/api/broken-links') return send(res, 200, findBrokenLinkFixes());

    if (p === '/api/broken-links/apply' && req.method === 'POST') {
      // Either newTarget (a ready-to-use relative link string, from the
      // server's own suggestion) or resolvedPath (a corpus-relative path
      // the client picked via search) — resolvedPath gets turned into the
      // correct relative link here, server-side, rather than duplicating
      // relative-path math in the browser.
      const { from, oldTarget, newTarget: givenTarget, resolvedPath } = await readBody(req);
      if (!from || !oldTarget || (!givenTarget && !resolvedPath)) {
        return send(res, 400, { error: 'from, oldTarget, and one of newTarget/resolvedPath required' });
      }
      if (!getFileSet().has(from)) return send(res, 404, { error: 'not found' });
      let newTarget = givenTarget;
      if (!newTarget) {
        if (!getFileSet().has(resolvedPath)) return send(res, 404, { error: 'resolvedPath not found' });
        const fromAbs = join(ROOT, from);
        const anchor = oldTarget.includes('#') ? '#' + oldTarget.split('#').slice(1).join('#') : '';
        newTarget = relative(dirname(fromAbs), join(ROOT, resolvedPath)).split(sep).join('/') + anchor;
      }
      const abs = join(ROOT, from);
      const text = readFileSync(abs, 'utf8');
      // Match the exact `](target)` fragment rather than a bare string
      // replace of the target text, so a target that happens to be a
      // substring of something else in the file can't get clobbered.
      const needle = `](${oldTarget})`;
      const idx = text.indexOf(needle);
      if (idx === -1) return send(res, 404, { error: 'link no longer found — file may have changed' });
      const newText = text.slice(0, idx) + `](${newTarget})` + text.slice(idx + needle.length);
      writeFileSync(abs, newText, 'utf8');
      return send(res, 200, { ok: true, from, oldTarget, newTarget });
    }

    if (p === '/api/rules') {
      // Top-level/hub rule files only (not the auto-generated per-section
      // cards under tools/split_rules.py) -- the split cards are derived
      // content the context traversal expands into automatically, not
      // something a curator manages directly. Two naming conventions in
      // use: "..._01_description.md" (trailing underscore + words) and
      // "..._01.md" (number immediately before the extension) -- both
      // need matching, or e.g. canon_bias_card_01.md through _NN slip
      // through as if they were their own hub files.
      const isSplitCard = (name) => /_\d\d(_|\.md$)/.test(name);
      const rules = getFiles().map(rel)
        .filter((f) => f.startsWith('.agents/rules/') && !isSplitCard(f.split('/').pop()) && !hiddenSet.has(f))
        .map((f) => {
          const abs = join(ROOT, f);
          const text = readFileSync(abs, 'utf8');
          const keywords = (text.match(/^keywords:\s*(.*)$/m) || [, ''])[1];
          return { path: f, title: heading(abs) || f, keywords };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
      return send(res, 200, rules);
    }

    if (p === '/api/fs/rename' && req.method === 'POST') {
      const { from, to } = await readBody(req);
      if (!from || !to) return send(res, 400, { error: 'from and to required' });
      if (!getFileSet().has(from)) return send(res, 404, { error: 'from does not exist' });
      if (getFileSet().has(to) || existsSync(join(ROOT, to))) return send(res, 409, { error: 'to already exists' });
      const fromAbs = join(ROOT, from), toAbs = join(ROOT, to);
      if (!resolve(toAbs).startsWith(resolve(ROOT))) return send(res, 403, { error: 'to escapes repo root' });
      mkdirSync(dirname(toAbs), { recursive: true });
      renameSync(fromAbs, toAbs);

      // Rewrite every inbound link across the corpus to point at the new
      // path, recomputed relative to each referring file's own directory
      // (same approach as tools/split_arc_beats.py's rewrite_links, just
      // corpus-wide instead of scoped to one arc's beat cards).
      let filesUpdated = 0;
      const relinkErrors = [];
      for (const f of getFiles().map(rel)) {
        // Skip both endpoints: `to` is the freshly-renamed file itself
        // (nothing points at itself), and `from` is the OLD path, which
        // getFiles() still lists (stale until refreshIndex() below) but no
        // longer exists on disk post-renameSync — reading it here would
        // throw and abort the whole corpus-wide relink partway through,
        // leaving some files updated and others not.
        if (f === to || f === from) continue;
        const fAbs = join(ROOT, f);
        let text, changed = false;
        try {
          text = readFileSync(fAbs, 'utf8');
        } catch (e) { relinkErrors.push({ file: f, error: String(e) }); continue; }
        for (const l of linksIn(fAbs)) {
          if (/^(https?:|mailto:|#)/.test(l.target)) continue;
          const resolved = resolveTarget(fAbs, l.target);
          if (resolved !== from) continue;
          const anchor = l.target.includes('#') ? '#' + l.target.split('#').slice(1).join('#') : '';
          const newRel = relative(dirname(fAbs), toAbs).split(sep).join('/') + anchor;
          const oldLinkMd = `[${l.text}](${l.target})`;
          const newLinkMd = `[${l.text}](${newRel})`;
          if (text.includes(oldLinkMd)) { text = text.split(oldLinkMd).join(newLinkMd); changed = true; }
        }
        if (changed) { writeFileSync(fAbs, text, 'utf8'); filesUpdated++; }
      }
      if (hiddenSet.has(from)) { hiddenSet.delete(from); hiddenSet.add(to); saveHidden(); }
      refreshIndex();
      return send(res, 200, { ok: true, from, to, filesUpdated, relinkErrors });
    }

    if (p === '/api/arcs') {
      const arcs = arcFiles().filter((f) => !hiddenSet.has(f)).sort((a, b) => arcKey(a) - arcKey(b)).map((f) => {
        const abs = join(ROOT, f);
        const text = readFileSync(abs, 'utf8');
        const premise = extractSection(text, 'Premise');
        const status = (text.match(/status:\s*(\S+)/) || [, ''])[1];
        return { path: f, title: heading(abs) || f, order: arcKey(f), premise: premise.slice(0, 240), status };
      });
      return send(res, 200, arcs);
    }

    if (p === '/api/arc-graph') {
      // One-shot payload for the storyboard board: every visible arc plus
      // which *other arcs* it directly links to (arc-to-arc edges only --
      // an arc's links to characters/lore/etc. are what /api/context is
      // for, fetched per-node on selection instead, since drawing every
      // card-level link on the board at once would be unreadable).
      const arcs = arcFiles().filter((f) => !hiddenSet.has(f));
      const arcSet = new Set(arcs);
      const nodes = arcs.sort((a, b) => arcKey(a) - arcKey(b)).map((f) => {
        const abs = join(ROOT, f);
        const text = readFileSync(abs, 'utf8');
        const status = (text.match(/status:\s*(\S+)/) || [, ''])[1];
        const linksTo = [...new Set(linksIn(abs).map((l) => resolveTarget(abs, l.target)).filter((t) => t && arcSet.has(t) && t !== f))];
        return { path: f, title: heading(abs) || f, order: arcKey(f), status, linksTo };
      });
      return send(res, 200, nodes);
    }

    if (p === '/api/chapters') {
      // Same frontmatter fields and reading-order convention as
      // tools/build_twine.py (the fields that drive the published
      // reader's Table of Contents / prev-next nav), so this list matches
      // what the reader actually shows.
      // Direct children only (matches build_twine.py's CHAPTERS_DIR.glob
      // ("*.md")), not chapters/mistral/ or chapters/drafts/'s own
      // subfolders — mistral output is a separate pipeline (see README),
      // and drafts is included as its own explicit entry, not swept in by
      // a broad "chapters/" prefix match.
      const dirs = ['chapters', 'chapters/drafts'];
      const chapters = [];
      for (const d of dirs) {
        const prefix = d + '/';
        for (const f of getFiles().map(rel).filter((p2) => p2.startsWith(prefix) && !p2.slice(prefix.length).includes('/') && !hiddenSet.has(p2))) {
          const abs = join(ROOT, f);
          const text = readFileSync(abs, 'utf8');
          const fm = {};
          const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
          if (fmMatch) {
            for (const line of fmMatch[1].split(/\r?\n/)) {
              const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
              if (m) fm[m[1]] = m[2].replace(/^"|"$/g, '');
            }
          }
          const order = fm.order !== undefined ? parseFloat(fm.order) : null;
          chapters.push({
            path: f, dir: d,
            title: fm.title || heading(abs) || f,
            order: Number.isFinite(order) ? order : null,
            arc: fm.arc || '', blurb: fm.blurb || '', status: fm.status || 'written',
          });
        }
      }
      chapters.sort((a, b) => {
        const ao = a.order === null ? Infinity : a.order, bo = b.order === null ? Infinity : b.order;
        return ao - bo || a.path.localeCompare(b.path);
      });
      return send(res, 200, chapters);
    }

    if (p === '/api/chapter-for-arc') {
      // Finds whatever chapter(s) dramatize a given arc, three ways:
      //  1. Naming convention: draft-chapter (see /api/ops/create) writes
      //     to chapters/drafts/<slugified-arc-basename>.md, so check there
      //     directly first -- exact, no ambiguity, for anything made
      //     through this tool's drafting flow.
      //  2. Real cross-reference: older chapters/*.md outline cards predate
      //     that convention and use `arc:` frontmatter as a loose thematic
      //     label (many chapters share one label), not a specific-arc FK --
      //     so for those, check whether the chapter's own text actually
      //     links to this arc's path, the same signal /api/missing-links
      //     uses elsewhere.
      //  3. Split-arc siblings, chapters/drafts/ only: an arc drafted across
      //     multiple chapter files (e.g. 09_arc_the_manors_bite.md's own
      //     draft plus a follow-on 09.50_arc_the_stillmend.md) share the
      //     same leading integer in their filename's own number prefix even
      //     though the rest of the basename differs -- neither convention
      //     above catches the sibling files, so match on that shared
      //     integer floor too. Scoped to chapters/drafts/ specifically --
      //     chapters/ proper uses its own independent sequential numbering
      //     unrelated to any arc's own number (e.g. chapters/09_the_two_
      //     contracts.md has nothing to do with an arc numbered 9.x), so
      //     applying this there would false-positive-match unrelated
      //     chapters purely on a coincidental shared leading digit.
      const arcPath = url.searchParams.get('arc');
      if (!arcPath || !getFileSet().has(arcPath)) return send(res, 404, { error: 'not found' });
      const matches = [];
      const seen = new Set();
      const addMatch = (f, reason) => {
        if (seen.has(f)) return;
        seen.add(f);
        matches.push({ path: f, title: heading(join(ROOT, f)) || f, reason });
      };
      const base = arcPath.replace(/^.*\//, '').replace(/\.md$/, '');
      const conventionPath = `chapters/drafts/${slugify(base)}.md`;
      if (getFileSet().has(conventionPath) && !hiddenSet.has(conventionPath)) {
        addMatch(conventionPath, 'draft of this arc');
      }
      const arcNumMatch = base.match(/^(\d+(?:\.\d+)?)/);
      const arcFloor = arcNumMatch ? Math.floor(parseFloat(arcNumMatch[1])) : null;
      for (const dir of ['chapters', 'chapters/drafts']) {
        const prefix = dir + '/';
        for (const f of getFiles().map(rel).filter((p2) => p2.startsWith(prefix) && !p2.slice(prefix.length).includes('/') && !hiddenSet.has(p2) && p2 !== conventionPath)) {
          const abs = join(ROOT, f);
          const resolved = linksIn(abs).map((l) => resolveTarget(abs, l.target)).filter(Boolean);
          if (resolved.includes(arcPath)) {
            addMatch(f, 'links to this arc');
            continue;
          }
          if (arcFloor !== null && dir === 'chapters/drafts') {
            const fBase = f.slice(prefix.length).replace(/\.md$/, '');
            const fNumMatch = fBase.match(/^(\d+(?:\.\d+)?)/);
            if (fNumMatch && Math.floor(parseFloat(fNumMatch[1])) === arcFloor) {
              addMatch(f, 'shares this arc\'s chapter-number prefix');
            }
          }
        }
      }
      return send(res, 200, matches);
    }

    if (p === '/api/tree') {
      const sub = url.searchParams.get('sub') || '.';
      const base = sub === '.' ? '' : sub.replace(/\/$/, '') + '/';
      const hits = getFiles().map(rel).filter((f) => (!base || f.startsWith(base)) && !hiddenSet.has(f));
      return send(res, 200, hits.map((f) => ({ path: f, title: heading(join(ROOT, f)) || f })));
    }

    const JUDGE_MODEL_NAME = process.env.RULES_JUDGE_MODEL_NAME || 'R4C3R/qwen3-8b-heretic:q4_k_m';
    // Ollama defaults to a 4096-token context regardless of what the base
    // model can actually support -- observed via `ollama ps` on this setup
    // (CONTEXT 4096 while a single always_on rule subset alone ran ~10.4k
    // tokens). It does NOT error when a prompt exceeds this; it silently
    // truncates, which for a rules check means silently dropping rules
    // while reporting a confident verdict. JUDGE_NUM_CTX lets num_ctx be
    // raised to match the model's real window; JUDGE_MAX_TOKENS is a hard
    // cap past which we refuse rather than trust an unverified truncation.
    const JUDGE_NUM_CTX = Number(process.env.JUDGE_NUM_CTX || 8192);
    const JUDGE_MAX_TOKENS = Number(process.env.JUDGE_MAX_TOKENS || JUDGE_NUM_CTX * 0.9);

    // See groupRelevance()'s longer note below: always_on means "inject
    // while drafting," not "topically relevant to this card" -- only this
    // curated set is genuinely topic-independent.
    const UNIVERSAL_RULE_RE = /^(canon_bias_card_|content_boundaries|content-boundaries|humanoid_offspring_and_minors|humanoid-offspring-and-minors|dark-fantasy|chapters-archive-off-limits)/;

    // Never checkable against card/prose content, regardless of scope or
    // keyword match -- these are process rules for what to do when a
    // CENSORED model refuses to generate a phrase (glyph-masking, "when
    // declining" phrasing, why the project masks at all). This project's
    // local model (heretic/uncensored) never refuses, so the premise these
    // rules exist to handle never occurs -- checking a card against them
    // is a category error, confirmed by testing: content_boundaries_04
    // ("when declining") and canon_bias_card_11 ("blocked-term fallback")
    // both produced fabricated-quote false positives on real card content
    // that has nothing to do with a blocked word or a declined request.
    const CENSORSHIP_WORKAROUND_RULE_RE = /^(content_boundaries_04_when_declining|content_boundaries_05_why|canon_bias_card_11|commercial-ai-masking-pre-read|prose-placeholder-convention|prose_placeholder_convention_|prose-draft-placeholder-convention)/;

    // Qwen3-family models (heretic included) default to emitting a hidden
    // <think>...</think> reasoning block before the real answer. Measured:
    // this alone turned a 291-token judge prompt from a >5min timeout into
    // a 42.9s completion once suppressed, AND fixed a wrong verdict (the
    // model reasoned its way to the correct answer once it wasn't spending
    // its whole budget narrating an internal monologue first). Appending
    // "/no_think" is the documented Qwen3 chat-template toggle for this.
    const THINKING_MODEL_RE = /qwen3|heretic/i;

    async function callJudgeModel(prompt, model) {
      const modelName = model || JUDGE_MODEL_NAME;
      const finalPrompt = THINKING_MODEL_RE.test(modelName) ? `${prompt}\n\n/no_think` : prompt;
      let resp, data;
      try {
        // num_ctx must be set explicitly -- Ollama's default (4096) is far
        // below what these rule-stuffed prompts need and it truncates
        // silently rather than erroring, so an unset num_ctx here would
        // mean "may have dropped rules" with no signal that it happened.
        resp = await postJson(RULES_MODEL_API, { model: modelName, prompt: finalPrompt, stream: false, options: { num_ctx: JUDGE_NUM_CTX } });
        data = resp.data;
      } catch (e) {
        throw new Error(`rules-judge model unreachable at ${RULES_MODEL_API}: ${e.message}`);
      }
      if (!resp.ok) throw new Error(data?.error || `rules-judge model HTTP ${resp.status}`);
      // Strip an empty (or non-empty, if the toggle didn't fully suppress
      // it on some model build) <think> block rather than trust every
      // caller to handle it -- consumers expect the verdict/reasoning text
      // itself, not template artifacts.
      const raw = (data.response || '').replace(/<think>[\s\S]*?<\/think>\s*/i, '').trim();
      if (!raw) throw new Error('rules-judge model returned no content');
      return raw;
    }

    // Decomposed-turn variant of callJudgeModel: appends one user message
    // to an existing conversation and returns the assistant's reply, using
    // /api/chat instead of /api/generate. Confirmed by testing: splitting
    // "here's the rule" / "here's the card" / "now judge" into three
    // separate turns produced a correct COMPLIANT verdict on a case where
    // combining rule+card into one message produced an incorrect VIOLATION
    // every time it was tried (content-boundaries vs. a card with a
    // canon-mandated hypersexual trait -- the single-message version kept
    // conflating "matches a required canon trait" with "violates policy";
    // decomposed, it correctly reasoned through age/consent/family
    // separately). Not a guaranteed fix -- only /no_think-suffixes the
    // FINAL turn (earlier turns are meant to be read/summarized, not
    // verdicted), and callers are responsible for keeping the growing
    // message array within JUDGE_NUM_CTX themselves.
    async function callJudgeModelChat(messages, model) {
      const modelName = model || JUDGE_MODEL_NAME;
      let resp, data;
      try {
        resp = await postJson(RULES_MODEL_CHAT_API, { model: modelName, messages, stream: false, options: { num_ctx: JUDGE_NUM_CTX } });
        data = resp.data;
      } catch (e) {
        throw new Error(`rules-judge model unreachable at ${RULES_MODEL_CHAT_API}: ${e.message}`);
      }
      if (!resp.ok) throw new Error(data?.error || `rules-judge model HTTP ${resp.status}`);
      const raw = (data.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/i, '').trim();
      if (!raw) throw new Error('rules-judge model returned no content');
      return raw;
    }

    // Runs one group's check as three separate turns instead of one
    // combined message -- see callJudgeModelChat's note. Each group gets
    // its own fresh conversation; groups are never chained together
    // (confirmed separately: chaining multiple groups risks context
    // overflow and can anchor a later verdict to an earlier, possibly
    // wrong one).
    async function runDecomposedCheck(g, ruleText, cardText, model) {
      const turn1 = `Here is a rule you will need to apply later. Do not judge anything yet -- just read ` +
        `it and restate its core requirement in one or two sentences, in your own words.\n\nRULE (${g.title}):\n${ruleText}`;
      const turn2 = `Here is a card you will need to judge later. Do not judge it yet -- just read it and ` +
        `briefly summarize what it describes, in one or two sentences.\n\nCARD TEXT:\n${cardText}`;
      const turn3 = `Now judge the card from the previous message against ONLY the rule from the first ` +
        `message (do not apply any other rule you might know of). Reason briefly, then end with a single ` +
        `line reading exactly "VERDICT: VIOLATION" or "VERDICT: COMPLIANT".` +
        (THINKING_MODEL_RE.test(model || JUDGE_MODEL_NAME) ? '\n\n/no_think' : '');

      const messages = [];
      messages.push({ role: 'user', content: turn1 });
      const ruleRestatement = await callJudgeModelChat(messages, model);
      messages.push({ role: 'assistant', content: ruleRestatement });

      messages.push({ role: 'user', content: turn2 });
      const cardSummary = await callJudgeModelChat(messages, model);
      messages.push({ role: 'assistant', content: cardSummary });

      messages.push({ role: 'user', content: turn3 });
      const raw = await callJudgeModelChat(messages, model);

      return { raw, ruleRestatement, cardSummary };
    }

    // Refuses rather than silently trusting Ollama to truncate -- see the
    // JUDGE_NUM_CTX note above. Throws with the token count and cap so the
    // caller can see exactly how far over the limit the prompt was.
    function assertFitsContext(approxTokens, ruleCount) {
      if (approxTokens > JUDGE_MAX_TOKENS) {
        throw new Error(
          `prompt is ~${approxTokens} tokens (${ruleCount} rule files) but JUDGE_MAX_TOKENS is ` +
          `${JUDGE_MAX_TOKENS} (num_ctx=${JUDGE_NUM_CTX}) -- refusing rather than risk Ollama silently ` +
          `truncating rules. Narrow the card set, raise JUDGE_NUM_CTX, or move to a larger-context model.`
        );
      }
    }

    // --- Rule-group ensemble: fans a card out across the atomic rule
    // groups, one small model call per applicable group, instead of one
    // model reasoning over all rules stuffed into a single context. This
    // is no longer a stand-in for a future trained model -- it IS the
    // working gatekeeper (see rules-check-ensemble below for the
    // trained-per-group-model variant, which needs GPU training that
    // hasn't happened yet). Context-stuffs each group's own (small) rule
    // text into a stock Ollama model. Feasible where a single all-rules
    // prompt wasn't: collapse_rules.py keeps groups atomic (max 2 files
    // per group; most are 1), so almost every group's rule text is a few
    // hundred to ~2k tokens -- nowhere near the ~56k of the full corpus
    // that measured at 27min and still truncated. One file-inherent
    // outlier remains (the euphemism catalog, ~4.7k tokens, already a
    // single file with nothing to split further). Runs groups
    // sequentially, not in parallel, because this machine has no GPU --
    // concurrent CPU inference calls would contend for the same cores
    // rather than actually run in parallel.
    const RULES_GATEKEEPER_ROOT = process.env.RULES_GATEKEEPER_ROOT || join(HERE, '..', '..', '..', 'rules-gatekeeper');
    // rule_groups.json's rule paths are relative to the stories-repo root
    // (e.g. "stories/story/.agents/rules/x.md"), same as collapse_rules.py's
    // --stories-root -- but ROOT here is already .../stories/story (two
    // levels deeper), so resolve back up to the actual repo root before
    // joining, or every rule path would double up "stories/story".
    const STORIES_ROOT_FOR_RULES = resolve(ROOT, '..', '..');

    function loadRuleGroups() {
      const p = join(RULES_GATEKEEPER_ROOT, 'data', 'rule_groups.json');
      if (!existsSync(p)) throw new Error(`rule_groups.json not found at ${p} — run rules-gatekeeper/data/collapse_rules.py, or set RULES_GATEKEEPER_ROOT`);
      return JSON.parse(readFileSync(p, 'utf8'));
    }

    // A group is only relevant to a card if a rule in it is universal, or
    // its keywords appear in the card text -- most rules are NOT universal
    // precisely so they only fire in the situations they're about (an
    // anatomy rule has no business being checked against a card that never
    // mentions the body). Checking every group unconditionally wastes
    // CPU-only inference time on irrelevant rules and risks a confident-
    // sounding verdict on a rule that was never meant to apply here at all.
    // "always_on" in this repo's frontmatter means "always inject into the
    // model's context while drafting a chapter" -- a content-generation
    // grounding concern. It does NOT mean "topically relevant to every
    // card being validated." Treating it as a blanket pass was wrong: a
    // card describing a building's strange architecture has no business
    // being checked against explicit_lexicon_09_acts_degradation_handling
    // just because that rule happens to be always_on -- it has real
    // keywords (degradation, whore, slut, pet, livestock...) that a
    // building-description card simply won't contain. Only a small,
    // deliberately curated set of rules are genuinely topic-independent
    // (canon-consistency facts, safety boundaries, tone, archive scope,
    // see UNIVERSAL_RULE_RE above) -- everything else needs an actual
    // keyword hit regardless of its always_on frontmatter.
    // Classifies a markdown table's header (prompt copy only -- never
    // touches the source file on disk) into one of a small set of known
    // shapes, and attaches one short instruction per shape right after the
    // header. Generalizes the earlier one-off fix for "Word | Use for"
    // (which only covered 10 of 87 files) to every header shape actually
    // found across this corpus's rule tables. Deliberately an enum with a
    // short instruction per category, not a numeric score -- these tables
    // fall into a handful of genuinely distinct kinds, and a label the
    // model can act on directly beats a weight it would have to interpret.
    // UNKNOWN gets an explicit "don't assume a direction" note rather than
    // silently guessing, since guessing wrong is exactly the bug this
    // exists to prevent.
    const TABLE_TYPES = [
      {
        // "Word | Use for", "Term | Use for", "Use | Write it as"
        match: /^\|\s*(?:Word|Term|Use)\s*\|\s*(?:Use for|Write it as)\s*\|$/i,
        type: 'REPLACEMENT',
        // Kept generic and example-free on purpose -- this note is injected
        // into every REPLACEMENT-shaped table in the corpus (15 of them:
        // anatomy-female, acts_oral, acts_manual, ...), so a worked example
        // specific to one rule's own vocabulary doesn't belong here; it
        // belongs in that rule's own file (see explicit_lexicon_09's own
        // Purpose section for the concrete "livestock in a simile" example).
        note: 'left column is the MANDATED direct term; right column is the clinical/vague gloss it replaces. A word from the left column is correct usage in ANY natural grammatical form -- a direct statement, a simile ("like X"), a different tense, embedded mid-sentence -- not just an exact template match. A violation is a DIFFERENT word (the right-column gloss, or some other clinical substitute) used for that same concept INSTEAD of the left-column term. If two different rows list separate valid mandated words for a similar idea, they are not a replace-pair with each other -- using either alone is compliant.',
      },
      {
        // "Term | Meaning | Status"
        match: /^\|\s*Term\s*\|\s*Meaning\s*\|\s*Status\s*\|$/i,
        type: 'STATUS',
        note: 'the Status column states whether each term is allowed or banned directly -- defer to that column\'s own wording per term, not a general pattern.',
      },
      {
        // "Word | Context", "Word | Applied to | Context"
        match: /^\|\s*Word\s*\|\s*(?:Applied to\s*\|\s*)?Context\s*\|$/i,
        type: 'CONTEXT',
        note: 'each word is fine in the context listed, not banned outright. A violation is that word used in a DIFFERENT context than the one listed, not the word\'s mere presence.',
      },
      {
        // "Term | Meaning in this world", "Anatomy | Form present in | Term"
        match: /^\|\s*(?:Term|Anatomy)\s*\|\s*(?:Meaning in this world|Form present in\s*\|\s*Term)\s*\|$/i,
        type: 'GLOSSARY',
        note: 'defines canon terminology/meaning, not a wrong/right vocabulary pair -- a term appearing is not itself a violation signal either way.',
      },
      {
        // "Intended phrase | Placeholder"
        match: /^\|\s*Intended phrase\s*\|\s*Placeholder\s*\|$/i,
        type: 'MASKING',
        note: 'shows how a blocked phrase should be glyph-masked for the specific phrase only -- not a vocabulary correctness table.',
      },
      {
        // "File | Covers" -- a document index, not rule content.
        match: /^\|\s*File\s*\|\s*Covers\s*\|$/i,
        type: 'INDEX',
        note: 'this is a document navigation table, not content to judge the card against.',
      },
    ];

    function classifyTableHeader(headerLine) {
      for (const t of TABLE_TYPES) if (t.match.test(headerLine)) return t;
      return null; // unrecognized shape -- leave unannotated rather than guess
    }

    // Finds every "header row" + "|---|---|" separator row pair and inserts
    // the matching type note as a new line right after the separator, so
    // it sits directly above that table's data rows in the prompt.
    function annotateTables(text) {
      const lines = text.split('\n');
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        out.push(lines[i]);
        const isHeader = /^\|.+\|$/.test(lines[i].trim());
        const nextIsSeparator = lines[i + 1] && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim());
        if (isHeader && nextIsSeparator) {
          const known = classifyTableHeader(lines[i].trim());
          out.push(lines[i + 1]);
          if (known) out.push(`*[${known.type}: ${known.note}]*`);
          i++; // consumed the separator line already
        }
      }
      return out.join('\n');
    }

    function isCensorshipWorkaroundGroup(g) {
      return g.rules.some((r) => CENSORSHIP_WORKAROUND_RULE_RE.test(r.split('/').pop()));
    }

    function groupRelevance(g, cardText) {
      const lowerCard = cardText.toLowerCase();
      let alwaysOn = false;
      let universal = false;
      const keywords = [];
      for (const r of g.rules) {
        const base = r.split('/').pop();
        if (UNIVERSAL_RULE_RE.test(base)) universal = true;
        const abs = join(STORIES_ROOT_FOR_RULES, r);
        let text;
        try { text = readFileSync(abs, 'utf8'); } catch { continue; }
        const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); // \r? -- see alwaysOnContext() note on CRLF
        if (fm && /trigger:\s*always_on/.test(fm[1])) alwaysOn = true;
        const kwLine = fm && fm[1].match(/^keywords:\s*(.*)$/m);
        if (kwLine) keywords.push(...kwLine[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean));
      }
      const keywordHit = keywords.some((k) => k && lowerCard.includes(k));
      return { relevant: universal || keywordHit, alwaysOn, universal, keywordHit };
    }

    // Shared by /api/rules-check and the /api/save gate --
    // one place that knows how to fan a card out across the atomic rule
    // groups, so both surfaces report the SAME thing: which specific
    // group failed and why, not a vague blanket "flagged a violation."
    async function runRulesEnsemble(text, { model, only, all, target, dryRun, excludeUniversal, decomposed } = {}) {
      if (target && target !== 'cards' && target !== 'prose') {
        throw Object.assign(new Error("target must be 'cards' or 'prose' if provided"), { status: 400 });
      }
      const groups = loadRuleGroups(); // throws if rule_groups.json missing -- caller decides how to handle
      const wanted = only ? new Set(String(only).split(',')) : null;

      const results = [];
      const skipped = [];
      const wouldCheck = [];
      for (const g of groups) {
        if (wanted && !wanted.has(g.slug)) continue;
        // Meta-rule exclusion applies unconditionally, even under an
        // explicit only= -- it's a structural fact (this rule's premise
        // never occurs with an uncensored local model), not a relevance
        // heuristic that a caller should be able to override.
        if (isCensorshipWorkaroundGroup(g)) {
          skipped.push({ group: g.slug, reason: 'censorship-workaround rule -- moot with uncensored local model' });
          continue;
        }
        if (target && g.scope && g.scope !== 'both' && g.scope !== target) {
          skipped.push({ group: g.slug, reason: `scope ${g.scope} != target ${target}` });
          continue;
        }
        let relevanceReason = wanted ? 'explicit only=' : (all ? 'all=true' : null);
        if (!wanted && !all) {
          const { relevant, universal, keywordHit } = groupRelevance(g, text);
          // excludeUniversal: isolate the conditional (keyword-gated) rules
          // from the ~26 that are unconditionally universal -- useful for
          // testing whether the keyword-matching mechanism itself picks up
          // the right rules on a given card, separate from the always-run
          // set that's already known to fire on every check.
          if (excludeUniversal && universal && !keywordHit) { skipped.push({ group: g.slug, reason: 'excludeUniversal' }); continue; }
          if (!relevant) { skipped.push({ group: g.slug }); continue; }
          relevanceReason = universal ? 'universal (canon/safety/tone)' : 'keyword match';
        }
        const ruleText = g.rules.map((r) => {
          const abs = join(STORIES_ROOT_FOR_RULES, r);
          try { return `--- ${r} ---\n${annotateTables(readFileSync(abs, 'utf8'))}`; } catch { return `--- ${r} --- (unreadable)`; }
        }).join('\n\n');
        // annotateTables() above already tags every recognized table with
        // its own type and how to read it, right next to that table's own
        // data -- no separate paragraph of meta-instruction needed here.
        //
        // Three prompt-level persuasion/mitigation attempts were tried
        // here and reverted, all measured, none kept:
        // (1) requiring a quote of the rule's own clause before allowing
        // VIOLATION -- the model fabricated plausible-looking fake quotes
        // about as often as real ones, and flipped a correct verdict.
        // (2) A permission preamble naming "degrading" content as never-
        // a-violation -- collided with acts-degradation-handling, a rule
        // specifically about degrading language, so the model correctly
        // followed that literal instruction and suppressed a genuine
        // violation.
        // (3) A retry removing the category-naming collision, keeping only
        // "this is a licensed adult project, explicit/degrading content is
        // expected here" -- STILL suppressed the same acts-degradation-
        // handling violation, with no category-name collision left to
        // blame. That rules out "bad wording" as the cause: any framing
        // that establishes explicit/degrading content as generally
        // licensed here measurably relaxes judgment on the rules that are
        // specifically about that content, regardless of phrasing. This is
        // a weight-level effect (confirmed separately via empty-card and
        // irrelevant-content controls, both clean on every rule tried),
        // not reachable by further prompt engineering -- per-rule
        // fine-tuning is the actual fix, not persuasion wording.
        const hasTableAnnotation = /^\*\[[A-Z]+:/m.test(ruleText);
        // 14 of 86 rules (all canon_bias_card_*) carry their own **Check:**
        // diagnostic question -- the exact test the rule wants applied.
        // Confirmed by testing: even with that question sitting right in
        // the prompt verbatim, the model can ignore it entirely and reason
        // from surface lexical overlap instead (canon_bias_card_12: card
        // text echoes the rule's own canon-fact wording, model calls that
        // a "match" to "prohibited traits" and never engages the actual
        // Check -- "has base nature been SANITIZED with human inhibitions"
        // -- which the card answers "no," i.e. compliant). Forcing the
        // model to quote the Check question and answer it explicitly,
        // before the verdict, is a stronger version of the failed
        // "quote-the-rule-first" attempt: that one asked for an open-ended
        // quote (which got fabricated); this asks it to answer a specific,
        // already-written yes/no question the rule itself supplies.
        const checkMatch = ruleText.match(/\*\*Check:\*\*\s*\*(.+?)\*/);
        const hasCheckField = !!checkMatch;

        if (decomposed) {
          // Token accounting for a decomposed check is approximate (3
          // separate, growing turns rather than one prompt) -- estimate
          // conservatively as rule + card + judge instruction, each once,
          // since that's close to the sum of what actually gets sent
          // across the 3 calls (turn2 resends turn1's content via message
          // history, turn3 resends both -- so real total is higher than
          // this estimate, but assertFitsContext below still guards the
          // worst case, turn3's full history, before it's actually sent).
          const approxTokens = Math.round((ruleText.length + text.length + 200) / 4);
          if (dryRun) {
            let fits = true, fitError = null;
            try { assertFitsContext(approxTokens * 2, g.rules.length); } catch (e) { fits = false; fitError = e.message; } // *2: rough headroom for turn3's accumulated history
            wouldCheck.push({ group: g.slug, scope: g.scope, reason: relevanceReason, rules: g.rules, approxTokens, fits, fitError, decomposed: true });
            continue;
          }
          try {
            assertFitsContext(approxTokens * 2, g.rules.length);
            const { raw, ruleRestatement, cardSummary } = await runDecomposedCheck(g, ruleText, text, model);
            const ok = !/VERDICT:\s*VIOLATION/i.test(raw);
            const entry = { group: g.slug, title: g.title, ok, raw, ruleRestatement, cardSummary, approxTokens, decomposed: true };
            if (!ok) {
              const mitigationPrompt = `The following card violates the rule "${g.title}":\n\n` +
                `RULE:\n${ruleText}\n\nCARD TEXT:\n${text}\n\nVIOLATION REASONING:\n${raw}\n\n` +
                `Follow any table type annotations above for which direction is correct (e.g. a ` +
                `REPLACEMENT table's rewrite must move toward its mandated-term column, never toward ` +
                `its clinical/vague column). Write a short, concrete mitigation: quote the exact phrase(s) ` +
                `responsible, then state what a compliant rewrite of just that phrase would say instead. ` +
                `Do not rewrite the whole card.`;
              try {
                entry.mitigation = await callJudgeModel(mitigationPrompt, model);
              } catch (e) {
                entry.mitigationError = e.message;
              }
            }
            results.push(entry);
          } catch (e) {
            results.push({ group: g.slug, title: g.title, error: e.message, approxTokens, decomposed: true });
          }
          continue;
        }

        const prompt = `You are judging a card against ONLY the following rule (do not apply any other ` +
          `rule you might know of).` +
          (hasTableAnnotation ? ` Where a table below is annotated with its type, follow that ` +
            `annotation's instruction for how to read it.` : '') +
          (hasCheckField ? ` This rule includes its own diagnostic question in its **Check:** field -- ` +
            `quote that exact question, answer it yes or no based on the card text, and base your ` +
            `verdict ONLY on that answer, not on whether the card's wording happens to resemble the ` +
            `rule's own wording.` : '') +
          ` Reason briefly, then end with a single line reading exactly ` +
          `"VERDICT: VIOLATION" or "VERDICT: COMPLIANT".\n\nRULE (${g.title}):\n${ruleText}\n\nCARD TEXT:\n${text}`;
        const approxTokens = Math.round(prompt.length / 4);
        if (dryRun) {
          let fits = true, fitError = null;
          try { assertFitsContext(approxTokens, g.rules.length); } catch (e) { fits = false; fitError = e.message; }
          wouldCheck.push({ group: g.slug, scope: g.scope, reason: relevanceReason, rules: g.rules, approxTokens, fits, fitError });
          continue;
        }
        try {
          assertFitsContext(approxTokens, g.rules.length);
          const raw = await callJudgeModel(prompt, model);
          const ok = !/VERDICT:\s*VIOLATION/i.test(raw);
          const entry = { group: g.slug, title: g.title, ok, raw, approxTokens };
          // A violation alone just names the problem -- a rejection isn't
          // useful to act on without a stated fix (the reject_example()
          // training examples in rules-gatekeeper's build_dataset.py make
          // the same point). Ask the same small model for a concrete
          // mitigation, scoped to only this one rule, right after the
          // verdict that found it -- one extra small call per violation,
          // not per group, so it doesn't multiply the total runtime.
          if (!ok) {
            const mitigationPrompt = `The following card violates the rule "${g.title}":\n\n` +
              `RULE:\n${ruleText}\n\nCARD TEXT:\n${text}\n\nVIOLATION REASONING:\n${raw}\n\n` +
              `Follow any table type annotations above for which direction is correct (e.g. a ` +
              `REPLACEMENT table's rewrite must move toward its mandated-term column, never toward ` +
              `its clinical/vague column). Write a short, concrete mitigation: quote the exact phrase(s) ` +
              `responsible, then state ` +
              `what a compliant rewrite of just that phrase would say instead. Do not rewrite the whole card.`;
            try {
              entry.mitigation = await callJudgeModel(mitigationPrompt, model);
            } catch (e) {
              entry.mitigationError = e.message;
            }
          }
          results.push(entry);
        } catch (e) {
          results.push({ group: g.slug, title: g.title, error: e.message, approxTokens });
        }
      }
      if (dryRun) {
        const wontFit = wouldCheck.filter((r) => !r.fits);
        return { dryRun: true, wouldCheck: wouldCheck.length, skippedNotApplicable: skipped.length, wontFitContext: wontFit.length, groups: wouldCheck, skipped };
      }
      const errored = results.filter((r) => r.error);
      const violations = results.filter((r) => r.ok === false);
      return { ok: violations.length === 0, checked: results.length, skippedNotApplicable: skipped.length, violations, errored, results, skipped };
    }

    if (p === '/api/save' && req.method === 'POST') {
      const { path, text, force } = await readBody(req);
      if (!path || typeof text !== 'string') return send(res, 400, { error: 'path and text required' });
      // Gate saves through the rule-group ensemble unless the caller
      // explicitly overrides -- judge accuracy is unvalidated (stock model,
      // rules-only context, never trained on real chapters/cards), so a
      // block is advisory and always bypassable rather than a hard wall.
      // Reports WHICH group(s) failed and why/mitigation, not a single
      // vague verdict -- a save-time rejection is useless if it can't say
      // what to fix.
      if (!force) {
        const target = path.startsWith('stories/story/chapters/') || path.includes('/chapters/') ? 'prose' : 'cards';
        try {
          const out = await runRulesEnsemble(text, { target });
          if (!out.ok) {
            return send(res, 409, {
              error: `rules-gatekeeper flagged ${out.violations.length} violation(s)`,
              target,
              violations: out.violations.map((v) => ({ group: v.group, title: v.title, raw: v.raw, mitigation: v.mitigation })),
              forceable: true,
            });
          }
        } catch (e) {
          // rule_groups.json missing / model unreachable / unconfigured --
          // don't block saves on infrastructure not being set up.
        }
      }
      const existed = getFileSet().has(path);
      if (!existed) {
        // Allow creating a new file only inside an existing corpus directory
        // (so Save can also be used to start a new chapters/drafts/*.md),
        // never an arbitrary path outside the repo.
        const abs = join(ROOT, path);
        if (!resolve(abs).startsWith(resolve(ROOT))) return send(res, 403, { error: 'path escapes repo root' });
        mkdirSync(dirname(abs), { recursive: true });
      }
      writeFileSync(join(ROOT, path), text, 'utf8');
      refreshIndex();
      return send(res, 200, { ok: true, path, created: !existed });
    }

    // --- peer sync: request/approve/status, gating the raw export/import
    // routes below whenever they're hit from off-box (see isLoopback just
    // below) -- clicking the desktop's own Export/Import .zip buttons IS
    // the user's consent already (their own click, their own machine); a
    // request arriving over the network from another peer is not, so THAT
    // has to go through this accept/reject handshake instead. Symmetric
    // with the Android app's embedded server (LanSyncServer.kt) -- same
    // four routes, same semantics, so either side can be the requester or
    // the one asked to approve.
    if (p === '/api/sync/request' && req.method === 'POST') {
      const { direction, fromLabel } = await readBody(req);
      if (direction !== 'push' && direction !== 'pull') return send(res, 400, { error: 'direction must be "push" or "pull"' });
      pruneSyncRequests();
      const requestId = randomUUID();
      syncRequests.set(requestId, {
        direction, fromLabel: String(fromLabel || 'another device').slice(0, 80),
        status: 'pending', createdAt: Date.now(),
      });
      return send(res, 200, { requestId });
    }
    if (p === '/api/sync/pending' && req.method === 'GET') {
      pruneSyncRequests();
      return send(res, 200, [...syncRequests.entries()]
        .filter(([, r]) => r.status === 'pending')
        .map(([requestId, r]) => ({ requestId, direction: r.direction, fromLabel: r.fromLabel })));
    }
    if (p === '/api/sync/respond' && req.method === 'POST') {
      const { requestId, accept } = await readBody(req);
      const r = syncRequests.get(requestId);
      if (!r) return send(res, 404, { error: 'no such request -- it may have expired' });
      r.status = accept ? 'accepted' : 'rejected';
      return send(res, 200, { ok: true });
    }
    if (p === '/api/sync/status' && req.method === 'GET') {
      const r = syncRequests.get(url.searchParams.get('requestId'));
      if (!r) return send(res, 404, { error: 'no such request' });
      return send(res, 200, { status: r.status });
    }

    // --- export/import: desktop counterparts to the Android app's
    // CorpusZip/EpubExporter/TwineExporter, so a story can move between the
    // two the same way it moves between devices. Each export shells out to
    // a tools/*.py script (mirroring how build_twine.py already gets
    // invoked above) into a tmpdir() scratch file, then streams that file
    // back as a download and deletes it -- nothing exported lingers on disk
    // server-side once the response is sent.
    if (p === '/api/export/zip' && req.method === 'GET') {
      if (!isLoopback(req)) {
        const auth = authorizePeerRequest(url, 'pull');
        if (auth.error) return send(res, 403, { error: auth.error });
      }
      const toolsDir = join(HERE, '..');
      const out = join(tmpdir(), `story_export_${Date.now()}.zip`);
      try {
        execFileSync('python', [join(toolsDir, 'export_zip.py'), out], { cwd: toolsDir, stdio: 'pipe' });
      } catch (e) {
        return send(res, 500, (e.stderr || e.message).toString(), 'text/plain');
      }
      return sendFileDownload(res, out, `${getActiveStoryName()}.zip`, 'application/zip');
    }

    if (p === '/api/export/epub' && req.method === 'GET') {
      const toolsDir = join(HERE, '..');
      const includeImages = url.searchParams.get('images') !== '0';
      const title = getActiveStoryName();
      const out = join(tmpdir(), `story_export_${Date.now()}.epub`);
      const args = [join(toolsDir, 'export_epub.py'), out, title];
      if (!includeImages) args.push('--no-images');
      try {
        execFileSync('python', args, { cwd: toolsDir, stdio: 'pipe' });
      } catch (e) {
        return send(res, 500, (e.stderr || e.message).toString(), 'text/plain');
      }
      return sendFileDownload(res, out, `${title}.epub`, 'application/epub+zip');
    }

    if (p === '/api/export/twine' && req.method === 'GET') {
      // The standalone build is already the exact self-contained, every-
      // image-embedded single HTML file the mobile app's "Twine Reader"
      // export produces -- this just makes it downloadable instead of
      // only viewable in-app (see the /tools/twine/reader_standalone.html
      // route above, which this reuses verbatim).
      const toolsDir = join(HERE, '..');
      const readerPath = join(HERE, '..', 'twine', 'reader_standalone.html');
      try {
        execFileSync('python', [join(toolsDir, 'build_twine_standalone.py')], { cwd: toolsDir, stdio: 'pipe', maxBuffer: 1024 * 1024 * 10 });
      } catch (e) {
        if (!existsSync(readerPath)) {
          return send(res, 500, 'Twine build failed and no prior build exists:\n' + (e.stderr || e.message), 'text/plain');
        }
      }
      if (!existsSync(readerPath)) return send(res, 404, 'Twine build not available.', 'text/plain');
      return sendFileDownload(res, readerPath, `${getActiveStoryName()}_twine_reader.html`, 'text/html');
    }

    if (p === '/api/import/zip' && req.method === 'POST') {
      if (!isLoopback(req)) {
        const auth = authorizePeerRequest(url, 'push');
        if (auth.error) return send(res, 403, { error: auth.error });
      }
      const toolsDir = join(HERE, '..');
      const bytes = await readRawBody(req);
      if (!bytes.length) return send(res, 400, { error: 'no file uploaded' });
      const tmpZip = join(tmpdir(), `story_import_${Date.now()}.zip`);
      writeFileSync(tmpZip, bytes);
      const replace = url.searchParams.get('replace') !== '0'; // same replace-by-default as the mobile importer
      let out;
      try {
        out = execFileSync('python', [join(toolsDir, 'import_zip.py'), tmpZip, ...(replace ? ['--replace'] : [])], { cwd: toolsDir, stdio: 'pipe' }).toString();
      } catch (e) {
        return send(res, 500, { error: (e.stderr || e.message).toString() });
      } finally {
        try { unlinkSync(tmpZip); } catch {}
      }
      let result;
      try { result = JSON.parse(out); } catch { return send(res, 500, { error: 'import script returned unexpected output: ' + out }); }
      if (result.error) return send(res, 400, result);
      refreshIndex();
      return send(res, 200, result);
    }

    if (p === '/api/portrait') {
      const target = url.searchParams.get('path');
      if (!target || !getFileSet().has(target)) return send(res, 404, { error: 'not found' });
      return send(res, 200, resolvePortrait(target));
    }

    if (p === '/api/image') {
      const target = url.searchParams.get('path');
      if (!target) return send(res, 400, { error: 'path required' });
      return send(res, 200, resolveImage(target));
    }

    // '/tools/story_editor/assets/' is an alias for the same directory as
    // '/assets/' -- it's what the reader's relative image paths resolve to
    // when served at '/tools/twine/reader.html' (disk-depth-matched so the
    // same relative paths also work with reader.html opened directly off
    // disk, no server at all -- see that route's own comment above).
    if (p.startsWith('/assets/') || p.startsWith('/tools/story_editor/assets/')) {
      const prefix = p.startsWith('/assets/') ? '/assets/' : '/tools/story_editor/assets/';
      const rel2 = decodeURIComponent(p.slice(prefix.length));
      const abs = resolve(ASSETS_DIR, rel2);
      if (!abs.startsWith(resolve(ASSETS_DIR)) || !existsSync(abs)) return send(res, 404, { error: 'not found' });
      const ext = ('.' + abs.split('.').pop()).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) return send(res, 404, { error: 'not an image' });
      res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
      return res.end(readFileSync(abs));
    }

    if (p === '/api/card') {
      const target = url.searchParams.get('path');
      if (!target || !getFileSet().has(target)) return send(res, 404, { error: 'not found', path: target });
      return send(res, 200, cardPayload(target));
    }

    if (p === '/api/link-suggest') {
      // Powers the editor's autosuggest while typing inside a markdown
      // link's target -- e.g. typing `](titt` after a link label. Returns
      // the relative path already computed from `from`'s own directory
      // (same math as /api/missing-links/apply and /api/fs/rename), so the
      // client can insert it verbatim without doing path-relative math of
      // its own in the browser.
      const from = url.searchParams.get('from') || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!from || !getFileSet().has(from)) return send(res, 404, { error: 'from not found' });
      const fromAbs = join(ROOT, from);
      const hits = [];
      for (const f of getFiles().map(rel)) {
        if (f === from || hiddenSet.has(f)) continue;
        const title = heading(join(ROOT, f)) || f;
        if (q && !title.toLowerCase().includes(q) && !f.toLowerCase().includes(q)) continue;
        const relPath = relative(dirname(fromAbs), join(ROOT, f)).split(sep).join('/');
        hits.push({ path: f, title, relPath });
        if (hits.length >= 20) break;
      }
      return send(res, 200, hits);
    }

    if (p === '/api/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return send(res, 200, []);
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const hits = [];
      for (const f of getFiles()) {
        const rf = rel(f);
        if (hiddenSet.has(rf)) continue;
        const title = heading(f) || '';
        if (re.test(title) || re.test(rf)) { hits.push({ path: rf, title, why: 'name' }); continue; }
        const lines = readFileSync(f, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) { hits.push({ path: rf, title, why: 'text', line: i + 1, snippet: lines[i].trim().slice(0, 160) }); break; }
        }
        if (hits.length >= 200) break;
      }
      return send(res, 200, hits);
    }

    if (p === '/api/context') {
      const arc = url.searchParams.get('arc');
      if (!arc || !getFileSet().has(arc)) return send(res, 404, { error: 'arc not found', arc });
      const depth = Number(url.searchParams.get('depth') || 2);
      const maxWords = Number(url.searchParams.get('maxWords') || 8000);
      const beatRaw = url.searchParams.get('beat');
      const beat = beatRaw ? Number(beatRaw) : null;
      const data = contextData(arc, { depth, maxWords, beat, hidden: hiddenSet });
      if (!data) return send(res, 404, { error: 'context build failed', arc });
      return send(res, 200, data);
    }

    if (p === '/api/highlight') {
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' });
      const { prose, nodes } = await readBody(req);
      return send(res, 200, highlightMatches(prose || '', nodes || []));
    }

    if (p === '/api/beats') {
      const arc = url.searchParams.get('arc');
      if (!arc) return send(res, 400, { error: 'arc required' });
      const base = arc.replace(/^.*\//, '').replace(/\.md$/, '');
      const dir = join(ROOT, 'plot', 'arcs', 'beats', base);
      let n = 0;
      try { n = readdirSync(dir).filter((f) => /^\d\d\.md$/.test(f)).length; } catch { /* no beats dir */ }
      return send(res, 200, { arc, beats: n });
    }

    // ---- ops queue ----
    if (p === '/api/ops/create' && req.method === 'POST') {
      const { type, path, pathA, pathB, depth, maxWords, selectedPaths, draftName, currentText } = await readBody(req);
      if (type === 'draft-chapter') {
        if (!path || !getFileSet().has(path)) return send(res, 404, { error: 'arc not found' });

        // selectedPaths, if given, is the exact card list the user curated
        // in the context panel (auto traversal minus removed, plus manual
        // adds) — takes priority over re-running the weighted traversal so
        // "selection/removal" in the UI actually controls what the drafting
        // job sees.
        let compacted;
        if (Array.isArray(selectedPaths) && selectedPaths.length) {
          const valid = selectedPaths.filter((sp) => sp !== path && getFileSet().has(sp));
          const included = valid.map((sp) => ({
            path: sp,
            title: heading(join(ROOT, sp)) || sp,
            role: sp.startsWith('.agents/rules/') ? 'rule' : 'selected',
            full: true,
            words: 0,
            text: readFileSync(join(ROOT, sp), 'utf8'),
          }));
          const rootText = readFileSync(join(ROOT, path), 'utf8');
          included.unshift({ path, title: heading(join(ROOT, path)) || path, role: 'root', full: true, words: 0, text: rootText });
          compacted = { start: path, included, omitted: [], totalWords: included.reduce((s, c) => s + c.text.split(/\s+/).length, 0) };
        } else {
          compacted = contextData(path, { depth: depth || 2, maxWords: maxWords || 8000, hidden: hiddenSet });
        }
        if (!compacted) return send(res, 404, { error: 'context build failed' });

        const base = (draftName && draftName.trim()) ? slugify(draftName.trim()) : path.replace(/^.*\//, '').replace(/\.md$/, '');
        const suggestedDraftPath = `chapters/drafts/${base}.md`;
        const alreadyExists = getFileSet().has(suggestedDraftPath);
        const job = writeJob('draft-chapter', { arcPath: path, suggestedDraftPath, alreadyExists, compactedContext: compacted });

        // Try live generation via the configured Mistral agent first; on any
        // failure (not configured, network error, empty response) the job
        // is left pending in the queue for the manual Claude-worker flow in
        // ops/README.md, same as before this integration existed.
        if (mistralReady() && !alreadyExists) {
          try {
            const contextText = compacted.included.map((c) => `--- ${c.path} ---\n${c.text}`).join('\n\n');
            const prompt = `You are the sole prose writer for one chapter of this serialized dark-fantasy erotica corpus.\n\nARC + COMPACTED CONTEXT (this already includes the relevant house-style rules, beats, and character/lore/setting cards for this arc):\n${contextText}\n\nTASK: Write the chapter in full, natural prose to the same quality and voice as the rest of the corpus -- setup, dialogue, blocking, interiority, aftermath, everything non-explicit written completely. At each beat that calls for an explicit sex act, stop short of writing the act itself and instead leave a standalone paragraph in exactly this form:\n[[EXPLICIT SCENE — beat: <one or two sentences naming exactly what happens: who, what act(s), what changes by the end of it>]]\n\nOutput ONLY the chapter markdown (a "# Title" heading plus prose) -- no meta-commentary, no frontmatter block.`;
            const draft = stripMistralWrapper(await callMistralAgent(prompt));
            if (draft) {
              const markerCount = (draft.match(/\[\[EXPLICIT SCENE/g) || []).length;
              const outAbs = join(ROOT, suggestedDraftPath);
              mkdirSync(dirname(outAbs), { recursive: true });
              writeFileSync(outAbs, draft, 'utf8');
              const result = {
                id: job.id, type: 'draft-chapter', completedAt: new Date().toISOString(),
                summary: `Drafted via Mistral (${markerCount} explicit marker${markerCount === 1 ? '' : 's'}).`,
                draftPath: suggestedDraftPath, explicitMarkerCount: markerCount,
              };
              writeFileSync(join(resultsDir(), `${job.id}.json`), JSON.stringify(result, null, 2), 'utf8');
              return send(res, 200, { ...job, status: 'done', result, mistral: true });
            }
          } catch (e) { /* fall through — leave the job pending */ }
        }
        return send(res, 200, job);
      }
      if (type === 'reformat') {
        if (!path || !getFileSet().has(path)) return send(res, 404, { error: 'path not found' });
        // currentText: the editor buffer at the moment "Reformat" was
        // clicked, which may include unsaved edits -- reformatting should
        // work on what's actually on screen, not force a save first.
        const raw = currentText || readFileSync(join(ROOT, path), 'utf8');
        const isChapterLike = path.startsWith('chapters/');
        let styleRules = [];
        if (isChapterLike) {
          for (const rulePath of ['.agents/rules/prose-draft-placeholder-convention.md', '.agents/rules/chapter-prose-and-subtext.md']) {
            if (getFileSet().has(rulePath)) styleRules.push({ path: rulePath, text: readFileSync(join(ROOT, rulePath), 'utf8') });
          }
        }
        // A same-directory sibling as a concrete structural example --
        // "match this shape" is easier to follow than a prose description
        // of the convention, especially for card files with no dedicated
        // rule doc of their own.
        let exampleCard = null;
        const dir = dirname(path);
        const sibling = getFiles().map(rel).find((f) => f !== path && dirname(f) === dir && !hiddenSet.has(f));
        if (sibling) exampleCard = { path: sibling, text: readFileSync(join(ROOT, sibling), 'utf8') };
        const job = writeJob('reformat', { path, raw, isChapterLike, styleRules, exampleCard });

        if (mistralReady()) {
          try {
            const rulesText = styleRules.map((r) => `--- ${r.path} ---\n${r.text}`).join('\n\n');
            const exampleText = exampleCard ? `--- Example sibling to match structurally: ${exampleCard.path} ---\n${exampleCard.text}` : '';
            const guidance = isChapterLike
              ? `CHAPTER HOUSE-STYLE RULES (natural prose + "[[EXPLICIT SCENE — beat: ...]]" markers, not fully-written explicit content):\n${rulesText}`
              : `MATCH THIS SAME-DIRECTORY SIBLING CARD'S STRUCTURE (frontmatter fields, section headings, tone) rather than inventing a new shape:\n${exampleText}`;
            const prompt = `You are reformatting one file into this corpus's house format. This is a FORMAT TRANSFORM ONLY, not a content rewrite -- preserve every fact, beat, and detail already present in the raw text below; only the shape changes (frontmatter, section structure, prose register if it's a chapter). Do not invent new content to fill gaps the raw text didn't have.\n\n${guidance}\n\nRAW TEXT AS IT CURRENTLY STANDS:\n${raw}\n\nOutput ONLY the reformatted file content, no meta-commentary.`;
            const reformatted = stripMistralWrapper(await callMistralAgent(prompt));
            if (reformatted) {
              writeFileSync(join(ROOT, path), reformatted, 'utf8');
              const result = { id: job.id, type: 'reformat', completedAt: new Date().toISOString(), summary: 'Reformatted to house style via Mistral.', path };
              writeFileSync(join(resultsDir(), `${job.id}.json`), JSON.stringify(result, null, 2), 'utf8');
              return send(res, 200, { ...job, status: 'done', result, mistral: true });
            }
          } catch (e) { /* fall through — leave the job pending */ }
        }
        return send(res, 200, job);
      }
      if (type === 'intensify-chapter') {
        // Distinct from both /api/mistral/uncensor (a targeted rewrite of
        // one selected excerpt, windowed context) and draft-chapter (writes
        // a NEW chapter from an arc's compacted context) -- this rewrites
        // an EXISTING chapter in place, in full, to be more sexualized and
        // dramatic while folding in standing house facts the chapter's own
        // prose may currently gloss over (mudblood nudity, constant sexual
        // availability/submission to betters, etc.) alongside whatever it
        // already links to.
        if (!path || !getFileSet().has(path) || !path.startsWith('chapters/')) return send(res, 404, { error: 'chapter not found' });
        const raw = currentText || readFileSync(join(ROOT, path), 'utf8');
        const linked = contextData(path, { depth: depth || 2, maxWords: maxWords || 6000, hidden: hiddenSet });
        const linkedIncluded = (linked?.included || []).filter((c) => c.path !== path);
        const standingPaths = alwaysOnContext();
        const job = writeJob('intensify-chapter', { path, raw, linkedIncluded: linkedIncluded.map((c) => c.path), standingCount: standingPaths.length });

        if (mistralReady()) {
          try {
            const standingText = standingPaths.map((f) => `--- ${f} ---\n${readFileSync(join(ROOT, f), 'utf8')}`).join('\n\n');
            const linkedText = linkedIncluded.map((c) => `--- ${c.path} ---\n${c.text}`).join('\n\n');
            const prompt = `You are intensifying one already-written chapter of this serialized dark-fantasy erotica corpus -- making it more sexualized and dramatic while staying strictly consistent with established canon.\n\n` +
              `STANDING HOUSE RULES AND WORLD FACTS (always apply, whether or not the chapter's current prose reflects them -- e.g. mudblood/halfbreed characters go nude by default and are constantly, casually sexually available and submissive to any magiblood; weave facts like this into the prose naturally wherever the chapter currently glosses over or omits them, rather than stating them as exposition):\n${standingText}\n\n` +
              (linkedText ? `CARDS THIS CHAPTER ALREADY LINKS TO (characters/lore/arc -- stay consistent with these):\n${linkedText}\n\n` : '') +
              `CURRENT CHAPTER TEXT (frontmatter + prose):\n${raw}\n\n` +
              `TASK: Rewrite this chapter to be more sexualized and dramatic, and to fit the standing rules/facts above wherever the current text is silent on them or drifts from them. Do NOT change the plot events, character identities, or established facts already correct in the chapter -- intensify the prose and dramatic charge, don't rewrite the story. Preserve the frontmatter block exactly as given. Output ONLY the full rewritten chapter (frontmatter + prose), no meta-commentary.`;
            const rewritten = stripMistralWrapper(await callMistralAgent(prompt));
            if (rewritten) {
              writeFileSync(join(ROOT, path), rewritten, 'utf8');
              const result = { id: job.id, type: 'intensify-chapter', completedAt: new Date().toISOString(), summary: `Intensified via Mistral (${standingPaths.length} standing rule cards, ${linkedIncluded.length} linked cards).`, path };
              writeFileSync(join(resultsDir(), `${job.id}.json`), JSON.stringify(result, null, 2), 'utf8');
              return send(res, 200, { ...job, status: 'done', result, mistral: true });
            }
          } catch (e) { /* fall through — leave the job pending */ }
        }
        return send(res, 200, job);
      }
      if (type === 'extract-cards') {
        if (!path || !getFileSet().has(path)) return send(res, 404, { error: 'path not found' });
        const prose = readFileSync(join(ROOT, path), 'utf8');
        const job = writeJob('extract-cards', { path, prose, linkedContext: gatherLinkedContext(path, { hops: 1 }) });
        return send(res, 200, job);
      }
      if (type === 'contradictions-context') {
        if (!path || !getFileSet().has(path)) return send(res, 404, { error: 'path not found' });
        const prose = readFileSync(join(ROOT, path), 'utf8');
        const job = writeJob('contradictions-context', { path, prose, linkedContext: gatherLinkedContext(path, { hops: 1 }) });
        return send(res, 200, job);
      }
      if (type === 'contradictions-chapters') {
        if (!pathA || !pathB || !getFileSet().has(pathA) || !getFileSet().has(pathB)) return send(res, 404, { error: 'path not found' });
        const job = writeJob('contradictions-chapters', {
          pathA, pathB,
          proseA: readFileSync(join(ROOT, pathA), 'utf8'),
          proseB: readFileSync(join(ROOT, pathB), 'utf8'),
        });
        return send(res, 200, job);
      }
      return send(res, 400, { error: 'unknown op type' });
    }

    if (p === '/api/mistral/usage') {
      return send(res, 200, { configured: mistralReady(), ...mistralUsage });
    }

    // Rewrites a single highlighted excerpt in full, explicit prose, using
    // only the current chapter (not the arc's compacted card traversal) as
    // context, per the tool's own scoping for this op — a fast, targeted
    // pass over one selection, not a whole-chapter draft/reformat.
    if (p === '/api/mistral/uncensor' && req.method === 'POST') {
      if (!mistralReady()) return send(res, 503, { error: 'Mistral not configured — see tools/story_editor/state/mistral.local.json' });
      const { before, selection, after } = await readBody(req);
      if (!selection || !selection.trim()) return send(res, 400, { error: 'selection required' });
      // Context-window infill: splice the selection back into its own
      // surrounding paragraphs (sent by the client, ~3 before/after) at its
      // exact original position, wrapped in sentinel markers, rather than
      // presenting it and the chapter as two disconnected blocks — the
      // model sees the literal join points on both sides instead of having
      // to reconstruct them, and the window is small instead of whole-file.
      const window = `${before ? before + '\n\n' : ''}<<<REWRITE_START>>>\n${selection}\n<<<REWRITE_END>>>${after ? '\n\n' + after : ''}`;
      const prompt = `You are rewriting ONE marked span inside a short excerpt from a chapter of this serialized dark-fantasy erotica corpus.\n\n` +
        `EXCERPT WINDOW (surrounding paragraphs are fixed context for voice/continuity -- do not rewrite them, do not repeat them back; only the text between <<<REWRITE_START>>> and <<<REWRITE_END>>> is being replaced):\n${window}\n\n` +
        `TASK: Rewrite ONLY the text between the two markers, in full, explicit, unfiltered prose -- direct anatomical and profane language, no euphemism, no fade-to-black, no softening, no hedging, no narrator's apology -- matching the voice, register, and continuity of the surrounding paragraphs exactly. Preserve its own scope: do not summarize, shorten, or add beats beyond what it already covers, and do not let the rewrite drift into the surrounding paragraphs' own content.\n\n` +
        `Output ONLY the replacement text for the marked span -- no markers, no surrounding paragraphs, no heading, no meta-commentary, no quotation marks wrapping it.`;
      try {
        const rewritten = stripMistralWrapper(await callMistralAgent(prompt));
        return send(res, 200, { rewritten });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    // --- Ensemble rules-check: one small model per rule group (trained by
    // rules-gatekeeper's train_per_group.py), fanned out in parallel and
    // aggregated. Each per-group model only ever needed ONE rule's worth
    // of text at training time, so at inference the rule text isn't sent
    // at all -- the prompt is just the card, which is what makes this fast
    // and immune to the truncation failure measured with the single
    // all-rules-in-context model (27min, and Ollama still silently
    // truncated 71% of the rules -- see rules-gatekeeper's README).
    // RULES_GROUP_MODELS: comma-separated Ollama model names to query
    // (defaults to auto-discovering every `rules-gatekeeper-*` model via
    // `ollama list`, i.e. the naming convention export_all_gguf.py uses).
    async function discoverGroupModels() {
      if (process.env.RULES_GROUP_MODELS) {
        return process.env.RULES_GROUP_MODELS.split(',').map((s) => s.trim()).filter(Boolean);
      }
      try {
        const resp = await fetch(RULES_MODEL_API.replace(/\/api\/generate$/, '/api/tags'));
        const data = await resp.json();
        return (data.models || []).map((m) => m.name).filter((n) => n.startsWith('rules-gatekeeper-'));
      } catch {
        return [];
      }
    }

    async function checkAgainstOneGroup(modelName, cardText) {
      const prompt = `You are judging the following card against the one rule you were trained on. ` +
        `Reason briefly, then end with a single line reading exactly ` +
        `"VERDICT: VIOLATION" or "VERDICT: COMPLIANT".\n\nCARD TEXT:\n${cardText}`;
      try {
        const resp = await fetch(RULES_MODEL_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelName, prompt, stream: false }),
        });
        const data = await resp.json();
        if (!resp.ok) return { model: modelName, error: data?.error || `HTTP ${resp.status}` };
        const raw = (data.response || '').trim();
        if (!raw) return { model: modelName, error: 'no content' };
        const violation = /VERDICT:\s*VIOLATION/i.test(raw);
        return { model: modelName, ok: !violation, raw };
      } catch (e) {
        return { model: modelName, error: e.message };
      }
    }

    if (p === '/api/rules-check' && req.method === 'POST') {
      const { text, model, only, all, target, dryRun, excludeUniversal, decomposed } = await readBody(req);
      if (!text || !text.trim()) return send(res, 400, { error: 'text required' });
      try {
        const out = await runRulesEnsemble(text, { model, only, all, target, dryRun, excludeUniversal, decomposed });
        return send(res, 200, out);
      } catch (e) {
        return send(res, e.status || 503, { error: e.message });
      }
    }

    // Future path, not yet usable: queries real rules-gatekeeper-<slug>
    // Ollama models produced by rules-gatekeeper's train_per_group.py +
    // export_all_gguf.py, once that training has actually been run (needs
    // a GPU -- not done as of this writing). /api/rules-check above is the
    // current working gatekeeper (a stock model + rule-group context, not
    // a stand-in for this) and requires no training step.
    if (p === '/api/rules-check-trained-ensemble' && req.method === 'POST') {
      const { text, target } = await readBody(req);
      if (!text || !text.trim()) return send(res, 400, { error: 'text required' });
      if (target && target !== 'cards' && target !== 'prose') {
        return send(res, 400, { error: "target must be 'cards' or 'prose' if provided" });
      }
      let models = await discoverGroupModels();
      // Same scope filter as /api/rules-check -- a rules-gatekeeper-<slug>
      // model is named after its group's slug, so rule_groups.json's scope
      // field applies here too once real per-group models exist.
      if (target) {
        try {
          const scopeBySlug = new Map(loadRuleGroups().map((g) => [g.slug, g.scope]));
          models = models.filter((m) => {
            const slug = m.replace(/^rules-gatekeeper-/, '');
            const scope = scopeBySlug.get(slug);
            return !scope || scope === 'both' || scope === target;
          });
        } catch { /* rule_groups.json unavailable -- fall back to unfiltered */ }
      }
      if (!models.length) {
        return send(res, 503, { error: 'no rules-gatekeeper-* models registered — run rules-gatekeeper/export/export_all_gguf.py, or set RULES_GROUP_MODELS' });
      }
      // Fan out in parallel -- this is the whole point of per-group models:
      // N small independent judgments running concurrently instead of one
      // model serially reasoning over all rules at once.
      const results = await Promise.all(models.map((m) => checkAgainstOneGroup(m, text)));
      const errored = results.filter((r) => r.error);
      const violations = results.filter((r) => r.ok === false);
      return send(res, 200, {
        ok: violations.length === 0,
        checked: results.length,
        violations,
        errored,
        results,
      });
    }

    // Drafts a short passage from a scene brief, grounded only in the
    // rules-only fine-tune rather than context-stuffed Mistral calls.
    if (p === '/api/rules-generate' && req.method === 'POST') {
      const { brief } = await readBody(req);
      if (!brief || !brief.trim()) return send(res, 400, { error: 'brief required' });
      try {
        const raw = await callRulesModel(`Write a short passage for the following brief, holding to every rule you were trained on:\n\n${brief}`);
        return send(res, 200, { text: raw });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (p === '/api/ops/list') return send(res, 200, listJobs());

    if (p === '/api/ops/job') {
      const id = url.searchParams.get('id');
      const qPath = join(queueDir(), `${id}.json`);
      if (!existsSync(qPath)) return send(res, 404, { error: 'no such job' });
      const job = JSON.parse(readFileSync(qPath, 'utf8'));
      const rPath = join(resultsDir(), `${id}.json`);
      const result = existsSync(rPath) ? JSON.parse(readFileSync(rPath, 'utf8')) : null;
      return send(res, 200, { job, result });
    }

    if (p === '/api/ops/result' && req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload.id) return send(res, 400, { error: 'id required' });
      writeFileSync(join(resultsDir(), `${payload.id}.json`), JSON.stringify(payload, null, 2), 'utf8');
      return send(res, 200, { ok: true });
    }

    if (p === '/api/ops/apply-card' && req.method === 'POST') {
      const { path, body } = await readBody(req);
      if (!path || typeof body !== 'string') return send(res, 400, { error: 'path and body required' });
      const norm = path.replace(/^\/+/, '');
      if (!CREATABLE_DIRS.some((d) => norm.startsWith(d))) {
        return send(res, 403, { error: `path must be under one of: ${CREATABLE_DIRS.join(', ')}` });
      }
      if (getFileSet().has(norm) || existsSync(join(ROOT, norm))) {
        return send(res, 409, { error: 'file already exists — apply-card only creates new cards' });
      }
      const abs = join(ROOT, norm);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      refreshIndex();
      return send(res, 200, { ok: true, path: norm });
    }

    // ---- git ----
    if (p === '/api/git/status') return send(res, 200, gitStatus());
    if (p === '/api/git/log') return send(res, 200, gitLog(url.searchParams.get('path'), Number(url.searchParams.get('limit') || 20)));
    if (p === '/api/git/diff') return send(res, 200, gitContentPair(url.searchParams.get('path')));
    if (p === '/api/git/show') return send(res, 200, gitContentPair(url.searchParams.get('path'), url.searchParams.get('commit')));
    if (p === '/api/git/stage' && req.method === 'POST') {
      const { paths } = await readBody(req);
      if (!Array.isArray(paths) || !paths.length) return send(res, 400, { error: 'paths required' });
      git(['add', '--', ...paths]);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/git/commit' && req.method === 'POST') {
      const { paths, message } = await readBody(req);
      if (!Array.isArray(paths) || !paths.length) return send(res, 400, { error: 'paths required' });
      if (!message || !message.trim()) return send(res, 400, { error: 'message required' });
      git(['add', '--', ...paths]);
      git(['commit', '-m', message]);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'no route', path: p });
  } catch (e) {
    send(res, 500, { error: String(e && e.stack || e) });
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Story editor: ${url}`);
  console.log(`Serving ${getFiles().length} files from ${ROOT}`);
  if (AUTO_OPEN) {
    // `start "" url` via ShellExecute opens the default browser without
    // spawning a visible console window of its own (unlike `start` on a
    // console-app command, which does) — safe to fire-and-forget.
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    execFileSync(opener[0], opener[1], { stdio: 'ignore' });
  }
});
