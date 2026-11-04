import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { bilingual, T } from "../i18n";
import type { AgentToken } from "../types";
import { Panel } from "../ui";

const DAYS = [7, 30, 90];

/**
 * What a token may work on. A lane limits it to some kinds of card, so several agents can import
 * at once without touching each other's cards: one on characters, one on accessories, one on settings.
 */
export const LANES = [
  { id: "all", label: "Everything", kinds: undefined },
  { id: "characters", label: "Characters only", kinds: ["character"] },
  { id: "accessories", label: "Accessories only", kinds: ["clothes", "adornment", "object"] },
  { id: "settings", label: "Settings only", kinds: ["place"] },
  { id: "custom", label: "Other kinds", kinds: undefined },
] as const;

/** The kinds a lane and a typed list give; undefined for any kind. Names that cannot be kinds are left out. */
export function laneKinds(lane: string, typed: string): string[] | undefined {
  if (lane !== "custom") return LANES.find((l) => l.id === lane)?.kinds?.slice();
  const kinds = [
    ...new Set(
      typed
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((k) => /^[a-z][a-z0-9]{0,39}$/.test(k)),
    ),
  ];
  return kinds.length ? kinds : undefined;
}

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
export function AgentAccess({ world, titleId }: { world: string; titleId?: string }) {
  /** undefined while loading; null when the list could not be read. */
  const [tokens, setTokens] = useState<AgentToken[] | null>();
  const [problem, setProblem] = useState<string>();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [lane, setLane] = useState("all");
  const [typed, setTyped] = useState("");
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
      const out = await api.makeAgentToken(world, label.trim(), days, laneKinds(lane, typed));
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
      <Panel title="Agent access" titleId={titleId}>
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
    <Panel title="Agent access" titleId={titleId}>
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
              {bilingual("{n} days", { n: d })}
            </option>
          ))}
        </select>
        <label htmlFor="agent-token-lane">
          <T>Works on</T>
        </label>
        <select id="agent-token-lane" value={lane} onChange={(e) => setLane(e.target.value)}>
          {LANES.map((l) => (
            <option key={l.id} value={l.id}>
              {bilingual(l.label)}
            </option>
          ))}
        </select>
        {lane === "custom" && (
          <>
            <label htmlFor="agent-token-kinds">
              <T>Kinds of card, separated by commas</T>
            </label>
            <input
              id="agent-token-kinds"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              spellCheck={false}
              placeholder="playground, deity"
            />
          </>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            busy ||
            label.trim() === "" ||
            (lane === "custom" && laneKinds(lane, typed) === undefined)
          }
        >
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
              <li key={t.id} data-state={state}>
                <strong>{t.label}</strong>
                <small className="muted">
                  <T>
                    {state === "active" ? "Active" : state === "revoked" ? "Revoked" : "Expired"}
                  </T>
                  {" · "}
                  {t.kinds ? (
                    <T with={{ kinds: t.kinds.join(", ") }}>{"kinds: {kinds}"}</T>
                  ) : (
                    <T>any kind</T>
                  )}
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
