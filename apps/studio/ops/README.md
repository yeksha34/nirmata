# Ops Queue

The Story Editor UI's "Operations" panel doesn't call a model itself — the
server has none wired up. It packages exactly the input an LLM needs into a
job file and stops. The assistant (Claude, working in this repo) is the
worker: read a pending job, do the actual reasoning, write the result.

## Layout

- `queue/<id>.json` — one job per file, written by `POST /api/ops/create`.
- `results/<id>.json` — the worker's output for that job, written either by
  `POST /api/ops/result` or (simplest in practice) directly with a file-write
  tool. A job is "done" in the UI as soon as its result file exists.

## Working the queue

```bash
ls tools/story_editor/ops/queue/
```

Read a queue file, do the job type's task below, write
`tools/story_editor/ops/results/<same-id>.json`.

### `draft-chapter`

Input: `{ arcPath, suggestedDraftPath, alreadyExists, compactedContext }` —
`compactedContext` is the driver's weighted `context` traversal for the arc
(same shape as `/api/context`: `included[]` cards with `path`/`title`/
`text`/`role`, plus `omitted[]`).

Task: this is the workflow from
[prose-draft-placeholder-convention.md](../../../.agents/rules/prose-draft-placeholder-convention.md) —
write the chapter in full natural prose using `compactedContext` (arc beats,
character voices, lore constraints), and drop a
`[[EXPLICIT SCENE — beat: ...]]` marker at each beat that calls for an
explicit sex act instead of writing it. Read that rule file before starting
if it's not already loaded. Then **write the chapter directly to
`suggestedDraftPath`** with a file-write tool (create the file — don't wait
for the user to click anything) — that's the actual deliverable, not the
result JSON. If `alreadyExists` is true, stop and say so in the result
instead of overwriting an existing draft.

Result shape:
```json
{
  "id": "<job id>",
  "type": "draft-chapter",
  "completedAt": "<ISO timestamp>",
  "summary": "one or two sentences",
  "draftPath": "chapters/drafts/<arc-basename>.md",
  "explicitMarkerCount": 2,
  "explicitMarkerLocations": ["the tavern scene", "the closing beat"]
}
```

### `reformat`

Input: `{ path, raw, isChapterLike, styleRules, exampleCard }` — `raw` is
the text as it stood in the editor buffer when "Reformat to house style"
was clicked (may include unsaved edits — this works on what's on screen,
not what's on disk). `styleRules` is `[{path, text}]`, populated only for
`chapters/` paths (the placeholder-convention and chapter-prose-and-subtext
rule files). `exampleCard` is `{path, text}` of a same-directory sibling,
given when there's no dedicated rule file for the shape (any card type) —
match its structure (frontmatter fields, section headings, tone) rather
than inventing a new one.

Task: rewrite `raw` into the house format — for a chapter, that means
`styleRules`' conventions (natural prose + `[[EXPLICIT SCENE — beat: ...]]`
markers, not fully-written explicit content); for anything else, match
`exampleCard`'s structure. This is a **format transform, not a rewrite of
content** — preserve every fact, beat, and detail already in `raw`; only
the shape changes (frontmatter added/fixed, sections reorganized to match
the convention, prose register adjusted if it's a chapter). Don't invent
new content to fill gaps `raw` didn't have. Then **write the result
directly back to `path`** with a file-write tool — that's the deliverable.

Result shape:
```json
{
  "id": "<job id>",
  "type": "reformat",
  "completedAt": "<ISO timestamp>",
  "summary": "one or two sentences on what changed shape-wise",
  "path": "<same as input.path>"
}
```

### `extract-cards`

Input: `{ path, prose, linkedContext: [{path,title,text}, ...] }` — the
prose (a chapter or draft) plus the full text of everything it links to one
hop out, so you can tell what's already a card vs. what's new.

Task: read the prose for anything that reads as a distinct character,
place, object, or concept that **isn't** covered by an existing card in
`linkedContext` (or found via a corpus search — check before proposing) and
is substantial enough to be worth its own card (a named minor character who
recurs, a location described in enough detail to matter again, an item/
mechanism the plot leans on). Don't propose a card for something already
covered elsewhere, or for a one-off detail with no reuse value.

Result shape:
```json
{
  "id": "<job id>",
  "type": "extract-cards",
  "completedAt": "<ISO timestamp>",
  "summary": "one or two sentences",
  "proposedCards": [
    {
      "suggestedPath": "characters/stock/some_new_card.md",
      "title": "Some New Card",
      "rationale": "why this earns a card, and why it isn't already covered",
      "draftBody": "# Some New Card\n\n...full card markdown, ready to review..."
    }
  ]
}
```

`suggestedPath` must be under `characters/`, `lore/`, `setting/`, or
`plot/arcs/` — that's what `/api/ops/apply-card` will accept when the user
clicks "Create this card" in the UI. It refuses to overwrite an existing
file, so double-check the path isn't already taken.

### `contradictions-context`

Input: `{ path, prose, linkedContext: [...] }` — same shape as above.

Task: compare the prose against `linkedContext` for factual conflicts —
something the prose states that a linked card contradicts (a name, a
relationship, a timeline fact, an established mechanic). Not style notes,
not missing content — only actual contradictions.

Result shape:
```json
{
  "id": "<job id>",
  "type": "contradictions-context",
  "completedAt": "<ISO timestamp>",
  "summary": "one or two sentences",
  "findings": [
    {
      "severity": "high | medium | low",
      "description": "what conflicts with what",
      "proseQuote": "the exact conflicting line from the prose",
      "contextSource": "path/to/card.md",
      "contextQuote": "the exact conflicting line from that card"
    }
  ]
}
```

### `contradictions-chapters`

Input: `{ pathA, pathB, proseA, proseB }` — two chapters' full text, no
linked context.

Task: same as above, but comparing the two chapters directly against each
other rather than against a card.

Result shape: same `findings` array as `contradictions-context`, but each
finding's `contextSource`/`contextQuote` fields are instead
`otherQuote`/`otherPath` (the conflicting line from whichever of the two
chapters isn't quoted in `proseQuote`).

## Cleanup

Queue/result files are gitignored (`tools/story_editor/ops/queue/*.json`,
`.../results/*.json`) — they're working scratch for a drafting session, not
corpus content. Delete old ones freely; nothing else references them.
