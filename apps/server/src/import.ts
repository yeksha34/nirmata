import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { importStory, type Recipe } from "./legacy";

/**
 * Turns an older story folder into a world: `pnpm --filter @nirmata/server import <story> <world> <recipe.json>`.
 * The recipe names the world and says what to do with the few files that need a decision
 * (see apps/server/imports/imported-story.json).
 */
async function main(): Promise<void> {
  const [src, dest, recipePath] = process.argv.slice(2);
  if (!src || !dest || !recipePath) {
    console.error("usage: import <story folder> <new world folder> <recipe.json>");
    process.exit(2);
  }
  const recipe = JSON.parse(await readFile(resolve(recipePath), "utf8")) as Recipe;
  const report = await importStory(resolve(src), resolve(dest), recipe);
  console.log(`${report.cards} cards written, ${report.copied} files copied as they were`);
  console.log(
    Object.entries(report.byKind)
      .map(([k, n]) => `  ${k}: ${n}`)
      .join("\n"),
  );
  if (report.warnings.length) {
    console.log(`\n${report.warnings.length} things to look at:`);
    for (const w of report.warnings) console.log(`  - ${w}`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
