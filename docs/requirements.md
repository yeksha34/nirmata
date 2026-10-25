# Requirements

Goal (from the [brief](brief.md)): **easy UI/UX** for (1) managing world building and (2) hosting
adventurers in the worlds that were built. Priorities are MoSCoW for the first usable release (v0.2-v0.3).
Status is the lifecycle state from [lifecycle.md](lifecycle.md); the board there is authoritative.

## Personas

| Persona | Wants | Pain with today's tools |
|---|---|---|
| **World builder** | Capture lore, characters, places and rules once; reuse across many stories | SillyTavern is powerful but dense; AI Dungeon cards are shallow; files-in-folders has no guidance |
| **Player** | Pick a world, play immediately, undo mistakes, keep a coherent story | Models forget; settings are intimidating |
| **Host** (person who runs the machine and may invite friends) | Pick local or hosted model, keep data private, share a session | Setting up Kobold/Ollama plus a front end is a project in itself |

## What we borrow, and from where

| Product | Borrow | Avoid |
|---|---|---|
| SillyTavern + KoboldAI | Lorebook entries triggered by keywords; character cards; local-first; any backend | Wall of settings; plugin sprawl for basics |
| AI Dungeon | Do / Say / Story input modes; Retry / Edit / Undo / Continue on every turn; Scenario to Story flow; Plot Essentials ("always on") and Story Cards (keyword) | Hard-wired single model; paywalled controls |
| Janitor AI | Browsable cards with portrait and tagline; one-click "chat with this" | Opaque prompt building |

## Functional requirements

### A. World building (Studio)

| ID | Pri | Requirement | Acceptance (short) |
|---|---|---|---|
| F-01 | M | **World library and wizard.** Grid of worlds with portrait, title, tagline. "New world" asks title, genre, tone, perspective and creates `worlds/<name>/` from `_template`. | A new world is playable-ready in under 2 minutes with only 5 fields filled |
| F-02 | M | **Card editor** for lore, characters, places, rules, arcs: form fields from frontmatter plus markdown body, live preview, autosave, templates per kind. | Edit a card without touching raw YAML; invalid frontmatter is flagged inline |
| F-03 | M | **Lorebook engine**: `keywords` trigger injection, `always: true` cards are permanent, a **token budget meter** shows what would be sent and why. | The meter lists each included card with its trigger |
| F-04 | M | **Link graph and lint**: backlinks panel, broken/orphan detection, relationship graph. | `world-lint check` clean; UI shows the same results |
| F-05 | S | **World rules**: author rules as cards with a `Check` question; run them against any text. | Rule check on a pasted paragraph returns per-rule verdicts |
| F-06 | S | **Import / export**: world pack (zip), epub of chapters, SillyTavern lorebook and Character Card V2 import. | Round-trip a world pack with no diff |
| F-07 | S | **Version control drawer**: per-file history and diff, stage and commit. | Already exists in the baseline Studio |
| F-08 | S | **AI-assisted card generation**: "expand this card", "make 5 NPCs for this place", always reviewed before saving. | Generated cards land as drafts, never overwrite |
| F-09 | C | **Consistency check**: find contradictions across cards. | Baseline ops queue ported |

### B. Hosting stories

| ID | Pri | Requirement | Acceptance (short) |
|---|---|---|---|
| F-30 | M | **Story host core**: turn loop, streaming, Do / Say / Story modes. | See [features/F-30](features/F-30-story-host-core.md) |
| F-31 | M | **Retry / Edit / Undo / Continue** on any turn. | Undo restores the exact prior state including memory |
| F-32 | M | **Context builder** shared with F-03: rules, always-on, triggered cards, memory, recent turns, author's note, inside a budget. | Same inputs produce same prompt (deterministic, testable) |
| F-33 | S | **Persistent memory**: rolling summary, pinned facts, auto-suggested story cards the player accepts or rejects. | Facts from turn 5 still shape turn 80 |
| F-34 | S | **Player character**: pick a template or build; light stats and inventory; optional dice. | Inventory change shown in a side panel |
| F-35 | M | **Model settings**: provider list (local OpenAI-compatible, Ollama, Anthropic, others), model, temperature, max tokens, presets ("Balanced", "Creative", "Strict"). | Test-connection button with a plain-language error |
| F-36 | S | **Rules during play**: after each host reply, cheap rule check; on `must` violation offer one-click regenerate. | Violating reply is flagged before the player sees it, or flagged with a Fix button |
| F-37 | C | **Join a story IRC-style.** Whoever runs the story's server is the host; anyone who can reach it joins with a nickname, watches, and can opt to play. No accounts, passwords or user management ([ADR-0011](decisions/0011-irc-style-joining.md)). | A second device joins by address and nickname, watches, then opts in and plays |
| F-38 | S | **Save, branch, export**: fork from any turn; export transcript as markdown or epub. | Branch leaves the original untouched |
| F-40 | M | **Live context-window shifting.** No summarising: the prompt holds the recent turns that fit, and turns that fall out of the window are written verbatim to the story's **chapter** as they leave. Chapter breaks are decided later ([ADR-0008](decisions/0008-window-shift-and-plot-points.md)). | Chapter text equals the exact turns outside the window; follows undo and branches |
| F-42 | M | **Plot points on cards, with undo.** After something affecting a card has happened in the story, that plot point is added to the card (story-scoped) and recalled with it. Points can be revoked or added by hand, and follow undo and branches. | Points appear in later prompts under their card; undoing the turn removes them |
| F-43 | M | **Story copies.** Each story begins by duplicating the source cards (and world manifest) into its own log; play uses and changes only the copy ([ADR-0009](decisions/0009-story-copies-and-source-permissions.md)). | Editing the source after the start changes nothing in a running story |
| F-44 | M | **Source permissions.** Source cards can be edited by whoever hosts them, never by players. | A player's edit is refused and nothing is written |
| F-45 | M | **Player input is never fact.** The rules checker runs only on generated text, after generation; it never touches player input. The host treats input that contradicts the rules, cards or memory as untrue in the story ([ADR-0012](decisions/0012-player-input-is-not-fact.md)). | A false claim does not become a fact, a plot point or a card change |
| F-46 | M | **Shared board, age confirmation, moderation.** Turns are written on a board where every player has their own lines, all can see them and object or discuss before submitting; a round closes when all who wrote are ready ([ADR-0013](decisions/0013-shared-board.md)). Joining can ask for an adult confirmation, in production only ([ADR-0014](decisions/0014-age-confirmation-production-only.md)). The host can kick, mute and rename in the story's own voice ([ADR-0015](decisions/0015-moderation-in-the-story-voice.md)). | Three people play a round together; a muted player's line is not submitted; the check is skipped outside production |
| F-47 | M | **The table server.** One server runs one table: people join by nickname, write on the shared board, watch the story arrive live, and the host's stories and source cards are kept as plain files. Everyone but the host is shown only the story as told, never the cards, Secrets or prompt ([ADR-0016](decisions/0016-table-server.md)). | `apps/server` tests pass; a player's stream and state never contain card text |
| F-48 | S | **Save a story as a world.** The host can save an ongoing story as a world of its own: the story's copy of the cards with its plot points written into them, plus its chapters. New stories can begin from there; the original is untouched. | The saved world opens, lints, and a new story in it starts with the saved plot |
| F-49 | M | **Screens for joining, choosing and continuing.** The host picks a world from a library on screen (never an environment variable), starts a story or continues a saved one, and saves a story as a new world; everyone else joins with a name and plays on the shared board. | A new host can go from opening the app to a running story without reading a terminal |
| F-41 | C | **Promote to the source.** A host copies a chosen story chapter or card (with its plot points) back into the source cards, and can pull source changes into a running story. | Promoted content appears in `worlds/<name>/` and lints clean |
| F-39 | M | **Adults only.** Nirmata is for adult audiences ([ADR-0010](decisions/0010-adults-only.md)): no rating tiers, no ceiling, no gate. A story is bounded by the world's rule cards, the host's direction, and one fixed prompt line no world can remove. | No rating field anywhere; the prompt says the story is for adults |

### C. UX

| ID | Pri | Requirement |
|---|---|---|
| F-50 | M | **Guided first run**: opens on the example world, one-screen setup for a model, a visible "Play" button. **Simple / Advanced** toggle hides token budgets, raw prompts and sampler settings by default. |
| F-51 | S | **Mobile-friendly PWA**: play and light edits on a phone over LAN. |
| F-52 | S | **Accessibility**: keyboard-first play, focus order, 4.5:1 contrast, reduced motion, screen-reader labels. |

## Non-functional requirements

| ID | Requirement |
|---|---|
| N-01 | **Local-first.** Worlds and stories are plain files on the user's disk; no account needed. Network calls happen only to the model provider the user configured. |
| N-02 | **Git-friendly.** Everything authored is text with stable ordering so diffs are readable. |
| N-03 | **Secrets never in the repo.** API keys live in OS keychain or an ignored local file; `.env` is ignored. |
| N-04 | **Responsive.** Typing in the editor never blocks on I/O; first token of a host reply appears as soon as the provider streams it. |
| N-05 | **Recoverable.** Every story turn is appended before the next is requested; a crash loses at most the in-flight reply. |
| N-06 | **Model-agnostic.** No feature may require one specific model or vendor. |

## Out of scope for now
Cloud hosting and accounts, public marketplace, voice, image generation, fine-tuning inside the UI
(the `rules-gatekeeper` service remains an offline training project).
