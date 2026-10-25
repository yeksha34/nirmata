# Requirements

Goal (from the [brief](brief.md)): **easy UI/UX** for (1) managing world building and (2) hosting
adventurers in the worlds that were built. Priorities are MoSCoW for the first usable release (v0.2-v0.3).
Status is the lifecycle state from [lifecycle.md](lifecycle.md); the board there is authoritative.

## Personas

| Persona | Wants | Pain with today's tools |
|---|---|---|
| **World builder** | Capture lore, characters, places and rules once; reuse across many stories | SillyTavern is powerful but dense; AI Dungeon cards are shallow; files-in-folders has no guidance |
| **Adventurer (player)** | Pick a world, play immediately, undo mistakes, keep a coherent story | Models forget; settings are intimidating |
| **Host** (person who runs the machine and may invite friends) | Pick local or hosted model, keep data private, share a session | Setting up Kobold/Ollama plus a front end is a project in itself |

## What we borrow, and from where

| Product | Borrow | Avoid |
|---|---|---|
| SillyTavern + KoboldAI | Lorebook entries triggered by keywords; character cards; local-first; any backend | Wall of settings; plugin sprawl for basics |
| AI Dungeon | Do / Say / Story input modes; Retry / Edit / Undo / Continue on every turn; Scenario to Adventure flow; Plot Essentials ("always on") and Story Cards (keyword) | Hard-wired single model; paywalled controls |
| Janitor AI | Browsable cards with portrait and tagline; one-click "chat with this" | Opaque prompt building |

## Functional requirements

### A. World building (Studio)

| ID | Pri | Requirement | Acceptance (short) |
|---|---|---|---|
| F-01 | M | **World library and wizard.** Grid of worlds with portrait, title, tagline. "New world" asks title, genre, tone, rating, perspective and creates `worlds/<name>/` from `_template`. | A new world is playable-ready in under 2 minutes with only 5 fields filled |
| F-02 | M | **Card editor** for lore, characters, places, rules, arcs: form fields from frontmatter plus markdown body, live preview, autosave, templates per kind. | Edit a card without touching raw YAML; invalid frontmatter is flagged inline |
| F-03 | M | **Lorebook engine**: `keywords` trigger injection, `always: true` cards are permanent, a **token budget meter** shows what would be sent and why. | The meter lists each included card with its trigger |
| F-04 | M | **Link graph and lint**: backlinks panel, broken/orphan detection, relationship graph. | `world-lint check` clean; UI shows the same results |
| F-05 | S | **World rules**: author rules as cards with a `Check` question; run them against any text. | Rule check on a pasted paragraph returns per-rule verdicts |
| F-06 | S | **Import / export**: world pack (zip), epub of chapters, SillyTavern lorebook and Character Card V2 import. | Round-trip a world pack with no diff |
| F-07 | S | **Version control drawer**: per-file history and diff, stage and commit. | Already exists in the baseline Studio |
| F-08 | S | **AI-assisted card generation**: "expand this card", "make 5 NPCs for this place", always reviewed before saving. | Generated cards land as drafts, never overwrite |
| F-09 | C | **Consistency check**: find contradictions across cards. | Baseline ops queue ported |

### B. Hosting adventures

| ID | Pri | Requirement | Acceptance (short) |
|---|---|---|---|
| F-30 | M | **Adventure host core**: turn loop, streaming, Do / Say / Story modes. | See [features/F-30](features/F-30-adventure-host-core.md) |
| F-31 | M | **Retry / Edit / Undo / Continue** on any turn. | Undo restores the exact prior state including memory |
| F-32 | M | **Context builder** shared with F-03: rules, always-on, triggered cards, memory, recent turns, author's note, inside a budget. | Same inputs produce same prompt (deterministic, testable) |
| F-33 | S | **Persistent memory**: rolling summary, pinned facts, auto-suggested story cards the player accepts or rejects. | Facts from turn 5 still shape turn 80 |
| F-34 | S | **Player character**: pick a template or build; light stats and inventory; optional dice. | Inventory change shown in a side panel |
| F-35 | M | **Model settings**: provider list (local OpenAI-compatible, Ollama, Anthropic, others), model, temperature, max tokens, presets ("Balanced", "Creative", "Strict"). | Test-connection button with a plain-language error |
| F-36 | S | **Rules during play**: after each host reply, cheap rule check; on `must` violation offer one-click regenerate. | Violating reply is flagged before the player sees it, or flagged with a Fix button |
| F-37 | C | **Host others**: invite via LAN link or QR; players take turns; host controls the model. | Second device joins a running adventure |
| F-38 | S | **Save, branch, export**: fork from any turn; export transcript as markdown or epub. | Branch leaves the original untouched |
| F-40 | M | **Live context-window shifting.** No summarising: the prompt holds the recent turns that fit, and turns that fall out of the window are written verbatim to the adventure's **chapter** as they leave. Chapter breaks are decided later ([ADR-0008](decisions/0008-window-shift-and-plot-points.md)). | Chapter text equals the exact turns outside the window; follows undo and branches |
| F-42 | M | **Plot points on cards, with undo.** After something affecting a card has happened in the adventure, that plot point is added to the card (adventure-scoped) and recalled with it. Points can be revoked or added by hand, and follow undo and branches. | Points appear in later prompts under their card; undoing the turn removes them |
| F-43 | M | **Adventure copies.** Each adventure begins by duplicating the source cards (and world manifest) into its own log; play uses and changes only the copy ([ADR-0009](decisions/0009-adventure-copies-and-source-permissions.md)). | Editing the source after the start changes nothing in a running adventure |
| F-44 | M | **Source permissions.** Source cards can be edited by whoever hosts them, never by players. | A player's edit is refused and nothing is written |
| F-41 | C | **Promote to the source.** A host copies a chosen adventure chapter or card (with its plot points) back into the source cards, and can pull source changes into a running adventure. | Promoted content appears in `worlds/<name>/` and lints clean |
| F-39 | M | **Content rating gate**: `contentRating` on the world and a per-session ceiling; the host prompt and rule checker honour it. | Setting a session to "everyone" never loads cards marked above it |

### C. UX

| ID | Pri | Requirement |
|---|---|---|
| F-50 | M | **Guided first run**: opens on the example world, one-screen setup for a model, a visible "Play" button. **Simple / Advanced** toggle hides token budgets, raw prompts and sampler settings by default. |
| F-51 | S | **Mobile-friendly PWA**: play and light edits on a phone over LAN. |
| F-52 | S | **Accessibility**: keyboard-first play, focus order, 4.5:1 contrast, reduced motion, screen-reader labels. |

## Non-functional requirements

| ID | Requirement |
|---|---|
| N-01 | **Local-first.** Worlds and adventures are plain files on the user's disk; no account needed. Network calls happen only to the model provider the user configured. |
| N-02 | **Git-friendly.** Everything authored is text with stable ordering so diffs are readable. |
| N-03 | **Secrets never in the repo.** API keys live in OS keychain or an ignored local file; `.env` is ignored. |
| N-04 | **Responsive.** Typing in the editor never blocks on I/O; first token of a host reply appears as soon as the provider streams it. |
| N-05 | **Recoverable.** Every adventure turn is appended before the next is requested; a crash loses at most the in-flight reply. |
| N-06 | **Model-agnostic.** No feature may require one specific model or vendor. |

## Out of scope for now
Cloud hosting and accounts, public marketplace, voice, image generation, fine-tuning inside the UI
(the `rules-gatekeeper` service remains an offline training project).
