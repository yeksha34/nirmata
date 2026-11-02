/** The few parts of a Postgres client the backend uses. `pg` satisfies them; tests pass a fake. */
export interface QueryResult<R> {
  rows: R[];
}
export interface Client {
  query(text: string, params?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  release(): void;
}
export interface Pool {
  connect(): Promise<Client>;
  end(): Promise<void>;
}

/** Runs one statement inside the current transaction. */
export type Query = <R extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<R>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Work is always a transaction, and always one of two kinds:
 *  - `server`: the backend acting for itself, as the app_rw login with no role set. The database
 *    treats this as the server (`platform.is_server()`), so only call it after the backend has
 *    checked who is asking.
 *  - `asUser`: acting as one signed-in person: role `authenticated` with their id in the JWT
 *    claims, so row level security decides what they may see and do.
 */
export class Db {
  constructor(private readonly pool: Pool) {}

  async server<T>(work: (q: Query) => Promise<T>): Promise<T> {
    return this.transaction(async (q) => work(q));
  }

  /** `who.email` is needed by anything that checks the person's address (accepting an invitation). */
  async asUser<T>(
    userId: string,
    work: (q: Query) => Promise<T>,
    who: { email?: string } = {},
  ): Promise<T> {
    if (!isUuid(userId)) throw new Error("asUser needs a user id (a uuid).");
    return this.transaction(async (q) => {
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({
          sub: userId,
          role: "authenticated",
          ...(who.email ? { email: who.email.toLowerCase() } : {}),
        }),
      ]);
      await q("set local role authenticated");
      return work(q);
    });
  }

  /** Connects and answers; says who the login is and what the server can see. */
  async health(): Promise<{ ok: true; user: string }> {
    const rows = await this.server(async (q) => (await q("select current_user as user")).rows);
    return { ok: true, user: String(rows[0]?.user ?? "") };
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  private async transaction<T>(work: (q: Query) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const q = ((text: string, params?: unknown[]) => client.query(text, params)) as Query;
    try {
      await client.query("begin");
      const result = await work(q);
      await client.query("commit");
      return result;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
