import { Db, type Pool } from "./db";

/**
 * The database the backend connects to. `DATABASE_URL_RW` is the app_rw login (the pooler address).
 * Returns undefined when it is not set, so the rest of the server still runs without a database.
 */
export function dbUrlFromEnv(env: Record<string, string | undefined>): string | undefined {
  const url = env.DATABASE_URL_RW?.trim();
  return url ? url : undefined;
}

interface PgModule {
  Pool: new (options: Record<string, unknown>) => Pool;
}

/** Opens a pool with the `pg` package (installed with the workspace). */
export async function createPool(url: string): Promise<Pool> {
  const name = "pg"; // a variable, so the type checker does not need the package's types
  const loaded = (await import(name)) as { default?: PgModule } & Partial<PgModule>;
  const pg = loaded.default ?? (loaded as PgModule);
  return new pg.Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
}

export async function connectDb(env: Record<string, string | undefined>): Promise<Db | undefined> {
  const url = dbUrlFromEnv(env);
  return url ? new Db(await createPool(url)) : undefined;
}
