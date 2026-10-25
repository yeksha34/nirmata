# ADR-0015: Moderation is told in the story's voice

- Status: Accepted 2026-10-25
- Related: [ADR-0011](0011-irc-style-joining.md), [F-46](../features/F-46-shared-board-and-table-rules.md)

## Context
Without accounts, a host still needs to deal with someone who joined by nickname. The owner: *yes (kick, mute, rename), but it should be written in in-game flavoured text: a magic spell, tape, a weapon, and so on.*

## Decision
1. The host can **kick**, **mute**, **unmute** and **rename** people at the table; only the host (`board.moderate` in the permission table). The host cannot be targeted.
2. Each action is announced to the table as one line of in-fiction text in one of four styles: **spell**, **tape**, **weapon**, **trap** (for example: "A strip of black tape seals Robin's mouth."). The host may choose a style; otherwise the style and wording rotate deterministically.
3. The wording is flavour only. The effect is plain state the interface shows separately: *muted* (can read, cannot write, remark or object; their draft is not submitted), *removed*, *renamed*.
4. Kick means leave the room, not a ban: the person can join again. Mute is lifted by unmute. Notices are kept (last 50) on the board, outside the saved story.
5. A person who is refused an action by their own mute gets a plain sentence ("Your voice is hushed for now: you can read, but not write."), so the flavour never hides what happened.

## Consequences
+ Moderation feels part of the world and is easy to read for everyone at the table.
- No bans, time-limited mutes or audit trail; add if abuse becomes a real problem.
- Flavour text is English only and is a fixed table of wording.

## Alternatives considered
- **Plain system messages**: rejected by the owner. **Free-form host text**: possible later; the table keeps wording tidy and safe.
