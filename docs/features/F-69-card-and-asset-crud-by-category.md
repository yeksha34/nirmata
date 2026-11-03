# F-69: Add, change and remove cards and assets under their own category

| | |
|---|---|
| State | Review |
| Priority | Should |
| Owner | agent |
| Branch | `feat/supabase-database` |
| Target tag | none yet |

## Value
The author works on a card or an asset where it is listed: every kind of card and every kind of asset can be added to, changed and removed from its own heading, without a separate picker or editing files by hand.

## Acceptance criteria
- [x] The card list shows every kind (characters, places, lore, rules, story arcs, scenes), also when empty, each with its own "New <kind>" and a Remove on every card (web build; the save and delete calls were already there).
- [x] A visual novel's asset plan takes a new asset of any kind: a sprite (character and expression), a cg, a background, clothes or an adornment (character and name), an object (name, character optional). It then shows in the Studio list as pending (server tests).
- [x] An asset can be removed: it leaves the plan and its image in that visual novel is deleted. Its earlier runs stay in the dataset (server tests).
- [x] A repeated, badly named or character-less asset is refused; the all-assets and shared views cannot be planned into; only the host may do either (server tests).
- [ ] Tried in a browser on a real world: add a card under an empty heading, remove it; add an asset, generate it, remove it.

## Non-goals
- Renaming an asset or a card's kind (a rename would have to follow scripts and dataset folders).
- Cards of an imported world kept in the database: the list works on the world's files, as before.
- Editing a shared-pool asset's plan (the pool has only images).

## Design
`apps/server/src/asset-plan.ts` (pure add and remove on the manifest's `assets`), `WorldFiles.addVnAsset` / `removeVnAsset`, routes `POST /api/worlds/:name/vns/:slug/assets` and `DELETE …/assets/:type/:assetName`. Web: `CardList` in `screens/Manager.tsx`, `AddAsset` and the Remove asset button in `screens/VnStudio.tsx`.

## Verification log
| Date | What was run | Result |
|---|---|---|
| 2026-11-03 | Full test suite (768); typecheck | Pass; not tried in a browser |

## History
| Date | Change |
|---|---|
| 2026-11-03 | Written: per-heading add and remove for cards, add and remove for assets. |
