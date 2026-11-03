# F-70: The adaptation agent works through the backend, in the database

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | none yet |

## Value
The adaptation agent no longer writes files into a world's folder. An author gives it a token; with that it reads the character cards, records what asset generation needs about each character, plans the first assets, and later adds only the assets a chapter needs that the existing ones do not express. One copy of the data, in the database ([ADR-0035](../decisions/0035-adaptation-data-in-the-database.md)). This is the first of three slices (character prep and plan, then workflow templates, then VN content).

## Acceptance criteria
- [x] `apps/importer` and `apps/adaptation` are their own packages; the server imports both; no behaviour change (tests unchanged).
- [x] An author makes, lists and revokes an agent token for one world (routes, server tests). The database keeps only its hash.
- [x] `GET/PUT/DELETE /api/agent/worlds/:name/characters…` read each character card with its prep state (`none`, `stale`, `current`) and store the prep (server tests with a fake database).
- [x] `GET …/baseline` lists the unclad base and each equipable still missing; `POST/DELETE …/assets` plans and unplans an asset under the rules of `asset-plan.ts`; `POST …/assets/gap` reports only the needs no existing asset expresses (unit and server tests).
- [x] A token works only for its own world and its scopes (`adaptation.read`, `adaptation.write`); a revoked, expired or unknown token is refused (server tests).
- [ ] The database objects run on a real database: `db/identity/migrations/20261103000300_agent_tokens.sql`, `db/assets/migrations/20261103000400_character_prep.sql`, the changed unique indexes in `20261102001000_assets.sql`, and pgTAP `010_agent_tokens.sql` and `011_character_prep.sql`. **Not run: there is no Postgres on the machine this was built on.**
- [ ] Tried with a real agent against a real imported world (create token, prep a character, plan the baseline).
- [ ] The Studio lists an imported world's planned assets from the database (it still reads the manifest) and the world manager has an "Agent access" panel.

## Non-goals
- Workflow templates in the database (F-71) and visual novel content in the database (F-72).
- Renaming an asset or a character.
- Importing chapters, drafts and `world.json` (comes with F-72).

## Design
- Packages: `apps/importer` (import:* scripts, lore rows, card-folder reader), `apps/adaptation` (asset plan rules, agent tokens, character prep, plan store, gap check).
- Tables: `identity.agent_tokens`; `assets.character_prep`, `character_expressions`, `character_outfits`; the plan itself is the existing `assets.assets` (status `planned`) with `asset_links`. `assets.unplan_asset` deletes an ungenerated asset and retires a generated one; the unique name index no longer counts retired assets.
- Routes: `agent-routes.ts`. A prep is made from the card as it is now unless the agent sends the `cardHash` it read.
- Gap rule: stricter than how the player finds an image. A bare portrait does not express another expression; only an exact `<character>_<state>_<expression>` does, or the neutral portrait for the neutral look.
- The skill ([story-to-vn-adaptation](../../.agents/skills/story-to-vn-adaptation/SKILL.md)) has a new Step 0 and a gap check in Step 6.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | `tsc -b`; full test suite (796) | Pass |
| 2026-11-03 | SQL migrations and pgTAP 010, 011 | Not run (no Postgres here) |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Importer and adaptation split into packages; agent tokens; character prep, plan and gap endpoints; ADR-0035. |
