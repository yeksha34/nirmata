# ADR-0022: Visual novel asset serving and procedural artstyle fallbacks

- Status: Proposed
- Date: 2026-10-30
- Related: [ADR-0019](0019-vn-adaptation-pipeline-and-player.md), [F-59](../features/F-59-vn-adaptation-and-player.md)

## Context
When interactive Visual Novel adaptations (`worlds/<world>/vns/<slug>/`) are played in the web frontend (`VnCanvas.tsx` powered by Phaser 3), the presentation engine must display background sceneries, character sprites across stage slots (`left`, `center`, `right`), and full-stage Event CGs.

Previously:
1. `VnCanvas` only rendered procedural placeholder graphics (color gradients and geometric stone card shapes) without requesting or loading static image files from the backend server.
2. The server lacked an asset-serving route for visual novel static media, requiring proper MIME detection and authorization checks.
3. When external AI generation models (e.g. image-generator) hit upstream API quotas (HTTP 429 RESOURCE_EXHAUSTED) or when image assets are pending, the player must not break or leave empty spaces, but instead render stylistically cohesive procedural representations matching the world's canon visual design.

## Decision
1. **Server Asset Endpoint:**
   - Expose `GET /api/worlds/:name/vns/:slug/assets/*` in `apps/server/src/app.ts`.
   - Resolve subpaths safely inside `worlds/<name>/vns/<slug>/assets/` preventing path traversal.
   - Return appropriate binary content (`Buffer` -> `Uint8Array`) with correct MIME types (`image/jpeg`, `image/png`, `audio/mpeg`, etc.) and `Cache-Control: public, max-age=86400`.
   - Guarded by `story.start` host seat permission.

2. **Frontend Dynamic Texture Loader in Phaser (`VnCanvas.tsx`):**
   - `VnCanvas` receives `worldName` and `vnSlug` alongside `stage`.
   - On slide change or stage update, dynamic texture keys are generated:
     - Backgrounds: `bg_${worldName}_${vnSlug}_${bgName}`
     - Character Sprites: `sprite_${worldName}_${vnSlug}_${character}_${expression}`
     - Event CGs: `cg_${worldName}_${vnSlug}_${cgName}`
   - Utilizes Phaser 3's dynamic loader (`this.load.image`) with dual-format fallback (`.png` -> `.jpg` for sprites; `.jpg` -> `.png` for backgrounds/CGs).
   - Tracks `loadingKeys` and `failedKeys` to prevent redundant network requests.

3. **True Alpha Transparency Pipeline for Character Sprites:**
   - GenAI models (e.g. Gemini / Imagen) output 3-channel RGB rasters (such as JPEG or solid-background PNG) and cannot generate true 4-channel RGBA transparent files directly via text prompts alone.
   - Character sprites undergo an automated soft-matte alpha cutout and edge-defringing pipeline ([`tools/make_transparent.py`](../../tools/make_transparent.py)) to remove solid studio backdrops, producing genuine RGBA PNGs with zero-alpha backgrounds and anti-aliased borders that drop cleanly onto visual novel background scenes.

4. **Canon Sculptural Fallback Aesthetic:**
   - Pending image asset generation or on 404/quota exhaustion, the canvas renders procedural Classical Hindu Temple Sculpture aesthetic (monochromatic carved sandstone/basalt body silhouettes with metallic gold highlights, tribhanga curves, and character nameplates) matching the canon style sheet (`worlds/<world>/notes/style_sheet_vn_character_art.md`).

## Consequences
+ Seamless presentation: Real generated artwork loads dynamically and fades into view when present.
+ Zero breakage on missing assets or API quota exhaustion: Procedural fallbacks maintain full playability.
+ Safe asset streaming with complete content-neutral isolation ([ADR-0005](0005-scaffold-content-neutral.md)).
+ Bilingual Hindi-English error handling and clean semantic DOM compliance.
