---
name: rules-check-manual
description: Check a card or chapter draft against the story's agent rules (.agents/rules/*.md) by having Claude Code itself act as the judge — no Ollama, no Anthropic API, no billing. Use when asked to rules-check, validate, or lint a card/chapter against canon, and no local judge model or API credits are available.
---

# rules-check-manual

Emulates `/api/rules-check` (in
[tools/story_editor/server.mjs](../../tools/story_editor/server.mjs)) but
with **you, the calling agent, as the judge model** instead of a local
Ollama model or the Anthropic API. Use this when neither is available or
convenient (no GPU, no API credits) — the group-selection logic is
identical; only who does the judging changes.

## Why this exists

`/api/rules-check`'s value isn't the HTTP endpoint — it's the *pipeline*:
figure out which of the ~89 rule groups actually apply to a given piece of
text, then check the text against only those, one group at a time, so no
irrelevant rule can produce a false positive and no relevant one gets
missed by being buried in an 89-rule context dump. That selection step is
pure logic (frontmatter keywords, universal-rule list, scope, a
censorship-workaround exclusion list) — it needs no model at all. Only the
actual judging step needs a model, and you already are one.

## Step 1 — select applicable rule groups

Two equivalent ways to run the same selection logic (both call
[lib.mjs](lib.mjs)'s `selectRuleGroups()`):

**CLI** (works anywhere, no setup):
```bash
node .agents/skills/rules-check-manual/select.mjs --text-file <path-to-card-or-chapter> --target cards
```

Use `--target prose` for a chapter/prose draft instead of a card. Omit
`--target` to check both scopes. Add `--exclude-universal` to skip the
always-checked canon/safety/tone rules and see only what a keyword hit
picked up. Add `--only slugA,slugB` to force-check specific groups
regardless of relevance (bypasses the keyword/universal gate, still
respects the censorship-workaround exclusion).

Pipe text on stdin instead of `--text-file` if you already have it loaded
in context and don't want a temp file.

**MCP tool** (if [mcp-server.mjs](mcp-server.mjs) is registered — see
`.mcp.json` in this repo's root, or `claude mcp add` for a user-level
registration): call `select_rule_groups` with `{ text, target?,
excludeUniversal?, only? }`, same parameters as the CLI flags above. Prefer
this when the host surfaces MCP tools directly rather than shelling out.

Output (CLI: stdout JSON; MCP: the tool result's single text content block,
same JSON) is one object:
```json
{
  "checked": [ { "slug": "...", "title": "...", "scope": "...", "reason": "...", "ruleText": "--- path ---\n<full rule file contents>" } ],
  "skipped": [ { "slug": "...", "reason": "..." } ]
}
```
`checked[].ruleText` already has the full text of every rule file in that
group — you don't need to separately Read the `.agents/rules/*.md` files.

## Step 2 — judge each checked group yourself

For every entry in `checked`, read its `ruleText` and the card/chapter text
side by side and decide **VIOLATION** or **COMPLIANT**, exactly the way the
API's judge prompt asks a model to:

- If the rule text contains a `**Check:** *...*` field, answer that exact
  question directly — don't reason freely past it. This one behavior fixed
  the most common failure mode measured against the local Ollama judge
  (polarity inversion — flagging compliant content as a violation or vice
  versa).
- A markdown table in a rule is very often a **vocabulary mandate**
  (approved-word / replace-this-word list), not a violation checklist.
  Don't flag a card for containing a word that appears in such a table —
  that's the rule telling you to use it, not to avoid it. Read the table's
  own heading and surrounding prose to tell which kind it is before
  judging.
- Universal rules (`reason: "universal (canon/safety/tone)"`) exist
  specifically to catch violations **by omission** — the drift they guard
  against usually isn't a banned word, it's a missing or wrong framing
  (e.g. treating trained-stock reflexes as concealing a "real"
  personality, or reading gruesome content as evidence of cruelty). Don't
  dismiss a universal-rule check just because the card doesn't contain any
  obviously matching keyword — that's exactly why it's on the universal
  list instead of the keyword-gated one.
- On VIOLATION, say what specifically violates (quote the offending
  passage) and suggest a concrete mitigation — a rewrite or trim, not just
  "remove this."
- Judge each group independently. Do not let an early verdict anchor a
  later one — this mirrors the "per-group isolation" finding from testing
  the decomposed multi-turn mode: judging groups together made the judge
  drag a wrong prior verdict into unrelated groups.

## Step 3 — report

Summarize as a table: group slug, verdict, one-line reason, and (for any
VIOLATION) the mitigation. This is the same shape `/api/save`'s 409
response returns to the story-editor UI, so it should be usable as a
drop-in stand-in when that endpoint can't reach a judge model.

## When to prefer this over `/api/rules-check`

- No Ollama model running and no `ANTHROPIC_API_KEY` credit balance.
- A quick check on a small card where spinning up the server is overkill.
- You want to double-check a verdict the local Ollama judge gave, since
  measured testing found it prone to specific failure modes (fabricated
  quotes when forced to cite a clause, polarity inversion on some
  degradation-vocabulary rules, inconsistent verdicts across closely
  related rules even with identical context).

## When NOT to use this

- A batch/unattended run over many cards — this is inherently
  interactive/manual (you doing the reasoning), not something to script in
  a loop without review.
- When `/api/save`'s gate needs to run automatically on every save click
  in the story-editor UI — that path needs an actual reachable judge
  (Ollama or Anthropic), since there's no agent in the loop at save time.

## Gotchas

- `lib.mjs` (used by both `select.mjs` and `mcp-server.mjs`) resolves rule
  paths relative to the `stories-repo` root, assumed to be a sibling
  directory of `story-editor` (`../stories-repo` from this skill's
  location). Set `RULES_GATEKEEPER_ROOT` env var if `rules-gatekeeper`
  isn't a sibling directory either (default: `../rules-gatekeeper`).
- Needs `rules-gatekeeper/data/rule_groups.json` to exist — regenerate it
  with `python collapse_rules.py` in that repo if a rule file was
  added/removed/renamed since it was last built.
- This reimplements server.mjs's selection gates by hand (kept
  byte-for-byte identical to the regexes in `runRulesEnsemble`/
  `groupRelevance` as of this writing) — if those gates change in
  server.mjs, update `lib.mjs` to match, or the paths will silently drift
  apart.
- `mcp-server.mjs` implements the MCP stdio JSON-RPC framing (`Content-Length`-prefixed
  messages) by hand rather than pulling in `@modelcontextprotocol/sdk`, per
  this project's zero-dependency convention — it uses raw `Buffer`
  concatenation throughout specifically because rule text contains
  multi-byte UTF-8 (em-dashes, curly quotes), and `Content-Length` is a
  *byte* count, not a JS string-length count. Preserve that if you touch
  the framing code.
