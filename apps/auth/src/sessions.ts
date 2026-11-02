import { randomBytes } from "node:crypto";
import type { AuthSession, GoTrue } from "./gotrue";

/** Refresh a little before the access token runs out. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Each signed-in person's Supabase tokens, kept in the server's memory under a random id. The
 * browser gets only that id (in an httpOnly cookie), never a Supabase token. Restarting the
 * server signs everyone out.
 */
export class SessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  constructor(
    private readonly gotrue: GoTrue,
    private readonly now: () => number = Date.now,
  ) {}

  create(session: AuthSession): string {
    const id = randomBytes(32).toString("base64url");
    this.sessions.set(id, session);
    return id;
  }

  /** The live session for an id, refreshed when it is about to expire; undefined if there is none. */
  async resolve(id: string | undefined): Promise<AuthSession | undefined> {
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt - this.now() > REFRESH_MARGIN_MS) return session;
    try {
      const fresh = await this.gotrue.refresh(session.refreshToken);
      this.sessions.set(id, fresh);
      return fresh;
    } catch {
      this.sessions.delete(id);
      return undefined;
    }
  }

  async end(id: string | undefined): Promise<void> {
    if (!id) return;
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    if (session) await this.gotrue.logout(session.accessToken);
  }

  get size(): number {
    return this.sessions.size;
  }
}
