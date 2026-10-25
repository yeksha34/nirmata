# @nirmata/server

Runs a table: one world, one shared board and one story at a time, for whoever joins. Whoever starts the server is the host ([ADR-0011](../../docs/decisions/0011-irc-style-joining.md), [ADR-0016](../../docs/decisions/0016-table-server.md)). There are no screens yet; this is the part a screen talks to.

## Run it

Tell it which model to use (settings come from the environment, never a file):

```bash
# any OpenAI-style server: KoboldCpp, Ollama, LM Studio, OpenRouter ...
NIRMATA_PROVIDER=openai NIRMATA_BASE_URL=http://localhost:5001 NIRMATA_MODEL=my-model corepack pnpm --filter @nirmata/server start
```

```bash
# try the table with no model at all (scripted replies)
NIRMATA_PROVIDER=demo corepack pnpm --filter @nirmata/server start
```

On start it prints the **host key**. Join as the host with it; everyone else joins with a nickname.

| Variable | Meaning | Default |
|---|---|---|
| `NIRMATA_PROVIDER` | `openai`, `anthropic` or `demo` | `openai` if `NIRMATA_BASE_URL` is set |
| `NIRMATA_MODEL`, `NIRMATA_BASE_URL`, `NIRMATA_API_KEY` / `ANTHROPIC_API_KEY` | the model | |
| `NIRMATA_CONTEXT_TOKENS` | the model's context size, for the prompt budget | 4096 |
| `NIRMATA_WORLDS` | the folder that holds your worlds (which one to play is chosen on screen) | `worlds` |
| `NIRMATA_HOST_NICK` | the host's nickname | `Host` |
| `NIRMATA_HOST_KEY` | proves you are the host | new each run |
| `NIRMATA_PORT`, `NIRMATA_BIND` | where to listen | `8788`, `127.0.0.1` (this computer only; `0.0.0.0` for the LAN) |
| `NODE_ENV=production` | joiners must confirm they are adults ([ADR-0014](../../docs/decisions/0014-age-confirmation-production-only.md)) | off |

Stories are saved under `<world>/stories/<id>/`: `events.jsonl` is the truth; `chapters/` and `plot/` are rewritten from it after every change.

## The API

Everything is JSON. Errors are always `{ "error": { "code", "message" } }` with a plain-language message. After joining, send `Authorization: Bearer <token>` (the live connection also accepts `?token=` because a browser `EventSource` cannot set headers).

| | |
|---|---|
| `GET /api/table` | open to anyone: the world's title, the host, whether adult confirmation is asked |
| `POST /api/join` `{nick, confirmedAdult?}` or `{hostKey}` | returns `{token, you}`; everyone starts as a spectator |
| `GET /api/events` | the live connection (server-sent events): `snapshot`, then `board`, `story`, `story-view`, `kicked` |
| `GET /api/state` | the same snapshot, once |
| `POST /api/play`, `/api/watch`, `/api/leave` | opt in to play, step back, leave |
| `PUT /api/board/draft` `{mode,text}`; `POST /api/board/ready`, `/unready`, `/remark`, `/object`; `DELETE /api/board/remarks/:id` | the shared board |
| `POST /api/board/close`, `/api/board/moderate` | host: close a round early; kick, mute, unmute, rename |
| `GET /api/worlds`, `POST /api/worlds/open` `{name}` | host: list the library, open a world (the only world opens by itself) |
| `GET /api/stories`, `POST /api/stories`, `POST /api/stories/:id/resume`, `POST /api/story/close` | host: list the open world's saved stories (with turns, players, a preview), start (`202`), continue, put the story away |
| `POST /api/story/retry`, `/continue`, `/stop`, `/undo`, `/edit`, `/pin` | players and host |
| `POST /api/story/goto`, `/break`, `/plot`, `/plot-points`, `/plot-points/undo`; `DELETE /api/story/plot-points/:id` | host |
| `POST /api/story/save-as-world` `{name, title?, at?}` | host: save the story as a new world beside this one ([F-48](../../docs/features/F-48-save-story-as-world.md)); open it from the library |
| `GET /api/source/world`, `GET/PUT /api/source/cards`, `DELETE /api/source/cards/:id` | the source cards: host, or players if the host allows reading |
| `GET/PATCH /api/settings` | host |

## What each person is shown

The host sees everything about the story. Everyone else sees the story as told: turns, chapter titles, who wrote what, and the board - never the cards the story plays on, nothing in them (Secrets are host-only), the prompt, rule findings or plot work. This is an allow-list in [`src/views.ts`](src/views.ts), tested against the whole stream.

## Limits worth knowing

No TLS, rate limiting or accounts; assume a LAN you trust. One table per process. A connection that drops keeps its seat, and a player who wrote a turn and vanished holds the round until the host closes it.
