import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Card, parseCard, parseWorldManifest, type WorldManifest } from "@nirmata/core";

/** Where a world keeps its cards. Same layout the editor and the linter use. */
export const CARD_DIRS = ["lore", "characters", "setting", "plot", ".agents/rules"] as const;

/** One card file: its text, and either the card it holds or what is wrong with it. */
export interface CardFile {
  path: string;
  text: string;
  card?: Card;
  problems?: string[];
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** Every `.md` file under a folder (not those starting with `_`), in name order. */
export async function markdownFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await markdownFiles(full)));
    else if (name.endsWith(".md") && !name.startsWith("_")) out.push(full);
  }
  return out;
}

/** Every card file of a world folder as it is on disk, readable or not. */
export async function readCardFiles(root: string): Promise<CardFile[]> {
  const out: CardFile[] = [];
  for (const dir of CARD_DIRS) {
    for (const file of await markdownFiles(join(root, dir))) {
      const rel = file.slice(root.length + 1).replaceAll("\\", "/");
      const text = await readFile(file, "utf8");
      const parsed = parseCard(rel, text);
      out.push(
        parsed.ok
          ? { path: rel, text, card: parsed.card }
          : { path: rel, text, problems: parsed.errors },
      );
    }
  }
  return out;
}

/** A world folder's `world.json`. */
export async function readWorldManifest(root: string): Promise<WorldManifest> {
  let text: string;
  try {
    text = await readFile(join(root, "world.json"), "utf8");
  } catch (e) {
    if (isMissing(e)) throw new Error("This world has no world.json.");
    throw e;
  }
  const parsed = parseWorldManifest(text);
  if (!parsed.ok) throw new Error(`world.json: ${parsed.errors.join("; ")}`);
  return parsed.world;
}
