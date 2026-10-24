import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Card, parseCard, parseWorldManifest, type WorldManifest } from "../src";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Loads a real world from disk the way the server will, so tests exercise real card files. */
export function loadWorld(name: string): {
  world: WorldManifest;
  cards: Card[];
  problems: string[];
} {
  const root = join(REPO_ROOT, "worlds", name);
  const manifest = parseWorldManifest(readFileSync(join(root, "world.json"), "utf8"));
  if (!manifest.ok) throw new Error(manifest.errors.join("; "));

  const cards: Card[] = [];
  const problems: string[] = [];
  const cardDirs = ["lore", "characters", "setting", "plot", ".agents/rules"];
  for (const dir of cardDirs) {
    let files: string[] = [];
    try {
      files = walk(join(root, dir));
    } catch {
      continue;
    }
    for (const file of files.filter((f) => f.endsWith(".md") && !/[\\/]_/.test(f))) {
      const rel = relative(root, file).replaceAll("\\", "/");
      const result = parseCard(rel, readFileSync(file, "utf8"));
      if (result.ok) cards.push(result.card);
      else problems.push(`${rel}: ${result.errors.join("; ")}`);
    }
  }
  return { world: manifest.world, cards, problems };
}

export function card(id: string, extra: Record<string, unknown> = {}, body = "Body text."): Card {
  const kind = (extra.kind as string | undefined) ?? "lore";
  return {
    path: `${id}.md`,
    fm: {
      id,
      kind,
      name: (extra.name as string | undefined) ?? id,
      keywords: [],
      summary: "",
      always: false,
      origin: "authored",
      rating: "everyone",
      scope: "both",
      severity: "should",
      ...extra,
    } as Card["fm"],
    body: `# ${id}\n\n${body}`,
  };
}
