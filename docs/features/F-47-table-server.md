# F-47: The table server

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | unassigned |
| Branch | `feat/F-30-story-host-core` |
| Target tag | v0.2.0 |

## Value
Several people can join one story from their own browsers by nickname, write their turns together on the shared board, watch the story arrive live, and the host's stories and source cards stay safe on disk.

## Acceptance criteria
**Joining ([ADR-0011](../decisions/0011-irc-style-joining.md), [ADR-0016](../decisions/0016-table-server.md))**
- [x] Anyone can join with a free nickname and starts as a spectator; opting in to play is separate.
- [x] Whoever holds the host key takes the host's seat; a wrong key is refused; the host's nickname cannot be taken by anyone else.
- [x] In production, joining without the adult confirmation is refused with a plain message; the host is not asked.
- [x] Everything except `GET /api/table` and joining needs a token; a forged or revoked token is refused.

**The board and the story, live**
- [x] A closed round is sent to the story in the background; every connection sees the reply stream as it is written.
- [x] A round that closes while the story is writing waits and is sent when the story is idle.
- [x] The host can close a round early; players cannot.
- [x] Spectators and muted people cannot undo, retry, continue or write.
- [x] Players can undo, edit and retry; only the host can start a story, branch, break chapters, handle plot points, change settings or edit the source cards.
- [x] A failed reply is shown to everyone in plain words, without the model's raw error, and any player can retry.
- [x] A browser that reconnects receives a fresh snapshot.
- [x] Kicking ends the person's connection after telling them, and their token stops working; renaming updates the token's name and their draft.

**What each person is shown**
- [x] Players and spectators are never sent the story's copy of the cards, card text, Secrets, the prompt, rule findings, plot work, memory or the head of the log (checked against the whole stream and the state endpoint).
- [x] The host is sent the prompt inputs, rule findings and plot work.
- [x] Source cards are readable by players only when the host allows it.

**Files**
- [x] Every event is appended to `events.jsonl` before it is used; `chapters/` and `plot/` are rewritten from the log after every change.
- [x] A saved story resumes in a new server and carries on.
- [x] A half-written last line is set aside and the log repaired; a bad line elsewhere is reported.
- [x] Editing a source card never changes a story already begun.
- [x] Card paths cannot leave the card folders; story ids cannot leave the stories folder.

**Running it**
- [x] `pnpm --filter @nirmata/server start` with `NIRMATA_PROVIDER` `openai`, `anthropic` or `demo`; a missing setting is explained in plain words.
- [x] Listens on this computer only unless `NIRMATA_BIND` says otherwise.
- [ ] Tried against a live model and from a second device on the LAN (Q7, Q27).

## Non-goals
- Screens (the play screen, the join screen, the host's controls) - [F-50](../requirements.md).
- TLS, invite links and QR codes, rate limiting, accounts, more than one table per server.

## Design
`apps/server/src`: `app.ts` (routes, live connection), `table.ts` (people, board, running turns, what each person is sent), `views.ts` (the allow-list of what the table may see), `files.ts` (world folder and story folders), `config.ts` (environment), `errors.ts` (plain error bodies), `main.ts`. `serializeCard` was added to core so the server can write cards back as markdown.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-10-25 | `vitest`, `tsc -b`, `biome` | 41 server tests pass (12 file-store, 29 end-to-end through the HTTP routes with the fake provider): joining, tokens, host key, adult confirmation, seat cap, board rounds, busy handling, permissions per role, mute/kick/rename, privacy of every stream and state endpoint, settings, source-card edits and copy independence, resume, failure and retry, crash repair, chapter files |
| 2026-10-25 | Real server started in demo mode, driven with `curl` | Host and player joined, story started, a round written and sent; the player's stream carried `snapshot`, `board`, `story`, `story-view` and no card text; `events.jsonl` written |

## History
| Date | Change |
|---|---|
| 2026-10-25 | Specified, built and tested; first draft used a framework SSE helper that dropped the final message of a closing stream, replaced with a plain `ReadableStream` |
