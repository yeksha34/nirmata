# UX principles ("easy UI/UX")

Easy means a first-time user can build a small world and play in it without reading docs, while an
expert can still reach every dial. Each principle ends in something testable.

1. **Start from something playable.** First launch opens the example world with a big **Play** button. Test: from install to first host reply in under 3 clicks after the model is set.
2. **Two modes, not two apps.** *Simple* hides token budgets, raw prompts and sampler settings; *Advanced* shows them. The same data underneath. (SillyTavern's depth, without its first-run wall.)
3. **Forms over files.** Authors fill labelled fields (name, keywords, summary, secrets); markdown is the body only. Raw file view is one click away, never required.
4. **Templates for every card kind** with example text in grey, so a blank page is never the starting point.
5. **Every turn is reversible.** Retry, Edit, Undo, Continue are always visible on the latest turn and in a menu on older ones (AI Dungeon's best idea).
6. **Show why.** When a lore card appears in context, say which keyword triggered it. When a rule flags text, show the rule's `Check` question. Test: no card or rule acts invisibly.
7. **Never lose work.** Autosave to disk, append-only story log, clear "saved" indicator. Destructive actions are undoable or confirmed with the item named.
8. **Plain-language errors.** "Can't reach your model at http://localhost:5001. Is KoboldCpp running?" beats `ECONNREFUSED`. Every error says what to try.
9. **Keyboard and command palette.** `Ctrl/Cmd+K` jumps to any card, world or setting. Play is fully keyboard-driven (Enter send, `Ctrl+Z` undo, `Ctrl+R` retry).
10. **Cards look like cards.** Portrait, title, tagline, tags (Janitor-style browsing) in the library; consistent card chrome everywhere.
11. **Adults, said plainly.** Nirmata is for adult audiences ([ADR-0010](decisions/0010-adults-only.md)); the first run says so, and there are no rating levels to configure. Players are never silently blocked or edited: what they type is treated as what the character says or tries, not as fact ([ADR-0012](decisions/0012-player-input-is-not-fact.md)).
12. **Phone-capable.** Play view is single column, thumb-reachable controls, 44px targets.

## Core screens (v0.3 target)

| Screen | Primary action | Secondary |
|---|---|---|
| **Library** | Play a world / New world | Import, duplicate, export |
| **World workspace** | Edit a card | Graph view, rules, lint results, history |
| **Play** | Type an action | Retry / Edit / Undo, memory panel, cards-in-context drawer |
| **Settings** | Pick model + preset, test connection | Advanced sampler, keys |

## Usability checks to run at each release

- Think-aloud with one person who has never used SillyTavern: create a 3-card world and play 5 turns.
- Keyboard-only pass of Library -> Play.
- Axe/Lighthouse accessibility scan on each screen.
- Offline pass: pull the network cable with a local model; nothing breaks.
