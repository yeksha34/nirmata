export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, in milliseconds since the epoch. */
  expiresAt: number;
  user: AuthUser;
}

export type AuthFailure =
  | "bad_credentials"
  | "invitation_required"
  | "exists"
  | "rejected"
  | "unavailable";

/** Why a call to Supabase Auth failed, in terms the server can turn into a plain message. */
export class AuthError extends Error {
  constructor(
    readonly failure: AuthFailure,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface GoTrueOptions {
  /** The project address, e.g. https://<ref>.supabase.co */
  url: string;
  /** The publishable (anon) key. It is sent with every call; it grants nothing by itself. */
  publishableKey: string;
  /** The service role key, for creating accounts directly. Server side only; it bypasses every access rule. */
  serviceRoleKey?: string | undefined;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  now?: () => number;
}

export type VerifyType = "signup" | "invite" | "recovery" | "magiclink" | "email";

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
  msg?: string;
  message?: string;
  error_description?: string;
  error_code?: string;
  code?: string | number;
}

/** A small client for Supabase Auth (GoTrue), used by the server only. */
export class GoTrue {
  private readonly base: string;
  private readonly key: string;
  private readonly serviceKey: string | undefined;
  private readonly http: typeof fetch;
  private readonly now: () => number;

  constructor(options: GoTrueOptions) {
    this.base = `${options.url.replace(/\/+$/, "")}/auth/v1`;
    this.key = options.publishableKey;
    this.serviceKey = options.serviceRoleKey;
    this.http = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const body = await this.call("/token?grant_type=password", { email, password });
    return this.toSession(body);
  }

  /**
   * Makes the account. With "Confirm email" on, Supabase sends a link and returns no session
   * (undefined); the person finishes at the link. The invitation check runs inside Supabase.
   */
  async signup(email: string, password: string, redirectTo: string): Promise<AuthSession | undefined> {
    const body = await this.call(`/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      email,
      password,
    });
    return body.access_token ? this.toSession(body) : undefined;
  }

  /**
   * Creates an account that is already confirmed, with no email sent (needs the service role key).
   * The caller must have checked the person is allowed one (they hold a valid invitation).
   */
  async createUser(email: string, password: string): Promise<void> {
    if (!this.serviceKey) throw new AuthError("unavailable", "No service role key is set.");
    await this.call(
      "/admin/users",
      { email, password, email_confirm: true },
      { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}` },
    );
  }

  /** Turns the `token_hash` from an email link into a session. */
  async verify(tokenHash: string, type: VerifyType): Promise<AuthSession> {
    return this.toSession(await this.call("/verify", { token_hash: tokenHash, type }));
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    return this.toSession(await this.call("/token?grant_type=refresh_token", { refresh_token: refreshToken }));
  }

  /** Ends the session at Supabase. Failing to is not worth telling the person. */
  async logout(accessToken: string): Promise<void> {
    try {
      await this.http(`${this.base}/logout`, {
        method: "POST",
        headers: { apikey: this.key, Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // the server session is dropped either way
    }
  }

  private async call(
    path: string,
    payload: Record<string, unknown>,
    headers: Record<string, string> = { apikey: this.key },
  ): Promise<TokenBody> {
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AuthError("unavailable", "Could not reach Supabase Auth.");
    }
    const body = (await res.json().catch(() => ({}))) as TokenBody;
    if (res.ok) return body;
    const text = `${body.msg ?? body.message ?? body.error_description ?? ""} ${body.error_code ?? body.code ?? ""}`;
    if (res.status >= 500) throw new AuthError("unavailable", "Supabase Auth failed.");
    if (/already (been )?registered|email_exists|user_already_exists/i.test(text)) {
      throw new AuthError("exists", "That address already has an account.");
    }
    if (/invitation is required/i.test(text)) throw new AuthError("invitation_required", "An invitation is required.");
    if (res.status === 400 && /invalid login|invalid_credentials/i.test(text)) {
      throw new AuthError("bad_credentials", "Wrong email or password.");
    }
    if (res.status === 401 || /invalid_credentials|invalid login/i.test(text)) {
      throw new AuthError("bad_credentials", "Wrong email or password.");
    }
    throw new AuthError("rejected", "Supabase Auth refused the request.");
  }

  private toSession(body: TokenBody): AuthSession {
    const user = body.user;
    if (!body.access_token || !body.refresh_token || !user?.id) {
      throw new AuthError("rejected", "Supabase Auth returned no session.");
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
      user: { id: user.id, email: (user.email ?? "").toLowerCase() },
    };
  }
}
