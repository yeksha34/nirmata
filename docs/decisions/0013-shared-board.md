# ADR-0013: Turns are written on a shared board

- Status: Accepted 2026-10-25
- Related: [ADR-0011](0011-irc-style-joining.md), [F-46](../features/F-46-shared-board-and-table-rules.md)

## Context
With IRC-style joining several people can type at once, but a story answers one thing at a time. The owner's answer to "who goes when?": *a shared board where each player gets their own lines to write their turn in, so all players can see what others are writing, and can object or discuss it before submitting.*

## Decision
1. **A round is written on a shared board.** Each player has their own lines (a draft with a mode: do, say or story). Everyone at the table, players and spectators, sees every draft as it is written, and the same remarks.
2. **Players can discuss and object before anything is submitted.** A remark is plain talk; an objection is tied to someone's draft. Objections never block. They stay visible until the drafter changes their turn, which marks them answered, or the author withdraws them.
3. **Players mark their turn ready.** Editing a ready turn clears its ready mark. The round **closes** when the story is idle and every player who wrote something is ready (players who wrote nothing do not hold it up). The host can also close it early.
4. **The lines are submitted together** as one round: each is saved as its own turn attributed to its writer (`by`), all sharing a round id, and the story writes **one** reply to all of them. In solo play a round is one line.
5. **A round is one turn.** Undo takes back the whole round; retry answers every line again; the plot trigger counts a round once.
6. **Drafting during a reply is allowed.** While the story is writing, players can prepare and ready their next turn; the round just does not close until the story is idle.
7. **Spectators watch, players write.** Spectators see the board but cannot write or comment.

## Consequences
+ Fair for any number of players with no turn-order rules to argue about; the discussion happens before the story commits.
+ Attribution (`by`) gives chapters and the plot extractor real names.
- A slow player can hold up a round. The host's early close is the remedy; a time limit is not built.
- Editing a single line from the middle of a saved round cuts the rest of that round off the branch (as any edit does to later turns).
- The board is in-memory state of the running server; it is not part of the saved story, only the submitted lines are.

## Alternatives considered
- **Free-for-all when idle** (first to send wins) and **strict rotation**: simpler, but players cannot see or discuss each other's moves first.
- **Host approval of every turn**: puts all the work on the host.
