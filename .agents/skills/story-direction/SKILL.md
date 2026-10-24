---
name: story-direction
description: Direct and maintain a long-form story organized into lore (world building), scenes (one-line event beats), drafts (prose) and chapters (author-arranged scene collections). Use whenever the user adds or changes world-building and needs it propagated through already-written scenes, drafts or chapters; when writing or revising a scene, draft or chapter from lore; when lore or direction notes are leaking into the prose; or when they mention their story's lore, factions, species, characters, places, rules, scenes, drafts or chapters — even if they don't say "story direction".
---

# Story Direction

A story here lives in four layers. Each has one job, and most failures come from one layer doing another's job.

| Layer | Job | Holds | Never holds |
|---|---|---|---|
| `lore/` | What is true in the world | Characters, places, rules, laws, factions, species, history, objects — facts and secrets | Prose, scene order |
| `scenes/` | What happens | One line per uncut short event: who, where, what changes | Prose, world explanation |
| `drafts/` | How a scene reads | Prose for one scene | Lore summaries, author notes in the text |
| `chapters/` | How the reader meets it | Ordered scene IDs + the author/narrator's framing direction, and assembled prose | New facts not in lore |

Lore is the **source of truth**; everything else is derived from it. That gives two disciplines this skill exists to enforce:

1. **Lore informs prose; it is never copied into prose.** (See *Writing from lore*.)
2. **When lore changes, every derived layer is checked, not just the obvious mentions.** (See *Propagating a lore change*.)

If the user's project uses different folder names or file shapes, follow theirs — the disciplines matter, not the paths. `references/formats.md` gives a recommended file layout if they're starting fresh or ask for one.

---

## Writing from lore

The common failure: a lore entry says *"The Veyra are a river-born species who cannot lie under running water"*, and the draft says *"The Veyra, a river-born species, could not lie under running water."* That's the lore entry wearing a costume. Readers experience it as an info-dump, and it also spends secrets the author meant to reveal later.

Treat lore the way an actor treats a character bible: it shapes every choice, and almost none of it is spoken.

**How lore may appear on the page**
- Through what a point-of-view character perceives, assumes, fears or gets wrong.
- Through behaviour: the Veyra merchant steps away from the fountain before answering.
- Through dialogue that a character would plausibly say *to another character in that moment* — never to the reader.
- Only to the depth this scene needs. One true detail beats a paragraph of accurate background.

**How it may not**
- Restated as narration in encyclopedia voice.
- Revealed earlier than the chapter's direction allows. Lore entries marked hidden/author-only stay off the page unless the scene's direction says this is the reveal.
- Explained to the reader by a character who already knows it, talking to another who already knows it.

**Before drafting**, gather only the lore the scene touches: the characters present, the place, any rule or faction the scene's event depends on. Pulling the whole lore folder into context invites the model to use all of it.

**Structure the drafting prompt** (to yourself or a subagent) so the layers stay in separate containers — this is what prevents leakage:

```xml
<lore_reference>
Facts that constrain this scene. For consistency only — do not restate, summarize
or explain any of this in the prose. Items marked [hidden] must not be revealed.
{{relevant lore excerpts}}
</lore_reference>

<continuity>
What the reader already knows at this point, and the last beat of the previous scene.
</continuity>

<scene>
{{the scene's one-line description}}
</scene>

<direction>
POV, tone, pacing, what this scene must accomplish within its chapter.
</direction>

<output_spec>
Prose for this scene only. No headings, no notes, no summary before or after.
Exclude: narration that explains world facts; any [hidden] lore; events outside <scene>.
</output_spec>
```

**After drafting, run the leak check** on the prose:
- Does any sentence read like it could be pasted back into a lore file? Rewrite it as perception, action or dialogue, or cut it.
- Is a [hidden] fact stated or heavily implied before its reveal? Remove it.
- Did the draft invent a world fact not in lore? Either remove it or flag it to the user as a proposed lore addition — never silently let prose become the source of truth.

---

## Propagating a lore change

A lore change is only finished when every scene, draft and chapter that depends on it is consistent. "Thorough" means catching three kinds of dependency, and keyword search only finds the first:

1. **Direct** — the entity is named (or called by an alias, title, nickname, pronoun-heavy passage about them).
2. **Indirect** — the text relies on the old fact without naming it. A rule change ("iron no longer wards off spirits") affects every scene where someone hangs a horseshoe, even if "iron rule" never appears.
3. **Consequential** — things that must now be different because of the change. If a character is now ten years older, a scene where she remembers the founding war may become possible or impossible; another character's relationship to her may shift.

### Steps

1. **State the change precisely.** Write it as *old → new*, plus why if the user gave a reason. If the user's request is vague ("make the Order more sinister"), turn it into concrete lore edits and confirm them before propagating — propagating a guess multiplies the guess.

2. **Update the lore file first**, then log it in `lore/_changelog.md` (date, entity, old → new). The log is how later sessions know what changed and why.

3. **Map the blast radius.** Before touching any prose:
   - Run `python scripts/lore_impact.py <story_root> --terms "<name>" "<alias>" ...` (add `--from-lore lore/<file>.md` to pull the entry's name and aliases automatically). It lists every hit in scenes, drafts and chapters with line numbers.
   - Then list the indirect and consequential dependencies yourself: what objects, behaviours, places, timelines or relationships embody the old fact? Search for those too.
   - Read every **scene line** — they are short, so read all of them, not just hits. A scene's one-liner is often where an indirect dependency is clearest.

4. **Classify each affected location** and show the user the list before editing if more than a handful of files are involved:
   - **Must change** — contradicts the new lore.
   - **Should check** — might depend on it; needs a read.
   - **Opportunity** — not wrong, but the new lore enables something the author may want (offer, don't do).

5. **Edit from the top layer down**: scenes → drafts → chapters. A scene's one-liner changing may change what its draft and its chapter placement need to do.

6. **Edit surgically.** Change the sentences the new lore makes wrong; keep the author's voice, rhythm and surrounding prose intact. Don't delete scenes or passages as a shortcut — if a passage no longer works at all, rewrite it to fit, or mark it for the author and leave it in place. Don't take the opportunity to "improve" untouched prose.

7. **Apply the leak check to every edit.** Propagation is exactly when lore gets pasted into prose: the new fact is fresh in context and it is tempting to announce it. The edited passage should embody the new fact, not explain it.

8. **Close the loop.** Re-run the scan for the old terms/fact to confirm nothing contradicting remains, then append to the changelog entry which files were updated and which were flagged for the author. Report to the user: what changed, where, and what still needs their decision.

---

## Working with chapters

A chapter file is the author's arrangement: which scenes, in what order, from whose perspective, with what withheld. When assembling or revising a chapter:
- Respect the chapter's reveal plan — it governs which lore can surface where.
- Transitions between scenes are prose, so the same leak rules apply.
- If a lore change makes the chapter's arrangement itself questionable (a reveal now happens too early), raise it rather than reordering on your own; arrangement is the author's call.

## When something doesn't fit

- New fact appears only in prose, not lore → propose adding it to lore; ask.
- Two lore entries contradict → stop and ask which is true before writing.
- The user asks for a quick one-off paragraph with no project files → still keep lore out of narration, but skip the file workflow.
