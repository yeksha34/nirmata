import type { Db, Query } from "@nirmata/db";

/** What a token may do (ADR-0035, ADR-0037). All are limited to the one world the token was made for. */
export const AGENT_SCOPES = [
  "adaptation.read",
  "adaptation.write",
  "import.read",
  "import.write",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** Who a presented token speaks for: the author who made it, in the one world it was made for. */
export interface AgentGrant {
  tokenId: string;
  worldId: string;
  /** The author the agent acts as; row level security still decides what they may do. */
  userId: string;
  scopes: AgentScope[];
}

export interface AgentTokenRow {
  id: string;
  label: string;
  scopes: AgentScope[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export const TOKEN_PREFIX = "nga_";

export class AgentTokenError extends Error {}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Agent tokens: an author hands the adaptation agent a revocable credential for one world. The
 * database keeps only a hash; the token is shown once, when it is made. The agent uses the backend's
 * endpoints with it and never reaches the database.
 */
export class AgentTokens {
  constructor(private readonly db: Db) {}

  private async worldId(q: Query, slug: string): Promise<string> {
    const row = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0];
    if (!row) throw new AgentTokenError(`There is no world "${slug}" in the database.`);
    return String(row.id);
  }

  /** Make a token for a world. The returned `token` is the only time it can be read. */
  async create(
    userId: string,
    worldSlug: string,
    label: string,
    options: { scopes?: AgentScope[]; days?: number } = {},
  ): Promise<{ id: string; token: string }> {
    const scopes = options.scopes ?? [...AGENT_SCOPES];
    const days = options.days ?? 30;
    return this.db.asUser(userId, async (q) => {
      const world = await this.worldId(q, worldSlug);
      const out = (
        await q("select identity.create_agent_token($1, $2, $3, make_interval(days => $4)) as made", [
          world,
          label,
          scopes,
          days,
        ])
      ).rows[0]?.made as { id: string; token: string } | undefined;
      if (!out) throw new AgentTokenError("The token could not be made.");
      return { id: String(out.id), token: String(out.token) };
    });
  }

  /** The tokens made for a world (never the tokens themselves). */
  async list(userId: string, worldSlug: string): Promise<AgentTokenRow[]> {
    return this.db.asUser(userId, async (q) => {
      const world = await this.worldId(q, worldSlug);
      const rows = (
        await q(
          `select id, label, scopes, expires_at, revoked_at, last_used_at, created_at
             from identity.agent_tokens where world_id = $1 order by created_at desc`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        id: String(r.id),
        label: String(r.label),
        scopes: r.scopes as AgentScope[],
        expiresAt: String(iso(r.expires_at)),
        revokedAt: iso(r.revoked_at),
        lastUsedAt: iso(r.last_used_at),
        createdAt: String(iso(r.created_at)),
      }));
    });
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      await q("select identity.revoke_agent_token($1)", [id]);
    });
  }

  /** Who a presented token speaks for, or `undefined` for anything that is not a live token. */
  async resolve(token: string): Promise<AgentGrant | undefined> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return undefined;
    const row = await this.db.server(
      async (q) =>
        (await q("select * from identity.resolve_agent_token($1)", [token])).rows[0] as
          | Record<string, unknown>
          | undefined,
    );
    if (!row) return undefined;
    return {
      tokenId: String(row.token_id),
      worldId: String(row.world_id),
      userId: String(row.user_id),
      scopes: row.scopes as AgentScope[],
    };
  }
}
