import type { AssetKind } from "./asset-kind";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "@nirmata/db";
import type { Stores } from "@nirmata/storage";
import { recordRender } from "./record-render";

export type ImportTarget = "supabase" | "local";
export type ImportSelect = "latest" | "all";
type Kind = AssetKind;

export interface ImportOptions {
  db: Db;
  stores: Stores;
  /** worlds/<world>/assets/dataset */
  datasetDir: string;
  /** The world's id in the database. */
  worldId: string;
  /** The host the import acts as (creating assets and specs needs the host's rights). */
  userId: string;
  /** Where the bytes go. */
  target: ImportTarget;
  /** `latest` takes the newest attempt with an image per name; `all` takes every one. */
  select?: ImportSelect;
  /** Do everything except write: count what would be uploaded and check the quota. */
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface ImportReport {
  found: number;
  uploaded: number;
  /** Content already in the database (same hash), or repeated in this run. */
  duplicates: number;
  /** Not uploaded because the quota level reached "block"; the run stopped there. */
  blocked: number;
  failed: number;
  bytesUploaded: number;
  failures: string[];
  byKind: Record<Kind, number>;
}

export interface Candidate {
  scope: string;
  name: string;
  run: string;
  kind: Kind;
  file: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  positive: string;
  negative: string;
  path: string;
}

const SAFE = /^[A-Za-z0-9._-]{1,120}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}$/;

/**
 * The kind a dataset name belongs to: `cg_…` is a CG, `bg_…` a background, `clothes_…`, `adornment_…`
 * and `object_…` their kinds, anything else a sprite.
 */
export function kindOf(name: string): Kind {
  if (name.startsWith("cg_")) return "cg";
  if (name.startsWith("bg_")) return "bg";
  if (name.startsWith("clothes_")) return "clothes";
  if (name.startsWith("adornment_")) return "adornment";
  if (name.startsWith("object_")) return "object";
  return "sprite";
}

const dirs = (p: string) =>
  readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

/** Width and height from a PNG's header; undefined for anything else. */
export function pngSize(data: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 24 || sig.some((b, i) => data[i] !== b)) return undefined;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function readPrompt(file: string, fallback: string): { positive: string; negative: string } {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { positive?: unknown; negative?: unknown };
    return {
      positive: typeof j.positive === "string" && j.positive.trim() ? j.positive : fallback,
      negative: typeof j.negative === "string" ? j.negative : "",
    };
  } catch {
    return { positive: fallback, negative: "" };
  }
}

/** Walks `<scope>/<name>/<run>/generated_image.png`, oldest run first within a name. */
export function scanDataset(
  datasetDir: string,
  worldId: string,
  select: ImportSelect = "latest",
): { candidates: Candidate[]; skipped: string[] } {
  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  for (const scope of dirs(datasetDir)) {
    for (const name of dirs(join(datasetDir, scope))) {
      const found: Candidate[] = [];
      for (const run of dirs(join(datasetDir, scope, name)).sort()) {
        const dir = join(datasetDir, scope, name, run);
        const file = join(dir, "generated_image.png");
        if (!existsSync(file)) continue;
        if (![scope, name, run].every((s) => SAFE.test(s)) || !ASSET_NAME.test(name)) {
          skipped.push(`${scope}/${name}/${run}: the name has characters a stored file cannot use`);
          continue;
        }
        const data = readFileSync(file);
        const size = pngSize(data);
        const clamp = (n: number) => Math.min(4096, Math.max(64, n));
        const prompt = readPrompt(join(dir, "prompt.json"), name);
        found.push({
          scope,
          name,
          run,
          kind: kindOf(name),
          file,
          bytes: statSync(file).size,
          sha256: createHash("sha256").update(data).digest("hex"),
          width: clamp(size?.width ?? 512),
          height: clamp(size?.height ?? 768),
          positive: prompt.positive.slice(0, 8000),
          negative: prompt.negative.slice(0, 8000),
          path: `${worldId}/${scope}/${name}/${run}.png`,
        });
      }
      candidates.push(...(select === "all" ? found : found.slice(-1)));
    }
  }
  return { candidates, skipped };
}

/**
 * Imports dataset images: uploads each one to the chosen store, then records its asset, spec and
 * render (with store, size and hash) in one transaction. Safe to run again: a file whose hash is
 * already in the world is skipped, and a failed record removes the file it just uploaded.
 * Checks the storage quota before each upload to Supabase and stops at "block".
 */
export async function importDataset(options: ImportOptions): Promise<ImportReport> {
  const { db, stores, worldId, userId, target } = options;
  const log = options.log ?? (() => undefined);
  const store = stores[target];
  if (!store && !options.dryRun) throw new Error(`The ${target} store is not set up on this server.`);

  const { candidates, skipped } = scanDataset(options.datasetDir, worldId, options.select);
  const report: ImportReport = {
    found: candidates.length,
    uploaded: 0,
    duplicates: 0,
    blocked: 0,
    failed: skipped.length,
    bytesUploaded: 0,
    failures: [...skipped],
    byKind: { sprite: 0, cg: 0, bg: 0, clothes: 0, adornment: 0, object: 0 },
  };
  const seen = new Set<string>();
  let warned = false;

  for (const [i, c] of candidates.entries()) {
    const label = `${c.scope}/${c.name}/${c.run}`;
    if (seen.has(c.sha256)) {
      report.duplicates++;
      continue;
    }
    seen.add(c.sha256);

    const known = await db.asUser(userId, async (q) =>
      (await q("select 1 from assets.renders where world_id = $1 and sha256 = $2 limit 1", [worldId, c.sha256])).rows,
    );
    if (known.length > 0) {
      report.duplicates++;
      continue;
    }

    if (target === "supabase") {
      const status = await db.server(async (q) =>
        (await q("select level, used_pct from assets.storage_status($1)", [c.bytes])).rows[0],
      );
      if (status?.level === "block") {
        report.blocked = candidates.length - i;
        log(`Stopped: storage would reach ${status.used_pct}% (block). ${report.blocked} files not uploaded.`);
        break;
      }
      if (status?.level === "warn" && !warned) {
        warned = true;
        log(`Warning: storage would reach ${status.used_pct}%.`);
      }
    }

    if (options.dryRun) {
      report.uploaded++;
      report.bytesUploaded += c.bytes;
      report.byKind[c.kind]++;
      continue;
    }

    try {
      const data = new Uint8Array(readFileSync(c.file));
      await (store as NonNullable<typeof store>).put(c.path, data, "image/png");
      try {
        await db.asUser(userId, (q) =>
          recordRender(q, {
            worldId,
            kind: c.kind,
            name: c.name,
            path: c.path,
            positive: c.positive,
            negative: c.negative,
            width: c.width,
            height: c.height,
            store: target,
            bytes: c.bytes,
            sha256: c.sha256,
          }),
        );
      } catch (e) {
        await (store as NonNullable<typeof store>).remove(c.path).catch(() => undefined);
        throw e;
      }
      report.uploaded++;
      report.bytesUploaded += c.bytes;
      report.byKind[c.kind]++;
      log(`imported ${label}`);
    } catch (e) {
      report.failed++;
      report.failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!options.dryRun && target === "supabase" && report.uploaded > 0) {
    await db.server(async (q) => q("select * from assets.storage_status(0, true)")); // raises the daily alert if due
  }
  return report;
}
