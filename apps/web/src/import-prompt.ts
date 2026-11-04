/** The tokens an import hands out, and the environment variable each one is kept in. */
export const TOKEN_ENV = {
  full: "NIRMATA_TOKEN_FULL",
  characters: "NIRMATA_TOKEN_CHARACTERS",
  accessories: "NIRMATA_TOKEN_ACCESSORIES",
  settings: "NIRMATA_TOKEN_SETTINGS",
} as const;
export type TokenLane = keyof typeof TOKEN_ENV;

/** Lines of `NAME=value`, for the terminal the agent will run in. */
export function tokenBlock(tokens: Record<TokenLane, string>): string {
  return (Object.keys(TOKEN_ENV) as TokenLane[])
    .map((k) => `${TOKEN_ENV[k]}=${tokens[k]}`)
    .join("\n");
}

/** What the author expects of the import. They edit it; the prompt is made from it. */
export const DEFAULT_EXPECTATIONS = `1. Copy into <WORKING-FOLDER>/source only these folders of the source: characters/, lore/, setting/, chapters/ (markdown files only), .agents/rules/ and .agents/skills/. Ignore everything else.
2. A card holds one subject and only what is true of that subject. If something that happens in the story leaked into a character, place or lore text, it does not stay in that card: it becomes its own card of its own kind (for example "event").
3. Character cards use the character template's fields and the content each field expects. Attire becomes "clothes" cards, ornament becomes "adornment" cards, held or carried things become "object" cards. Each has an "owner" field naming the character, and each is a separate card.
4. A character's id is "character." plus her file name in lowercase, underscores as hyphens, no extension.
5. Move the author's words as they are. Do not soften, censor, summarise or "fix" anything. If you cannot move a passage, leave it unplaced and tell me the file and line numbers, not the text.
6. After the known kinds are done, the rest goes into cards of kinds the world needs, including kinds you make up. Reuse an existing kind before you invent one (GET /cards).
7. Plots: for each folder under chapters/, save its scene, draft and chapter files, its translations.md and its character_arcs.md as writings, one file per call, as chapters/<slug>/scene|draft|chapter/<file>.md, chapters/<slug>/translations.md and chapters/<slug>/character_arcs.md. The folder name decides what a file is: draft/ files are listed as drafts, scene/ files as scenes (not as chapters), the rest as chapters.
8. Do not publish. I will say when.
9. Never write source text into your reports, a repository, a commit or a log. Report file names and ids only.`;

export interface PromptInput {
  /** Where the server is reached, e.g. http://127.0.0.1:8788 */
  server: string;
  world: string;
  settingsKinds: string[];
  expectations: string;
}

/** The prompt for the agent that runs the import, with this world's address and the author's expectations. */
export function importPrompt(i: PromptInput): string {
  return `You are the import orchestrator for one Nirmata world. Work through the skill "story-import" (<NIRMATA-REPO>/.agents/skills/story-import/SKILL.md) and the API reference <NIRMATA-REPO>/docs/api/agent.openapi.json. Read both first. Use the endpoints only; never the database.

SETTINGS
  Server:   ${i.server}
  World:    ${i.world}   (it already exists; the import fills it)
  Tokens:   environment variables ${Object.values(TOKEN_ENV).join(", ")}. Never print or log them.
  Source:   <SOURCE-FOLDER>   (read only; never edit it, never commit anything from it)
  Working:  <WORKING-FOLDER>   (your working folder, outside any repository)

EXPECTATIONS
${i.expectations.trim()}

PROCEDURE
  A. Make the working folder layout: source/, ledger/, left/. Copy the source as the expectations say.
  B. With the FULL token, save the skill (PUT /skills/<name>) and each rules file (PUT /rules/<name>), whole and unchanged, using the file names for the names. Then READ the rules and the skill: they say what the author means and what must not be written. Tell me if a rule stops you from importing something.
  C. PILOT. Start three workers at the same time (subagents), each with only its own token in its environment, each working one file at a time and keeping its ledger as the skill describes:
       - characters:  kind "character".   Input: source/characters/*.
       - accessories: kinds "clothes", "adornment", "object". Input: the same character files.
       - settings:    kinds ${i.settingsKinds.map((k) => `"${k}"`).join(", ")}. Input: source/setting/*.
     Each worker reads GET /cards?kind=... before writing, writes only its kinds, and appends to ledger/<lane>.jsonl a line for every stretch of source it took.
     In the pilot each worker does only its first THREE files. Then stop. Show me the ids and kinds written, the ledger lines, and anything you were unsure how to split. Wait for my "go".
  D. After "go": the workers finish their folders. When all three are done, check GET /cards: every character file has a card; every garment, ornament and object found in those files has one.
  E. Remnants: run  node <NIRMATA-REPO>/.agents/skills/story-import/remnants.mjs <WORKING-FOLDER>/source <WORKING-FOLDER>/ledger <WORKING-FOLDER>/left
     Then, with the FULL token, take what is left: first the remnants of the character and setting files, then every lore file whole, one card per subject, in cards of the world's own kinds. Keep the ledger. Before you create a new kind, list the kinds you intend to make and wait for my OK.
  F. Plots, with the FULL token, as the expectations say.
  G. Run remnants.mjs again. Report: cards written per kind, new kinds, files that still hold unplaced text (names and line numbers), and every subject you were unsure how to split.

Start with A and B, then show me what the rules say in a short list, before step C.`;
}
