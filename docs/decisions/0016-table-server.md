# ADR-0016: One table per server; seats by token; snapshot, then changes

- Status: Proposed 2026-10-25 (working plan until the owner confirms)
- Related: [ADR-0006](0006-stack-revision.md), [ADR-0009](0009-story-copies-and-source-permissions.md), [ADR-0011](0011-irc-style-joining.md), [ADR-0013](0013-shared-board.md), [F-47](../features/F-47-table-server.md)

## Context
The engine (core, llm, host) does no I/O and knows nothing about connections. Something has to carry it to browsers: let people join by nickname, hold the shared board, stream replies to everyone at once, keep stories on disk, and make sure the people at the table are shown only what the table may see. The owner's constraints: no accounts (IRC-style), whoever runs the server is the host, source cards are edited only by the host, and views for everyone else never include card copies or Secrets.

## Decision
1. **One table per server process.** A table is one world, one board and at most one active story at a time. A host who wants another world runs another server. This keeps the board, the story and the connections in a single object (`Table`) with no cross-table state.
2. **Seats are tokens.** Joining with a nickname returns a random bearer token (24 random bytes); it is the only credential. There are no passwords or accounts. A token stops working when its holder leaves or is kicked. Anyone who holds the **host key** (printed on the host's console at startup, or set with `NIRMATA_HOST_KEY`) may take the host's seat; the nickname is the one the server was started with. The key is compared in constant time.
3. **The session acts as the host; the table checks the caller.** `StorySession` is created with the host's actor and every operation first goes through the same permission table (`can`) with the *caller's* role. A player can undo, edit, retry and pin; only the host can start a story, jump branches, break chapters, handle plot points, change settings or touch the source cards. Spectators, and people muted by the host, can only watch.
4. **Streaming operations answer at once; progress arrives on the live connection.** Starting a story, a closed round, retry and plot extraction return `202`; everything they produce reaches every connection through `GET /api/events`.
5. **Live connection = a full snapshot, then changes.** The first message on a connection is the whole current state for that person; after that come `board`, `story` (streamed reply events) and `story-view` (full turn list after any change). A browser that reconnects simply receives a fresh snapshot, so nothing needs replaying and `Last-Event-ID` is not used. Plain server-sent events, written by hand on a `ReadableStream`: closing a stream there delivers what is already queued, which a framework helper did not (it dropped the final "you were sent away" message).
6. **What each audience is shown is an allow-list.** The host is shown everything about the story (prompt inputs, rule findings, plot work, memory, settings). Everyone else is shown turns, chapter titles, who wrote what, and the board. Their views are built field by field in `views.ts` and events are translated one by one; an event or field added later stays private until someone adds it there on purpose. Errors the table sees are plain: model failures use the provider's user-facing message; anything unexpected becomes a fixed sentence.
7. **Files.** `worlds/<world>/stories/<id>/events.jsonl` is the truth, one JSON event per line, appended before the event is applied. `chapters/` and `plot/` beside it are rewritten from the log after every change (written only when changed, stale files removed). A half-written last line after a crash is set aside in `events.jsonl.dropped` and the log is made whole before the next append; a bad line anywhere else is reported, not guessed at. Source cards are plain markdown in the world folder; paths are confined to the card folders.
8. **Defaults that keep it private.** The server listens on this computer only (`127.0.0.1`) unless `NIRMATA_BIND` says otherwise. Settings come from environment variables, never files, so keys are not committed.

## Consequences
+ The server is a thin shell over tested pieces; permissions and privacy live in two small, well-tested places (`Table`, `views.ts`).
+ A crash loses at most the reply being written; a reconnect never needs a replay protocol.
- A token in a query string (`?token=`, needed because the browser `EventSource` cannot set headers) can end up in access logs; header form is preferred and used by the tests.
- No TLS, rate limiting or per-IP limits; a LAN is assumed. The table seats at most 64 people to bound tokens held.
- A connection that drops silently keeps its seat (shown as offline); a player who wrote a turn and then vanished holds the round until the host closes it.
- One active story per table; switching stories needs the story to be idle.

## Alternatives considered
- **WebSockets for everything**: harder to resume and to proxy; the traffic is almost all server-to-browser. Posts are plain HTTP.
- **A server per story, or many tables per server**: more moving parts for a use that is a handful of friends.
- **Per-request actors inside the session**: the session would need a second permission layer; checking in one place was simpler.
- **A framework SSE helper**: tried first; it cancels its output on close and lost the last message.
