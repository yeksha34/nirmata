---
name: structured-prompts
description: Write and refactor prompts, system prompts, skill files and agent instructions using XML tags and markdown so that the context a model needs to understand the task is cleanly separated from the content it is expected to produce. Use whenever the user asks to write, improve, tighten, restructure, debug or "make more efficient" a prompt for an LLM / GenAI model, or complains that a model is echoing background info, leaking instructions into its output, mixing context into the answer, or ignoring format — even if they don't mention XML or markdown.
---

# Structured Prompts

A prompt carries two very different kinds of material:

- **Context** — what the model must *know* to do the job: background, audience, constraints, source data, examples, reasoning about why.
- **Content spec** — what the model must *produce*: the deliverable, its shape, its length, its voice.

Most weak prompts blend these into one paragraph. The model then can't tell which sentences describe the world and which describe the answer, so it does the safe thing and talks about everything — restating the background, narrating the constraints, explaining the audience back to the reader. The fix is structural: give each kind of material its own clearly bounded container, and tell the model explicitly that context is for understanding, not for repeating.

## The two notations and what each is for

Use them for different jobs rather than interchangeably.

| Notation | Job | Why it works |
|---|---|---|
| **XML tags** | Hard *boundaries* between kinds of material — context vs. data vs. instructions vs. output | Tags have an unambiguous start and end, can be referred to by name ("using only `<source>`"), and survive pasted data that itself contains markdown or headings |
| **Markdown** | *Hierarchy and readability inside* a block — headings, numbered steps, bullets, tables | Models read markdown as structure; numbered lists preserve order, headings group related rules |

Rule of thumb: **XML decides what kind of thing a passage is; markdown organizes the passage once you know.** Don't use `##` headings as the only separator between context and pasted data — a pasted document with its own headings will blur the line.

## Canonical layout

Order matters: models weight what comes last, and long reference data is better placed early with the task restated after it.

```xml
<role>
One or two sentences: who the model is acting as and for whom.
</role>

<context>
## Background
Facts the model needs to reason correctly. Not to be restated.

## Audience
Who will read the output and what they already know.

## Constraints
Hard limits and the reason for each.
</context>

<source>
Raw material to work from (documents, data, transcripts). Never instructions.
</source>

<examples>
<example>
<input>…</input>
<output>…</output>
</example>
</examples>

<task>
The single job, stated as an imperative. Then numbered steps if order matters.
</task>

<output_spec>
## Deliverable
Exactly what to produce.

## Format
Structure, length, markup, language.

## Exclude
What must not appear — including restating anything from <context>.
</output_spec>
```

Not every prompt needs every block. A two-line task needs `<task>` and maybe `<output_spec>`; drop empty sections rather than padding them. Keep tag names consistent within a prompt and across a prompt family — if you call it `<source>` once, don't call it `<document>` later.

## Keeping context out of content

This is the core of the skill. Apply all of these:

1. **Label the purpose of context explicitly.** Inside or just after `<context>`, say it's for understanding: *"Use this to inform your answer; do not summarize or restate it."* Models default to being helpful by surfacing what they were told — they need permission not to.
2. **Specify the output positively and completely.** The model fills gaps in the spec with material from context. A tight `<output_spec>` (deliverable, sections, length) leaves no gap to fill.
3. **Put the deliverable's shape in `<output_spec>`, never in `<context>`.** "The audience is executives" is context. "Write three bullet points, no jargon" is spec. Writing "write for executives" in context invites the model to say "As an executive, you…".
4. **Give the output its own container when it's being parsed.** Ask for `<answer>…</answer>` (or `<draft>`, `<json>`) so preamble and reasoning stay outside. Ask for `<thinking>` before `<answer>` when reasoning helps but shouldn't ship.
5. **Name the leak in `## Exclude`.** Concrete is better than general: "No opening sentence about the company's history", "Don't mention that this is for a pitch deck".
6. **Keep instructions out of `<source>`.** Data blocks are data. If an instruction is about the data, put it in `<task>` and reference the tag: "Extract every date in `<source>`."
7. **Examples show output only through `<output>`.** If example inputs contain context-like text, the model learns to echo it unless the example output clearly doesn't.

## Efficiency

Efficient means every line changes behaviour.

- Cut politeness padding, "You are a world-class…" inflation, and repeated rules.
- State each rule once, in the block where it belongs.
- Explain the *why* in a clause rather than escalating to CAPS or MUST — a model that understands the reason generalizes to cases you didn't list.
- Prefer one good example to five similar ones; vary examples if you include several, or the model copies surface features.
- Use variables in `{{double_braces}}` for anything that changes per run, so the template stays stable.

## Workflow

When asked to write a prompt:
1. Identify the deliverable first. Write `<output_spec>` before anything else — it decides what context is actually needed.
2. List what the model must know to produce that. That becomes `<context>`. Anything that doesn't serve the deliverable is cut.
3. Assemble using the canonical layout, dropping unused blocks.
4. Run the leak check below.

When asked to improve an existing prompt:
1. Sort every sentence into: context, data, task, output spec, or noise.
2. Rebuild in the canonical layout; delete the noise.
3. Run the leak check.
4. Show the rewrite, then a short list of the substantive changes and why (not a line-by-line diff).

## Leak check

Before handing over a prompt, read `<output_spec>` alone and ask:
- Could a model produce the deliverable from this spec plus the context — without guessing its shape? If not, the spec is underspecified and context will leak in to fill it.
- Is any sentence in `<context>` actually describing the output? Move it.
- Is any sentence in `<output_spec>` actually background? Move it.
- Does anything in `<source>` read like an instruction? Move it to `<task>`.
- Is there a sentence that would be pointless to the model? Delete it.

## Delivering the prompt

Give the finished prompt in a single fenced code block so it can be copied cleanly, then one or two lines on how to use it (which `{{variables}}` to fill). Don't wrap the user's prompt in commentary inside the code block.

For worked before/after examples across common prompt types (summarization, extraction, creative writing, system prompts, agent instructions), read `references/examples.md`.
