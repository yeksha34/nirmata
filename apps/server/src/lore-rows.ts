import { createHash } from "node:crypto";
import type { Card } from "@nirmata/core";
import type { Query } from "@nirmata/db";

/** What one card becomes in the database. Its id is kept in `meta`, so it can be written back out. */
export interface CardRow {
  kind: string;
  slug: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  parts: Array<{ key: string; body: string }>;
  secrets: string[];
}

export const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const CARD_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
/** The named part that holds a card's host-only Secrets. */
export const SECRETS = "secrets";

export function cardRow(card: Card): CardRow {
  const { name, kind, fields, ...rest } = card.fm as Record<string, unknown> & {
    name: string;
    kind: string;
    fields: Record<string, string>;
  };
  const parts = Object.entries(fields ?? {})
    .filter(([key, text]) => key !== SECRETS && text.trim())
    .map(([key, text]) => ({ key, body: text.trim() }));
  const secret = (fields?.[SECRETS] ?? "").trim();
  return {
    kind,
    slug: card.fm.id.replace(".", "-"),
    title: name,
    body: card.body,
    meta: { ...rest, path: card.path },
    parts,
    secrets: secret ? [secret] : [],
  };
}

/** JSON with sorted keys, so two meta objects compare equal whatever order the database returns. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The world name in world.json as a database slug (lowercase letters, digits, hyphens). */
export function slugFor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/** Makes (or finds) the card, returning its id. */
export async function upsertCard(
  q: Query,
  worldId: string,
  row: Pick<CardRow, "kind" | "slug">,
): Promise<string> {
  const found = await q(
    `insert into world_lore.cards (world_id, kind, slug) values ($1, $2, $3)
     on conflict (world_id, slug) do update set kind = excluded.kind returning id`,
    [worldId, row.kind, row.slug],
  );
  return String(found.rows[0]?.id);
}

/** Replaces the author's draft of one card: its title, body, meta, named parts and Secrets. */
export async function writeDraft(
  q: Query,
  ids: { worldId: string; line: string; card: string; userId: string },
  row: CardRow,
): Promise<void> {
  const { worldId, line, card, userId } = ids;
  await q(
    `insert into world_lore.card_drafts (line_id, card_id, world_id, title, body, meta, updated_by)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)
     on conflict (line_id, card_id) do update
       set title = excluded.title, body = excluded.body, meta = excluded.meta`,
    [line, card, worldId, row.title, row.body, JSON.stringify(row.meta), userId],
  );
  await q("delete from world_lore.card_draft_parts where line_id = $1 and card_id = $2", [
    line,
    card,
  ]);
  await q("delete from world_lore.card_draft_secrets where line_id = $1 and card_id = $2", [
    line,
    card,
  ]);
  for (const [i, p] of row.parts.entries()) {
    await q(
      `insert into world_lore.card_draft_parts (line_id, card_id, world_id, position, part_key, body)
       values ($1, $2, $3, $4, $5, $6)`,
      [line, card, worldId, i, p.key, p.body],
    );
  }
  for (const [i, body] of row.secrets.entries()) {
    await q(
      `insert into world_lore.card_draft_secrets (line_id, card_id, world_id, position, body)
       values ($1, $2, $3, $4, $5)`,
      [line, card, worldId, i, body],
    );
  }
}

/** The `meta` key where the importer records the hash of the content it wrote. */
export const IMPORTED = "imported";

/** A card's content as the importer sees it, without its own stamp. */
export interface CardContent {
  title: string;
  body: string;
  meta: Record<string, unknown>;
  parts: Array<[string, string]>;
  secrets: string[];
}

export function contentOf(row: CardRow): CardContent {
  return {
    title: row.title,
    body: row.body,
    meta: withoutStamp(row.meta),
    parts: row.parts.map((p) => [p.key, p.body]),
    secrets: row.secrets,
  };
}

export function withoutStamp(meta: Record<string, unknown>): Record<string, unknown> {
  const { [IMPORTED]: _stamp, ...rest } = meta;
  return rest;
}

/** A hash of a card's content: equal when nothing the importer writes has changed. */
export function contentHash(content: CardContent): string {
  return createHash("sha256").update(stable(content)).digest("hex");
}
