import type { VnManifest, VnMode, VnTier } from "./types";

export interface CreateVnScaffoldOptions {
  slug: string;
  title: string;
  source: string; // e.g. "chapters/01_first_contact.md"
  mode?: VnMode;
  mc?: string;
  tier?: VnTier;
  order?: number;
  nextSlug?: string;
}

/** Generates a starter manifest object. */
export function createStarterManifest(options: CreateVnScaffoldOptions): VnManifest {
  const now = new Date().toISOString();
  return {
    slug: options.slug,
    title: options.title,
    source: options.source,
    mode: options.mode || "mode_1",
    mc: options.mc || "Protagonist",
    tier: options.tier || "short",
    routes: ["common", "canon"],
    variables: {
      resolve: {
        initial: 0,
        description: "MC's personal determination and focus",
      },
    },
    assets: {
      backgrounds: ["opening_scene"],
      characters: {
        [options.mc || "Protagonist"]: ["neutral", "determined"],
      },
      cgs: [],
      music: ["theme_ambient"],
      sfx: [],
    },
    createdAt: now,
    updatedAt: now,
    ...(options.order !== undefined ? { order: options.order } : {}),
    ...(options.nextSlug ? { nextSlug: options.nextSlug } : {}),
  };
}

/** Generates a starter adaptation.md document adhering to .agents/skills/story-to-vn-adaptation/SKILL.md. */
export function createStarterAdaptationMd(options: CreateVnScaffoldOptions): string {
  const mode = options.mode || "mode_1";
  const mc = options.mc || "Protagonist";
  const tier = options.tier || "short";

  return `# ${options.title} — Visual Novel Adaptation (${mode})
Source: ${options.source} · Mode: ${mode} · MC: ${mc} · Tier: ${tier} · Branching

## 1. Story Core
- **Central Conflict:** 
- **Theme:** 
- **Must-Keep Moments:**
  1. Opening introduction
  2. The pivotal decision point
  3. Resolution / transition to next act

## 2. Adaptation Notes
| Element | Decision | Reason |
|---|---|---|
| Opening scene | Keep | Establishes setting and protagonist's mindset |
| Inner thoughts | Convert | Transformed into first-person inner monologue \`( ${mc} )\` |

## 3. Route Map
\`\`\`mermaid
flowchart TD
  SC01["SC-01: Opening Beat"] --> SC02["SC-02: The Crossroads"]
  SC02 -->|Choose direct action| SC03["SC-03: Canon Path"]
  SC02 -->|Hesitate or observe| SC04["SC-04: Divergent Path"]
\`\`\`

| Route | Entry Condition | Endings | Ending Conditions |
|---|---|---|---|
| common | Start | Crossroads | Reaches SC-02 |
| canon | Choice 1 at SC-02 | Chapter conclusion | Clear |
| divergent | Choice 2 at SC-02 | Alternative outcome | Clear |

## 4. Variables
| Variable | Raised by | Lowered by | Read at |
|---|---|---|---|
| resolve | Bold choices | Passive choices | SC-03 |

## 5. Characters
### ${mc} (Protagonist)
- **Role:** Main character and narrator
- **Voice:** Direct, observant
- **Expressions:** neutral, determined

## 6. Asset List
- **Backgrounds:** opening_scene, crossroads
- **Sprites:** ${mc} (neutral, determined)
- **CGs:** none
- **Music:** theme_ambient
- **SFX:** none

## 7. Scene List
| ID | Route | Location | Characters | Purpose | Choice / variables | CG | ~Words |
|---|---|---|---|---|---|---|---|
| SC-01 | common | opening_scene | ${mc} | Establish situation and stakes | None | None | ~100 |
| SC-02 | common | crossroads | ${mc} | Present the pivotal choice | MENU (2 options) | None | ~150 |
| SC-03 | canon | crossroads | ${mc} | Canon forward resolution | None | None | ~100 |
| SC-04 | divergent | crossroads | ${mc} | Divergent branch | None | None | ~100 |

## 8. Script

## SC-01  The Journey Begins   [route: common] [~100 words]
[bg opening_scene] [music theme_ambient] [fade in]
[show ${mc} neutral]

The road ahead is quiet, narrower than the maps promised.

( ${mc} ) Every journey begins with a breath before the first step.

The path bends towards the old crossroads.

[jump SC-02]

## SC-02  The Crossroads   [route: common] [~150 words]
[bg crossroads]
[show ${mc} determined]

At the intersection, a weathered marker stands half-buried in the soil.

( ${mc} ) Two paths lead forward. One is well-trodden, the other overgrown.

MENU
  * "Take the direct road." (canon) → SC-03 {resolve +1}
  * "Inspect the overgrown trail."  → SC-04

## SC-03  The Open Road   [route: canon] [~100 words]
[show ${mc} determined]

${mc}: There is no time to lose on uncertain trails.

( ${mc} ) The wider road is clear. Whatever lies ahead, I am prepared.

[ending: chapter_complete]

## SC-04  The Hidden Path   [route: divergent] [~100 words]
[show ${mc} neutral]

( ${mc} ) The overgrown trail conceals ancient footprints. Perhaps someone passed this way recently.

A quiet hum echoes from the trees ahead.

[ending: trail_discovered]
`;
}
