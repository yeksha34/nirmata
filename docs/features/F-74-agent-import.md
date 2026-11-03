# F-74: An agent imports a world, one file at a time

| | |
|---|---|
| State | Review |
| Priority | Must |
| Owner | agent |
| Branch | `feat/F-74-agent-import` |
| Target tag | `adaptation-in-the-database` once an import has run on a real source |

## Value
A story's source is not made of cards. An agent with a token can read a file, decide which subjects it holds and write one card for each, so a world's lore lands in the database scoped by subject ([ADR-0037](../decisions/0037-import-is-done-by-an-agent-one-file-at-a-time.md)). The world's own guide and the author's rules of writing are stored with it.

## Acceptance criteria
- [x] Agent tokens carry `import.read` / `import.write` besides the adaptation scopes; an adaptation token cannot write cards, skills or rules, and an import token cannot touch the asset plan.
- [x] Cards: `GET/PUT/DELETE …/cards[/<kind.name>]`, `POST …/publish`. A card's kind is the world's to name; the standard kinds keep their templates.
- [x] World skills (`world_lore.world_skills`) and author rules (`world_lore.author_rules`), authors only, with `GET/PUT/DELETE …/skills` and `…/rules`.
- [x] The story endpoints (`…/writing`) accept an import token too; a plot's scenes, drafts, chapters and translations are writings by path.
- [x] A fixed OpenAPI reference of the agent API, [docs/api/agent.openapi.json](../api/agent.openapi.json), kept in step with the routes by a test.
- [x] The `story-import` skill describes the procedure (copy, characters first with attire, ornament and objects split out, remnants, lore, places, plots, report).
- [x] Tests no longer read the removed `worlds/` folder; the example and template worlds are fixtures in `test-fixtures/`.
- [ ] The migrations `20261104000100_agent_import_scopes.sql`, `20261104000200_world_skills_and_rules.sql` and `db/tests/015_world_skills_and_rules.sql` run on a real database.
- [ ] A real agent imports a real source with a real token.

## Non-goals
- Reading a folder in the backend: the agent holds the source.
- Judging whether a card is scoped to one subject: the skill says how, the report lists what was unplaced.
- Removing the folder fallbacks from the library code (a world that is not in the database still reads its folder).
- Characters' sprite prompts from prep tags, and the web editor for skills and rules.

## Design
- `identity/…20261104000100`: the token scope list gains the two import scopes.
- `world_lore/…20261104000200`: `world_skills` and `author_rules`, author-only functions and policies.
- `apps/importer`: `CardStore` (list, get, save, remove, publish) and `GuideStore` (skills and rules).
- `apps/server/src/agent-routes.ts`: the routes; `forWorld` takes one scope or a list.
- `CardFrontmatter.kind` accepts a custom kind (`CUSTOM_KIND`); the manager's form keeps the standard kinds.
