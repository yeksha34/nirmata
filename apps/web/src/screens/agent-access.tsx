import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { T } from "../i18n";
import type { AgentToken } from "../types";
import { Panel } from "../ui";

const DAYS = [7, 30, 90];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** One token's standing: revoked, past its end, or still good. */
export function standing(t: AgentToken, now = Date.now()): "revoked" | "expired" | "active" {
  if (t.revokedAt) return "revoked";
  return Date.parse(t.expiresAt) <= now ? "expired" : "active";
}

/**
 * Agent access: an author makes a token for the adaptation agent. It works for this one world and
 * only for reading and writing its adaptation data. It is shown once, when it is made; revoking it
 * stops it at once.
 */
export function AgentAccess({ world }: { world: string }) {
  /** undefined while loading; null when the list could not be read. */
  const [tokens, setTokens] = useState<AgentToken[] | null>();
  const [problem, setProblem] = useState<string>();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [made, setMade] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens(await api.agentTokens(world));
    } catch (e) {
      setProblem((e as Error).message);
      setTokens(null);
    }
  }, [world]);
  useEffect(() => {
    void load();
  }, [load]);

  const make = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      const out = await api.makeAgentToken(world, label.trim(), days);
      setMade(out.token);
      setCopied(false);
      setLabel("");
      await load();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await api.revokeAgentToken(world, id);
      await load();
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(made ?? "");
      setCopied(true);
    } catch {
      setCopied(false); // the token stays selectable in its box
    }
  };

  if (tokens === undefined) return null;
  if (tokens === null) {
    return (
      <Panel title="Agent access">
        <p className="hint">
          <T>Agent access needs the database and an author who is signed in.</T>
        </p>
        {problem && (
          <p className="error" role="alert">
            <T>{problem}</T>
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Agent access">
      <p className="hint">
        <T with={{ root: <code>{`${window.location.origin}/api/agent/`}</code> }}>
          {
            "A token lets an agent import into this world and adapt it, at {root}, and nothing else. It is shown once. Revoke it to stop it."
          }
        </T>
      </p>

      {made && (
        <output className="token-made">
          <label htmlFor="agent-token-made">
            <T>Your new token. Copy it now: it will not be shown again.</T>
          </label>
          <input
            id="agent-token-made"
            readOnly
            value={made}
            onFocus={(e) => e.currentTarget.select()}
            spellCheck={false}
          />
          <button type="button" onClick={copy}>
            <T>{copied ? "Copied" : "Copy"}</T>
          </button>
          <button type="button" className="plain" onClick={() => setMade(undefined)}>
            <T>Done</T>
          </button>
        </output>
      )}

      <form className="token-form" onSubmit={make}>
        <label htmlFor="agent-token-label">
          <T>What it is for</T>
        </label>
        <input
          id="agent-token-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          required
        />
        <label htmlFor="agent-token-days">
          <T>Lasts</T>
        </label>
        <select
          id="agent-token-days"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              <T with={{ n: d }}>{"{n} days"}</T>
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={busy || label.trim() === ""}>
          <T>Make a token</T>
        </button>
      </form>

      {problem && (
        <p className="error" role="alert">
          <T>{problem}</T>
        </p>
      )}

      {tokens.length === 0 ? (
        <p className="hint">
          <T>No tokens yet.</T>
        </p>
      ) : (
        <ul className="tokens">
          {tokens.map((t) => {
            const state = standing(t);
            return (
              <li key={t.id}>
                <strong>{t.label}</strong>{" "}
                <small className="muted">
                  <T>
                    {state === "active" ? "Active" : state === "revoked" ? "Revoked" : "Expired"}
                  </T>
                  {" · "}
                  <T with={{ date: day(t.expiresAt) }}>{"until {date}"}</T>
                  {" · "}
                  {t.lastUsedAt ? (
                    <T with={{ date: day(t.lastUsedAt) }}>{"last used {date}"}</T>
                  ) : (
                    <T>never used</T>
                  )}
                </small>
                {state === "active" && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => revoke(t.id)}
                  >
                    <T>Revoke</T>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
