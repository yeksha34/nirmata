import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assetDir,
  composeLinkedPrompt,
  LINKED_KINDS,
  type LinkedDetails,
  type LinkedKind,
  parseLinkedCard,
} from "@nirmata/gen";

/** One clothes, adornment or object asset read from a world folder: its prompt and what it is linked to. */
export interface LinkedAsset {
  kind: LinkedKind;
  name: string;
  details: LinkedDetails;
  /** Composed from the card, as the Studio would show it. */
  positive: string;
  /** Characters the asset is locked or linked to, by the name a visual novel uses. */
  characters: string[];
  /** CG names an object is linked to. */
  cgs: string[];
  /** The card's reference image, a world-relative path (not uploaded by the import). */
  reference?: string | undefined;
}

interface ManifestAssets {
  clothes?: Record<string, string[]>;
  adornments?: Record<string, string[]>;
  objects?: Array<{ name: string; owners?: string[]; cgs?: string[] }>;
}

/** The owner a card name starts with: `<Owner>_<item>`. */
const ownerOf = (name: string) => name.slice(0, Math.max(name.indexOf("_"), 0)) || undefined;

function manifests(folder: string): ManifestAssets[] {
  const dir = join(folder, "vns");
  if (!existsSync(dir)) return [];
  const out: ManifestAssets[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, e.name, "manifest.json");
    if (!e.isDirectory() || !existsSync(file)) continue;
    try {
      const assets = (JSON.parse(readFileSync(file, "utf8")) as { assets?: ManifestAssets }).assets;
      if (assets) out.push(assets);
    } catch {
      // a manifest that cannot be read has no links to give
    }
  }
  return out;
}

/**
 * Reads the world's `clothes/`, `adornments/` and `objects/` cards. Links come from the visual novel
 * manifests (the names the novels use); a clothes or adornment card no manifest lists falls back to the
 * owner its name starts with. Pure file reads: nothing here touches the database.
 */
export function collectLinked(folder: string): LinkedAsset[] {
  const mans = manifests(folder);
  const owners = new Map<string, string>(); // `<kind>:<card name>` -> character
  const objects = new Map<string, { owners: Set<string>; cgs: Set<string> }>();
  for (const m of mans) {
    for (const [field, kind] of [["clothes", "clothes"], ["adornments", "adornment"]] as const) {
      for (const [character, names] of Object.entries(m[field] ?? {})) {
        for (const n of names) if (!owners.has(`${kind}:${character}_${n}`)) owners.set(`${kind}:${character}_${n}`, character);
      }
    }
    for (const o of m.objects ?? []) {
      const entry = objects.get(o.name) ?? { owners: new Set<string>(), cgs: new Set<string>() };
      for (const c of o.owners ?? []) entry.owners.add(c);
      for (const g of o.cgs ?? []) entry.cgs.add(g);
      objects.set(o.name, entry);
    }
  }

  const out: LinkedAsset[] = [];
  for (const kind of LINKED_KINDS) {
    const dir = join(folder, assetDir(kind));
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".md") || file.startsWith("_")) continue;
      const name = file.slice(0, -3);
      const details = parseLinkedCard(readFileSync(join(dir, file), "utf8"));
      const characters =
        kind === "object"
          ? [...(objects.get(name)?.owners ?? details.owners ?? [])]
          : [owners.get(`${kind}:${name}`) ?? ownerOf(name)].filter((c): c is string => !!c);
      out.push({
        kind,
        name,
        details,
        positive: composeLinkedPrompt(kind, name, details),
        characters,
        cgs: [...(objects.get(name)?.cgs ?? details.cgs ?? [])],
        reference: details.reference,
      });
    }
  }
  return out;
}
