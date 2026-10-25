# ADR-0009: Adventures start from a copy of the source cards; only hosts edit the source

- Status: Accepted 2026-10-25
- Date: 2026-10-25
- Related: [ADR-0008](0008-window-shift-and-plot-points.md), [F-43/F-44](../features/F-43-adventure-copies-and-source-permissions.md)

## Context
Two rules from the owner:
1. **Each adventure begins by duplicating the source cards.**
2. **Source cards can be edited by whoever hosts them, and never by players.**

This settles the open question in ADR-0007/0008 about whether play may change the world: it never touches the source. Whatever play changes, it changes on the adventure's own copy.

## Decision
1. **A `begin` event is the root of every adventure.** It carries a deep copy of the world manifest and of every source card at that moment. From then on the session reads cards from the log, never from the source. Several adventures from one world, and later edits to the source, cannot affect each other or a running adventure.
2. **Adventure state is derived from the copy.** Plot points (ADR-0008) are events that extend the adventure's copy of a card; the copy plus its points is what the prompt, the rule checker and the plot extractor see. Because it is all in the log, undo, retry, edit and branching still keep it consistent.
3. **Two roles, `host` and `player`.** The host is whoever runs the adventure or owns the world; in solo play that is the same person as the player. Roles are given to the session by the caller (the server decides who is who).
4. **Source edits go through one guarded door, `SourceCards`.** Every write (update, remove, edit-from-text) first checks the role and refuses players in plain language. Nothing else writes source cards.
5. **Default permission table** (one table, easy to change; only the first row is from the owner):

   | Action | Host | Player |
   |---|:-:|:-:|
   | Edit or remove source cards | yes | **no** |
   | Start an adventure (take the copy) | yes | no |
   | Act, retry, continue | yes | yes |
   | Undo, edit own turn, pin a fact | yes | yes |
   | Jump to another branch, add or revoke plot points, break a chapter, run plot extraction, change settings | yes | no |

6. **A running adventure does not follow later source edits.** Pulling source changes into a running adventure, and promoting an adventure's cards back into the source, are separate host-only actions (F-41), not built yet.

## Consequences
+ Worlds are reusable and safe: any number of adventures, no cross-contamination, source history unaffected by play.
+ The adventure is self-contained and replayable from its log alone.
- The first event is as large as the world. Fine for text worlds (hundreds of cards is well under a megabyte); revisit with content-addressed storage if worlds grow very large.
- **The copy contains host-only text (Secrets).** The log must never be sent to players as is. Player-facing views (transcript, chapters, plot files) are already built only from turns and plot points, but any card view for players must redact secrets. This is a server concern to carry into F-37 (hosting others).
- Players can still read nothing here that they could not read before; read-access to source cards (spoilers) is not decided by this ADR.
- Source fixes (a typo) do not reach adventures already running.

## Confirmed and extended 2026-10-25
- The permission table above was **confirmed by the owner**.
- **Players reading the source cards is a host setting** (`playersMayRead`, off by default). A host always can; a player can only when the host allows it. Taking the copy that starts a story stays host-only.
- Who is host and who is player follows [ADR-0011](0011-irc-style-joining.md) (IRC-style, no accounts).
- Plot points belong to the story's copy and never change the source: confirmed.
- The retired editor and promote/pull remain as before (F-41).

## Alternatives considered
- **Reference the source and overlay changes** (the ADR-0008 reading). Simpler storage, but a source edit would silently change running adventures. Rejected by rule 1.
- **Copy cards to files in the adventure folder as the truth.** Breaks the event-sourced model; undo and branching would need file reconciliation. Rejected.
- **Per-card permissions.** More flexibility than the owner asked for; the single table above can grow into it.
