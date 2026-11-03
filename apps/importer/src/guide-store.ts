import type { Db } from "@nirmata/db";

export class GuideError extends Error {}

export interface SkillSave {
  slug: string;
  title: string;
  description?: string | undefined;
  body: string;
}
export interface RuleSave {
  slug: string;
  title: string;
  body: string;
}
export interface Listed {
  slug: string;
  title: string;
  description?: string;
  size: number;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

function check(slug: string, title: string, body: string): void {
  if (!SLUG.test(slug)) throw new GuideError("A name is lowercase letters, digits and hyphens.");
  if (!title.trim() || title.length > 300) {
    throw new GuideError("A title is one to 300 characters.");
  }
  if (!body.trim()) throw new GuideError("There is no text to save.");
}

/**
 * What an author wrote about a world beyond its cards (ADR-0037): the world's skills, which are guides
 * to writing in it, and the author's rules of writing it. Read and written as the author the agent's
 * token stands for.
 */
export class GuideStore {
  constructor(private readonly db: Db) {}

  private world(q: (sql: string, args?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>) {
    return async (slug: string): Promise<string> => {
      const id = (await q("select id from world_lore.worlds where slug = $1", [slug])).rows[0]?.id;
      if (!id) throw new GuideError(`There is no world "${slug}" in the database.`);
      return String(id);
    };
  }

  async skills(userId: string, worldSlug: string): Promise<Listed[]> {
    return this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      const rows = (
        await q(
          `select slug, title, description, octet_length(body) as size
             from world_lore.world_skills where world_id = $1 order by slug`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        slug: String(r.slug),
        title: String(r.title),
        description: String(r.description),
        size: Number(r.size),
      }));
    });
  }

  async skill(userId: string, worldSlug: string, slug: string) {
    return this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      const r = (
        await q(
          "select slug, title, description, body from world_lore.world_skills where world_id = $1 and slug = $2",
          [world, slug],
        )
      ).rows[0];
      return r
        ? {
            slug: String(r.slug),
            title: String(r.title),
            description: String(r.description),
            body: String(r.body),
          }
        : undefined;
    });
  }

  async saveSkill(userId: string, worldSlug: string, input: SkillSave): Promise<void> {
    check(input.slug, input.title, input.body);
    await this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      await q("select world_lore.save_world_skill($1, $2, $3, $4, $5)", [
        world,
        input.slug,
        input.title.trim(),
        input.description ?? "",
        input.body,
      ]);
    });
  }

  async removeSkill(userId: string, worldSlug: string, slug: string): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      await q("select world_lore.remove_world_skill($1, $2)", [world, slug]);
    });
  }

  async rules(userId: string, worldSlug: string): Promise<Listed[]> {
    return this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      const rows = (
        await q(
          `select slug, title, octet_length(body) as size
             from world_lore.author_rules where world_id = $1 order by slug`,
          [world],
        )
      ).rows;
      return rows.map((r) => ({
        slug: String(r.slug),
        title: String(r.title),
        size: Number(r.size),
      }));
    });
  }

  async rule(userId: string, worldSlug: string, slug: string) {
    return this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      const r = (
        await q(
          "select slug, title, body from world_lore.author_rules where world_id = $1 and slug = $2",
          [world, slug],
        )
      ).rows[0];
      return r
        ? { slug: String(r.slug), title: String(r.title), body: String(r.body) }
        : undefined;
    });
  }

  async saveRule(userId: string, worldSlug: string, input: RuleSave): Promise<void> {
    check(input.slug, input.title, input.body);
    await this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      await q("select world_lore.save_author_rule($1, $2, $3, $4)", [
        world,
        input.slug,
        input.title.trim(),
        input.body,
      ]);
    });
  }

  async removeRule(userId: string, worldSlug: string, slug: string): Promise<void> {
    await this.db.asUser(userId, async (q) => {
      const world = await this.world(q)(worldSlug);
      await q("select world_lore.remove_author_rule($1, $2)", [world, slug]);
    });
  }
}
