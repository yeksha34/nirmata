import type { Db } from "@nirmata/db";
import { ASSET_KINDS, type AssetKind } from "@nirmata/gen";
import { PrepError } from "./character-prep";
import { worldIdOf } from "./prep-store";

/** A refusal the caller can read: a graph that is not a workflow, or one the database will not accept. */
export class TemplateError extends Error {}

/** The most a workflow graph may weigh; the database's own limit for the kind. */
const MAX_BYTES = 262144;

/** The template kind of an asset kind: `workflow_sprite`, `workflow_bg`, … */
export const templateKindOf = (type: AssetKind): string => `workflow_${type}`;

export type TemplateScope = "platform" | "world" | "vn";

/** Which workflow a world or visual novel resolves to for one kind of asset. */
export interface TemplateInfo {
  type: AssetKind;
  versionId: string;
  /** Where the answer came from: the platform default, the world's own copy, or the visual novel's pin. */
  scope: TemplateScope;
  checksum: string;
}

export interface ResolvedTemplate extends TemplateInfo {
  graph: Record<string, unknown>;
}

/** What `loadWorkflowTemplate` asks for: the graph a world uses, if the database has one of its own. */
export interface WorkflowSource {
  find(
    worldSlug: string,
    type: AssetKind,
  ): Promise<{ scope: TemplateScope; graph: Record<string, unknown> } | undefined>;
}

/** The checks that need no database: a ComfyUI API graph is an object of nodes with a class and inputs. */
export function parseGraph(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TemplateError("A workflow is an object of nodes.");
  }
  const nodes = Object.entries(input);
  if (nodes.length === 0) throw new TemplateError("A workflow needs at least one node.");
  for (const [id, node] of nodes) {
    const n = node as { class_type?: unknown; inputs?: unknown };
    if (typeof node !== "object" || node === null || typeof n.class_type !== "string") {
      throw new TemplateError(`Node ${id} needs a class_type.`);
    }
    if (typeof n.inputs !== "object" || n.inputs === null || Array.isArray(n.inputs)) {
      throw new TemplateError(`Node ${id} needs inputs.`);
    }
  }
  if (JSON.stringify(input).length > MAX_BYTES) throw new TemplateError("That workflow is too large.");
  return input as Record<string, unknown>;
}

export function parseKind(input: unknown): AssetKind {
  if ((ASSET_KINDS as readonly unknown[]).includes(input)) return input as AssetKind;
  throw new TemplateError("That is not a kind of asset.");
}

/**
 * Workflow templates, kept in the database (ADR-0035). The platform ships a default for each kind;
 * a world may hold its own copy (`override`), and a visual novel keeps the version it was pinned to.
 * Read and written as the author the agent acts for, so only an author of the world gets through.
 */
export class TemplateStore {
  constructor(private readonly db: Db) {}

  /** The workflow each kind resolves to, with where it came from. */
  async list(userId: string, worldSlug: string, vnId?: string): Promise<TemplateInfo[]> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const out: TemplateInfo[] = [];
      for (const type of ASSET_KINDS) {
        const row = (
          await q("select * from platform.effective_template($1, $2, $3)", [
            world,
            vnId ?? null,
            templateKindOf(type),
          ])
        ).rows[0];
        if (row) out.push(infoOf(type, row));
      }
      return out;
    });
  }

  /** One kind's workflow with its graph, or nothing if the database has none. */
  async get(
    userId: string,
    worldSlug: string,
    type: AssetKind,
    vnId?: string,
  ): Promise<ResolvedTemplate | undefined> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const row = (
        await q("select * from platform.effective_template($1, $2, $3)", [
          world,
          vnId ?? null,
          templateKindOf(type),
        ])
      ).rows[0];
      return row ? { ...infoOf(type, row), graph: row.body as Record<string, unknown> } : undefined;
    });
  }

  /** The world takes its own copy of the platform default as it is now. Returns the version. */
  async adopt(userId: string, worldSlug: string, type: AssetKind): Promise<string> {
    return this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      const row = (
        await q("select platform.upgrade_world_template($1, $2) as id", [world, templateKindOf(type)])
      ).rows[0];
      return String(row?.id);
    });
  }

  /**
   * Publish the world's own workflow for a kind (or a visual novel's, with `vnId`). The first time it
   * starts from what the scope resolves to now; after that it edits the same template, so each call
   * adds one version. The database refuses nodes outside its allow-list and any address or file path.
   */
  async override(
    userId: string,
    worldSlug: string,
    type: AssetKind,
    graph: Record<string, unknown>,
    options: { note?: string | undefined; vnId?: string | undefined } = {},
  ): Promise<string> {
    const kind = templateKindOf(type);
    try {
      return await this.db.asUser(userId, async (q) => {
        const world = await worldIdOf(q, worldSlug);
        const scope = options.vnId ? "vn" : "world";
        const scopeId = options.vnId ?? world;
        const found = (
          await q(
            `select id from platform.templates where kind_key = $1 and scope_type = $2 and scope_id = $3`,
            [kind, scope, scopeId],
          )
        ).rows[0];
        const id = found
          ? String(found.id)
          : String(
              (
                await q("select platform.create_template_override($1, $2, $3) as id", [
                  kind,
                  world,
                  options.vnId ?? null,
                ])
              ).rows[0]?.id,
            );
        await q(
          "update platform.template_drafts set body = $1::jsonb where template_id = $2",
          [JSON.stringify(graph), id],
        );
        await q("select platform.set_template_ready($1, true)", [id]);
        const made = (await q("select platform.publish_template($1, $2) as id", [id, options.note ?? null]))
          .rows[0];
        return String(made?.id);
      });
    } catch (e) {
      // the database's own refusals (a node outside the allow-list, an address in the graph) read as they are
      if ((e as { code?: string }).code === "22023") throw new TemplateError((e as Error).message);
      throw e;
    }
  }

  /** The world goes back to the platform default. Its own versions stay as history. */
  async reset(userId: string, worldSlug: string, type: AssetKind): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      const world = await worldIdOf(q, worldSlug);
      await q("select platform.reset_world_template($1, $2)", [world, templateKindOf(type)]);
    });
  }

  /** What `loadWorkflowTemplate` uses for an imported world: the graph, if the database has one. */
  source(userOf: () => string | undefined): WorkflowSource {
    return {
      find: async (worldSlug, type) => {
        const user = userOf();
        if (!user) return undefined;
        try {
          const found = await this.get(user, worldSlug, type);
          return found ? { scope: found.scope, graph: found.graph } : undefined;
        } catch (e) {
          if (e instanceof PrepError) return undefined; // the world is not in the database: its files decide
          throw e; // a database that fails is not hidden by the files
        }
      },
    };
  }
}

function infoOf(type: AssetKind, row: Record<string, unknown>): TemplateInfo {
  return {
    type,
    versionId: String(row.template_version_id),
    scope: row.resolved_scope as TemplateScope,
    checksum: String(row.checksum),
  };
}
