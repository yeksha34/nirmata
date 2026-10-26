import { type FormEvent, useState } from "react";
import { api } from "../api";
import { T } from "../i18n";
import type { TableInfo } from "../types";
import { Brand } from "../ui";

/** The first thing anyone sees: pick a name and come in. No accounts. */
export function Join({
  info,
  problem,
  onJoined,
}: {
  info: TableInfo | undefined;
  problem: string | undefined;
  onJoined: (token: string) => void;
}) {
  const [nick, setNick] = useState("");
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const needsAdult = info?.requiresAdultConfirmation === true;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const joined = await api.join({ nick: nick.trim(), confirmedAdult: adult || undefined });
      onJoined(joined.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="join">
      <form className="join-card" onSubmit={submit}>
        <Brand />
        <h1>{info?.world ? info.world.title : <T>Join the table</T>}</h1>
        {info?.world?.tagline && <p className="tagline">{info.world.tagline}</p>}
        <p className="muted">
          {info?.host ? (
            <T with={{ host: info.host }}>
              {
                "{host} is hosting. Pick a name to come in; you can watch first and join in whenever you like."
              }
            </T>
          ) : (
            <T>Pick a name to come in.</T>
          )}
        </p>

        <label htmlFor="nick">
          <T>Your name</T>
        </label>
        <input
          id="nick"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          autoComplete="nickname"
          maxLength={24}
          spellCheck={false}
          // biome-ignore lint/a11y/noAutofocus: this is the only thing on the page
          autoFocus
          required
        />
        <p className="hint">
          <T>Up to 24 letters or digits, no spaces.</T>
        </p>

        {needsAdult && (
          <label className="check">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>
              <T>I am an adult (18 or older). This story is for adult readers.</T>
            </span>
          </label>
        )}

        {(error ?? problem) && (
          <p className="error" role="alert">
            {error ?? problem}
          </p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={busy || !nick.trim() || (needsAdult && !adult)}
        >
          <T>{busy ? "Coming in…" : "Come in"}</T>
        </button>
        <p className="hint">
          <T>
            Running the server? Open the link it printed in your terminal to take the host's seat.
          </T>
        </p>
      </form>
    </div>
  );
}
