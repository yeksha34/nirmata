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

On start it opens your browser on the **host link** (it contains the host key, in the part after `#` that is never sent anywhere), also printed in the terminal. Everyone else joins at the address with a nickname. The built screens (`apps/web`) are served at `/`; build them with `corepack pnpm --filter @nirmata/web build`, or use `corepack pnpm start` from the repo root, which does both.

| Variable | Meaning | Default |
|---|---|---|
| `NIRMATA_PROVIDER` | `openai`, `anthropic` or `demo` | `openai` if `NIRMATA_BASE_URL` is set |
| `NIRMATA_MODEL`, `NIRMATA_BASE_URL`, `NIRMATA_API_KEY` / `ANTHROPIC_API_KEY` | the model | |
| `NIRMATA_CONTEXT_TOKENS` | the model's context size, for the prompt budget | 4096 |
| `NIRMATA_WORLDS` | the folder that holds your worlds (which one to play is chosen on screen) | `worlds`, in the folder you started from |
| `NIRMATA_HOST_NICK` | the host's nickname | `Host` |
| `NIRMATA_HOST_KEY` | proves you are the host | new each run |
| `NIRMATA_OPEN` | set to `0` to stop it opening your browser | opens |
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
| `GET /api/recent` | host: the latest saved stories across every world, newest first ([F-53](../../docs/features/F-53-worlds-page.md)) |
| `POST /api/worlds` `{title, tagline?, premise?}` | host: make a world (`201`); the folder name follows the title; it is not opened |
| `GET /api/worlds/:name`, `PATCH /api/worlds/:name` `{title?, tagline?}` | host: a world's details, saved stories and cards without opening it; change its title or tagline |
| `POST /api/worlds/:name/archive` | host: put a world away (its folder is renamed to start with `_archived-`, nothing is deleted) |
| `POST /api/worlds/:name/stories` `{arcId?}`, `POST /api/worlds/:name/stories/:id/resume` | host: start or continue a story in that world, opening it first if needed |
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

## Database and file stores (optional)

The server also reads asset files through two small packages, `@nirmata/db` (`apps/db`) and `@nirmata/storage` (`apps/storage`). They switch on from the environment; without them the server runs from files alone.

| Variable | Purpose |
|---|---|
| `DATABASE_URL_RW` | the `app_rw` login (pooler address) |
| `NIRMATA_ASSET_DIR` | folder for `local` files, kept at `<dir>/<world uuid>/…` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the private `vn-assets` bucket (the key stays on the server) |

Routes (host only for now): `GET /api/health/db`, `GET /api/assets/renders/:id/file`. The second looks up the render with `assets.render_file`, then streams it from the store the row names (ADR-0028). Run `pnpm install` once so `pg` is installed.

## Generation (`apps/gen`)

`@nirmata/gen` holds the asset generation code that used to live in this package: the ComfyUI client, workflow parameter injection, prompt synthesis, sprite transparency and the job tracker. The server imports it; its failures are `GenError`s, which the server turns into the same plain error replies as before.

## Importing dataset images

A person runs this; it needs `DATABASE_URL_RW` and, for `--target=supabase`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `NIRMATA_ASSET_DIR` for `--target=local`):

```bash
pnpm --filter @nirmata/server import:assets worlds/<world> --world=<world uuid> --user=<host uuid> --dry
pnpm --filter @nirmata/server import:assets worlds/<world> --world=<world uuid> --user=<host uuid>
```

For each `assets/dataset/<scope>/<name>/<run>/generated_image.png` (newest run per name; `--select=all` takes every run) it uploads the file, then creates the asset, a spec and the render in one transaction, with store, size and hash. It acts as the host (`--user`), checks the storage quota before each upload and stops at "block", skips files whose hash the world already has, and removes an uploaded file if recording it fails. `--dry` does everything except write. Kinds come from the name: `cg_…` is a CG, `bg_…` a background, anything else a sprite. `prompt.json` supplies the prompt; the other sampler settings are placeholders (`euler`, 20 steps, cfg 7, seed 0), and the size is read from the image.

## Sign-in (`apps/auth`)

The browser never talks to Supabase. The server does, through `@nirmata/auth` (Supabase Auth's REST API), and keeps each person's Supabase tokens in its own memory; the browser holds only an `httpOnly`, `SameSite=Lax` cookie (`nirmata_session`). Restarting the server signs everyone out. Switch it on with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; set `NIRMATA_SITE_URL` (default `http://127.0.0.1:<port>`) to where people reach the server.

| Route | What it does |
|---|---|
| `POST /api/auth/login` | email and password; sets the cookie |
| `GET /api/auth/invitation?token=` | the address an invitation is for (404 for a wrong, used or expired token) |
| `POST /api/auth/register` | `{ token, password }`: no email needed. The server checks the invitation, creates the confirmed account for its address with the service role key, and signs the person in. Then call `onboard` |
| `POST /api/auth/signup` | the email route: needs custom SMTP and the email template change below; Supabase refuses an address with no pending invitation |
| `GET /auth/callback?token_hash=&type=&next=` | the email link: finishes sign-in, sets the cookie, redirects to `next` (a path on this site only) |
| `POST /api/auth/logout` | ends the session |
| `GET /api/auth/me` | who is signed in, with the profile |
| `POST /api/auth/onboard` | `{ attestAdult?, token? }`: makes the profile, confirms adulthood, accepts the invitation, all in one transaction as that person |

**Without custom SMTP** (Supabase will not let you edit templates, and its own mailer is nearly unusable) use `register`: set `SUPABASE_SERVICE_ROLE_KEY`, switch off "Allow new users to sign up" in Authentication, Sign In / Providers (the server creates accounts with the admin API, which still works), and skip the email notes below. Password reset by email does not work then; reset a password from the Supabase dashboard (Authentication, Users).

For the email route: add the callback to Supabase (Authentication, URL Configuration, Redirect URLs) and make the email templates link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup` (`invite`, `recovery` and `email` for the others), so the token reaches the server and not the browser. The first author (who hosts games) is invited with `node tools/invite-author.mjs <email>`; an administrator is made with `node tools/set-admin.mjs <email>`. The old host-key login still works alongside this until the screens replace it. Supabase applies its own rate limits to password attempts.
