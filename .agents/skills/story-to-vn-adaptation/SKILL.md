---
name: "story-to-vn-adaptation"
description: "Adapt a story into a visual novel scoped to its length: common route, choice-derived routes and endings, scene list, VN script with inner monologue and stage direction, and asset budget."
---

# Story → Visual Novel Adaptation

Adapt a story into a visual novel design: route structure, scenes, a script and an asset plan that fit the VN's length and budget.

**This is an adaptation, not a transformation.** A transformation carries the whole story over beat by beat. An adaptation keeps what the story *is* — its central conflict, key turning points, the main characters' arcs, its tone and the moments people remember — and rebuilds those as a visual novel, under its limits. Even a long VN cannot hold every scene of a novel, and each scene costs art as well as words. Cutting, merging and compressing are done on purpose, and every major cut is written down so the user can see it and reverse it.

In a visual novel, the text *is* the gameplay. The game drives: scenes play in order and the player reads and clicks forward. Agency comes from sparse, weighty choices and from which route the player ends up on. The protagonist is usually fully voiced in text, with narration and inner monologue, and presentation (sprites, backgrounds, CGs, music) carries the atmosphere that prose descriptions carried in the source.

## Step 1 — Intake

Ask only for what is missing, in one short question (multiple choice where possible), then proceed.

1. **The story.** Pasted text, an attached file, or a known work named by title. For a published work, work from its plot. Write new prose and dialog; don't reproduce its text beyond a short iconic phrase.
2. **The mode** (who the protagonist, the MC, is):
   - **Mode 1, play as a character.** One story character is the MC and narrator; everyone else is an NPC. Suggest the protagonist by default.
   - **Mode 2A, outsider allied with the hero.** The MC is a new person in the story's world, and their eyes are the lens on the story's events.
   - **Mode 2B, outsider allied with the villain.** Same as 2A, but the MC serves the antagonist.
   - **Mode 2, open allegiance.** The MC starts neutral, and siding with the hero or the villain becomes a route split. This is often the strongest VN structure for Mode 2.
3. **Length tier** (see Step 2). If you can't ask, assume a **short VN of 1–3 hours** and say so at the top of the document.
4. **Optional settings.** Kinetic (no choices) or branching; ending policy (canon true route, divergent, mixed); whether character or bond routes are wanted (romance routes only if the user asks or the source is a romance); export (Ren'Py `.rpy`, or neutral script only).

## Step 2 — Set the scope budget

VN scope is measured in words and assets. Each background, sprite set and CG is art someone has to make. Choose a tier, write its budget into the document, and treat it as a hard limit.

| Tier | Playtime | Words | Routes after common | Endings | Meaningful choices | Backgrounds | Sprite characters | CGs |
|---|---|---|---|---|---|---|---|---|
| Micro / kinetic | 15–45 min | 3–10k | 0–1 | 1–2 | 0–3 | 3–6 | 2–4 | 2–5 |
| Short | 1–3 h | 10–35k | 1–2 | 2–4 | 4–10 | 6–12 | 4–6 | 6–15 |
| Mid | 8–20 h | 80–200k | 2–4 | 4–8 | 15–40 | 15–30 | 6–12 | 20–50 |
| Large | 30 h+ | 300k+ | 4+ | 8+ | 40+ | 30+ | 12+ | 60+ |

Reading speed averages roughly 10k words per hour; use that to check the playtime against the word count. Each sprite character needs 3–6 expressions in Short and Micro tiers. Save CGs for the must-keep moments.

## Step 3 — Analyze, then decide what to adapt

**Break the story down** (it goes in the document, compactly):
- **Cast:** each character's role, goal and arc.
- **Places**, which become background candidates.
- **Beats:** the plot in order, each tagged as *turning point*, *action*, *revelation* or *transition*.
- **Interiority:** passages where the story narrates thoughts, doubts, memories or motives. In a VN this is primary material, not garnish.
- **Core:** the central conflict and theme in one line each, plus the 3–5 moments a fan would be upset to lose. These are the CG candidates.

**Then sort every beat, character, place and subplot into one of these:**
- **Keep.** Core turning points, the climax, iconic moments, and the MC's arc.
- **Compress.** Several scenes become one. Travel and time skips become a transition line or a fade.
- **Merge.** Minor characters with similar functions become one character (one sprite set). Locations become one background.
- **Convert.** Action that is expensive to show becomes narration, an off-screen sound with a reaction, or a single CG. Backstory becomes memory monologue or a short flashback.
- **Spin off.** A gap or minor subplot becomes a route-specific scene, but only within budget.
- **Cut.** Anything that doesn't serve the core and doesn't fit the budget.
- **Invent, sparingly.** Connective scenes the VN needs (a reason for the MC to be present, a quiet scene before a choice), consistent with the story's tone and logic, labeled as new.

Record these calls in an **Adaptation Notes** table: element, decision, reason. This is how the user steers the adaptation, so keep it honest.

## Step 4 — Apply the mode

In a VN, the mode decides the point of view of the whole narration.

### Mode 1: the MC is a story character
- The MC narrates in first person, drawn from the character's canon interiority. Their voice must stay true to how they think and speak.
- Scenes the MC didn't witness can't be shown from their POV. Cut them, report them through another character, or use a clearly marked POV-switch scene sparingly.
- Choices sit at the MC's real decision points, with the canon option marked `(canon)`.

### Mode 2A / 2B: outsider MC
- Give the MC a role with a reason to be near the main events (servant, scribe, messenger, guard, apprentice, healer), a default name, and a note that it's customizable.
- The MC witnesses canon and enables it, but doesn't take the hero's or villain's defining moments. Seeing those moments from outside is the point of the mode.
- All of the MC's interiority is invented, so give them their own small arc, which ends in an earned conclusion about the hero or villain.
- In 2B, give the MC an understandable motive (debt, loyalty, ideology, ambition, coercion, a grudge). Give the villain depth, and include a moment where the MC can push back or defect.

## Step 5 — Derive routes and endings from the story

Branches come from the story itself, not from arbitrary options.

1. **Find hinge points.** A hinge is a moment where a character could believably have chosen otherwise, given their motives, and where that choice would change what follows. Rank the candidates by believability and impact, and keep as many as the budget's route count allows.
2. **Follow the consequences.** For each alternative, work out what changes, who reacts and how, and how the story resolves on that path. It must obey the story's logic and characters; a branch that breaks them is fanfic, which is fine if wanted, but label it.
3. **Build the route structure:**
   - **Common route.** It covers the setup and runs up to the first major hinge. Small choices here raise **route variables** (trust, affinity, resolve, corruption) instead of branching.
   - **Route split.** At the major hinge, the choice plus the variable values send the player onto a route.
   - **Route types for adaptations:**
     - **canon route:** the adapted story.
     - **hinge routes:** what if the character chose otherwise.
     - **allegiance routes:** Mode 2 open allegiance.
     - **bond routes:** the MC grows close to one character, if wanted.
   - **Endings per route.** Good, normal and bad, as the budget allows. **Bad ends** are short and come from clearly bad choices; they should teach the player something, not punish at random.
   - **True route (optional).** It unlocks after the other routes are cleared, and it is either the canon ending or a synthesis that uses what the player learned on the other routes. This suits stories whose meaning only comes through when seen from several sides.
4. **Choice design.** Choices are sparse and should feel weighty. Space them out, usually every 10–20 minutes of reading in Short and Mid tiers. A choice that doesn't branch must still be acknowledged: a different line, a variable change, or a later callback. Avoid choices that are obviously right; frame both options so each has a cost.
5. **Kinetic option.** For a no-choice VN, skip the routes and put the effort into pacing, monologue and presentation. The adaptation decisions in Step 3 still apply.

Document the structure in a **Route Map**: common route scenes → hinge → routes → endings, with the conditions (choices and variable thresholds) for each, as a mermaid flowchart plus a table.

## Step 6 — Characters and assets

Write a sheet for each sprite character within budget. Composites list which story characters they absorb. Each sheet covers:
- role, route involvement, what they want from the MC,
- voice: 2–3 traits plus a sample line,
- expressions needed (neutral, plus 2–5 others tied to their key scenes),
- in Mode 2, their attitude toward the MC.

Then make an **Asset List** and check it against the budget:
- backgrounds (with time-of-day variants),
- sprite characters and their expressions,
- CGs, each tied to a scene and a must-keep moment,
- clothes and adornments, each locked to one character (the unclad base `naked` is the only unlocked state),
- objects, only those a character interacts with on screen and that the world customises so a generic prompt would fail (each names its characters and/or CGs, how it is used, and why it is custom),
- music tracks by mood,
- key sound effects.

Clothes cover a body; adornments dress it without necessarily covering it (jewellery, body art, grown or attached ornament), so a world whose characters stay unclothed still has them. Cards live in `worlds/<world>/{clothes,adornments,objects}/`; the manifest lists them as `assets.clothes` / `assets.adornments` (`{ character: [names] }`) and `assets.objects` (`[{ name, owners?, cgs? }]`). Their art feeds the owner's sprite state or the linked CG as a reference image; there is no layer compositor. Skip anything a generic sprite or CG prompt already draws. Make one card per piece, and write its `<prompt>` as a plain visual description with no character names or story (the image model cannot use them). See ADR-0033.

When the list is over budget, merge locations and drop expressions before cutting must-keep CGs.

### Asset storage, JIT promotion, and deduplication
Adapting is an incremental decision; you cannot anticipate upfront whether an asset will be shared across future chapters or remain unique to one:
1. **Initial Placement:** New assets start inside the adaptation folder: `worlds/<world>/vns/<slug>/assets/`.
2. **Just-In-Time (JIT) Promotion:** When adapting a new slug, check existing visual novel adaptations in `worlds/<world>/vns/`. If an asset (character sprite, background, BGM, or SFX) is already present in an earlier slug and needed again, **move/promote that asset to `worlds/<world>/vns/_shared/assets/`**. Do not duplicate existing files. Both earlier and later adaptations will resolve it from `_shared/assets/`.
3. **Expression Fallback (No Duplicate Sprites):** Never copy base portraits to simulate expression variants (e.g. duplicating `hero.png` into `hero_smile.png`, `hero_angry.png`). The presentation engine and server asset resolver automatically resolve requests for `<character>_<expression>.<ext>` to the base portrait `<character>.<ext>` (or `<character>_neutral.<ext>`) in either the local scene or `_shared/assets/sprites/`. Only add separate expression files when distinct artwork exists.
4. **Character State & Costume Variants (`<character>_<state>_<expression>.<ext>`):** Characters frequently change wardrobe, uniforms, forms, or roles across narrative arcs (e.g. Elena as `clerk` vs `uniform`). When placing or promoting sprites to `_shared/assets/sprites/`, never overwrite an existing state with a generic `<character>.png`. Instead, use state-qualified filenames (`<character>_<state>.<ext>` and `<character>_<state>_<expression>.<ext>`, e.g. `elena_clerk.png`, `elena_uniform.png`). Script directives specify states using `[show <character>:<state> <expression> <slot>]` (e.g. `[show Elena:uniform submissive center]`), `[show <character> <state> <expression> <slot>]`, or `[show <character>_<state> <expression> <slot>]`. The engine and server resolve these hierarchically while keeping player-facing nameplates clean.

5. **Clothes, adornments, objects:** stored under `assets/clothes/`, `assets/adornments/`, `assets/objects/` as `<character>_<name>.<ext>` (objects: `<name>.<ext>`); promotion to `_shared/assets/` follows the same rule as other assets. Run `node .agents/skills/world-lint/driver.mjs assets` to check owners and links.

## Step 7 — Scene list

Before writing the script, list every scene: ID, route, location (background), characters present, purpose (the beat it delivers), choices or variable changes, CG if any, and approximate word count. The word counts should add up to the tier's budget. Every scene must do a job; a scene that delivers no beat, character development or choice gets merged or cut.

## Step 8 — The script: narration, dialog and inner monologue

### Text rules
- **Text boxes** hold at most 3 sentences, roughly 40–60 words. Break long passages into multiple boxes at natural beats; every click should feel like a rhythm.
- **Narration** carries description, transitions and action. Keep it lean, because the background and sprites already show the place and the people. Describe what the art can't show: smell, sound, motion, the passage of time.
- **Dialog** goes one speaker per box. Distinct voices matter even more than in an RPG, since there's no gameplay to carry character.
- **Scenes** can run longer than RPG exchanges, but still compress the source's scenes. A chapter of the novel is a scene or two in the VN, not ten.

### Inner monologue
Inner monologue is the VN's main way to carry the source's interiority. To derive it, take a passage of narrated thought, turn it into first-person present, and compress it ("He feared the old man was lying" → "He's lying. Or he's afraid.").
- **Reaction thoughts.** The MC's take on what just happened. These are the most frequent kind.
- **Memory thoughts.** Short flashes of the past, which are a good home for backstory the adaptation would otherwise cut. They can grow into a flashback scene in Mid and Large tiers.
- **Choice-framing thoughts.** The inner conflict, voiced just before a hinge, so the choice is felt.
- **Inner voices.** The self split into named voices that argue (DUTY vs. DESIRE), each lining up with a menu option. Use these for stories built on inner struggle.
- **Sourcing by mode.** In Mode 1, the thoughts come from the character's canon interiority. In Mode 2, they are invented, and are the outsider's view of the hero or villain. In 2B, this is where doubts and rationalizations live.
- **Limits.** Don't narrate what the art already shows, and don't tell the player how to feel about a choice they haven't made. Monologue should add motive, memory, doubt or subtext.

### Script notation (neutral, convertible to Ren'Py)

```
## SC-03  Riverbank, dusk   [route: common] [~600 words]
[bg riverbank_dusk] [music unease] [fade in]

The water is louder than it should be.

[show vasha worried]
VASHA: The river took the bridge three nights ago. Nothing's crossed since.

( MC ) She isn't looking at the water. She's looking at me.

MENU
  * "I'll cross."        → SC-04   {trust_vasha +1}
  * Say nothing.         → SC-05
  * "You knew." (canon)  → SC-04b  {+suspects_vasha}

[cg river_crossing] ... [hide cg]
```

- Every scene header carries the scene ID, location, route and word estimate.
- Stage direction goes in `[ ]`: `bg`, `show <char> <expression>`, `hide`, `cg`, `music`, `sfx`, transitions.
- Plain lines are narration. `NAME:` lines are dialog. `( MC )` lines are inner monologue; use the MC's name if they have one.
- `MENU` marks a choice. `→` points to the next scene, and `{}` holds variable changes. `(canon)` marks the canon option in Mode 1.
- Every menu option must lead somewhere, and every variable must be read at a route split or an ending.

## Step 9 — Assemble the document

Use this structure, and omit sections that don't apply.

```markdown
# <Story> — Visual Novel Adaptation (<Mode>)
Source · Mode · MC · Tier (with word and asset budget) · Ending policy · Kinetic or branching

## 1. Story Core
Central conflict · theme · must-keep moments (3–5)
## 2. Adaptation Notes
| Element | Decision | Reason |
## 3. Route Map
mermaid flowchart + table: route, entry condition, endings, ending conditions
## 4. Variables
| Variable | Raised by | Lowered by | Read at |
## 5. Characters
## 6. Asset List
backgrounds · sprites and expressions · CGs (scene + moment) · music · key SFX — with totals vs budget
## 7. Scene List
| ID | Route | Location | Characters | Purpose | Choice / variables | CG | ~Words |
## 8. Script
Common route, then each route in order, then the endings
```

**Ren'Py export (on request).** Convert the script to `.rpy`:
- character definitions with `define`
- `label` per scene
- `scene bg`, `show`, `hide`
- `play music`
- `menu:` with `$` variable changes
- `jump`
- route checks as `if` blocks

Use placeholder image names that match the Asset List. Check that every `jump` target exists.

For Mid and Large tiers, build in stages. Send the Story Core, Adaptation Notes, Route Map and Scene List first, so the user can redirect before the full script is written. Then write the script one route at a time.

## Delivery

Deliver a document the user can keep and edit: a doc artifact by default, or the format they ask for (.md, .docx, .rpy). Close with one line on what was produced and one natural next step, such as "write the next route?", "add a true route?" or "export to Ren'Py?".

### Scaffolding layout on disk
When scaffolding or writing visual novel adaptations into a world, follow this structure with generic nondescript naming:

```text
worlds/<world>/vns/
├── _shared/
│   └── assets/
│       ├── backgrounds/       # Promoted when used by 2+ adaptations
│       ├── sprites/           # Base character portraits (protagonist.png, etc.)
│       ├── music/
│       └── sfx/
├── ch01-awakening/
│   ├── manifest.json
│   ├── adaptation.md
│   ├── slides.json
│   └── assets/
│       ├── backgrounds/       # Assets unique to this adaptation
│       └── cgs/               # Scene-specific event CGs
└── ch02-arrival/
    ├── manifest.json
    ├── adaptation.md
    ├── slides.json
    └── assets/
        └── cgs/
```

## Checks before delivering

- **Budget.** The word count and the asset counts are within the tier, and the scene word estimates add up.
- **Fidelity.** All the must-keep moments are present, each with a CG where the budget allows. Every cut, merge and invention appears in the Adaptation Notes.
- **Routes.** Every hinge comes from the story's logic, every route has its own climax and ending, and the conditions to reach each ending are achievable.
- **POV.** Narration stays in the MC's point of view (Mode 1: canon interiority; Mode 2: an outsider who never takes the defining moments).
- **Text.** Boxes are within limits, voices are distinct, and the monologue adds rather than repeats what's on screen.
- **Integrity.** Every menu option resolves, every variable is read, and every scene in the list appears in the script.