// Shared rule-group selection logic for the rules-check-manual skill.
// Used by both select.mjs (CLI) and mcp-server.mjs (MCP tool). Reimplements
// ONLY the group-selection gates from tools/story_editor/server.mjs's
// runRulesEnsemble() (censorship-workaround exclusion -> scope gate ->
// universal/keyword relevance gate) -- see select.mjs's header comment for
// why this exists as a standalone reimplementation rather than importing
// server.mjs directly (that file's relevant functions are closures inside
// its own request-handling scope, not exported).

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// .agents/skills/rules-check-manual -> story-editor root -> repo root (sibling of stories-repo)
export const STORY_EDITOR_ROOT = resolve(HERE, '..', '..', '..');
export const STORIES_REPO_ROOT = STORY_EDITOR_ROOT; // rules live under worlds/<name>/.agents/rules
export const RULES_GATEKEEPER_ROOT = process.env.RULES_GATEKEEPER_ROOT || resolve(STORY_EDITOR_ROOT, 'services', 'rules-gatekeeper');

// --- same regexes as server.mjs (kept identical on purpose -- see
// server.mjs's own comments above these for why each one exists) ---
const UNIVERSAL_RULE_RE = /^(canon_bias_card_|content_boundaries|content-boundaries|humanoid_offspring_and_minors|humanoid-offspring-and-minors|dark-fantasy|chapters-archive-off-limits)/;
const CENSORSHIP_WORKAROUND_RULE_RE = /^(content_boundaries_04_when_declining|content_boundaries_05_why|canon_bias_card_11|commercial-ai-masking-pre-read|prose-placeholder-convention|prose_placeholder_convention_|prose-draft-placeholder-convention)/;

function isCensorshipWorkaroundGroup(g) {
  return g.rules.some((r) => CENSORSHIP_WORKAROUND_RULE_RE.test(r.split('/').pop()));
}

function groupRelevance(g, cardText) {
  const lowerCard = cardText.toLowerCase();
  let universal = false;
  const keywords = [];
  for (const r of g.rules) {
    const base = r.split('/').pop();
    if (UNIVERSAL_RULE_RE.test(base)) universal = true;
    const abs = join(STORIES_REPO_ROOT, r);
    let t;
    try { t = readFileSync(abs, 'utf8'); } catch { continue; }
    const fm = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const kwLine = fm && fm[1].match(/^keywords:\s*(.*)$/m);
    if (kwLine) keywords.push(...kwLine[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean));
  }
  const keywordHit = keywords.some((k) => k && lowerCard.includes(k));
  return { relevant: universal || keywordHit, universal, keywordHit };
}

export function loadRuleGroups() {
  const groupsPath = join(RULES_GATEKEEPER_ROOT, 'data', 'rule_groups.json');
  if (!existsSync(groupsPath)) {
    throw new Error(`rule_groups.json not found at ${groupsPath} -- run rules-gatekeeper/data/collapse_rules.py, or set RULES_GATEKEEPER_ROOT`);
  }
  return JSON.parse(readFileSync(groupsPath, 'utf8'));
}

/**
 * @param {string} text - the card/chapter text to select applicable rule groups for
 * @param {{target?: 'cards'|'prose', excludeUniversal?: boolean, only?: string[]}} opts
 * @returns {{checked: Array<{slug,title,scope,reason,ruleText}>, skipped: Array<{slug,reason}>}}
 */
export function selectRuleGroups(text, opts = {}) {
  const { target = null, excludeUniversal = false, only = null } = opts;
  const groups = loadRuleGroups();
  const checked = [];
  const skipped = [];
  const onlySet = only && only.length ? new Set(only) : null;

  for (const g of groups) {
    if (onlySet && !onlySet.has(g.slug)) { skipped.push({ slug: g.slug, reason: 'not in only' }); continue; }
    if (isCensorshipWorkaroundGroup(g)) {
      skipped.push({ slug: g.slug, reason: 'censorship-workaround rule -- moot with an uncensored/unfiltered judge' });
      continue;
    }
    if (target && g.scope && g.scope !== 'both' && g.scope !== target) {
      skipped.push({ slug: g.slug, reason: `scope ${g.scope} != target ${target}` });
      continue;
    }
    const { relevant, universal, keywordHit } = groupRelevance(g, text);
    if (excludeUniversal && universal && !keywordHit) {
      skipped.push({ slug: g.slug, reason: 'universal excluded by excludeUniversal' });
      continue;
    }
    if (!onlySet && !relevant) {
      skipped.push({ slug: g.slug, reason: 'no keyword hit and not universal' });
      continue;
    }
    const ruleText = g.rules.map((r) => {
      const abs = join(STORIES_REPO_ROOT, r);
      try { return `--- ${r} ---\n${readFileSync(abs, 'utf8')}`; } catch { return `--- ${r} --- (unreadable)`; }
    }).join('\n\n');
    const reason = onlySet ? 'explicit only=' : (universal ? 'universal (canon/safety/tone)' : 'keyword match');
    checked.push({ slug: g.slug, title: g.title, scope: g.scope, reason, ruleText });
  }

  return { checked, skipped };
}
