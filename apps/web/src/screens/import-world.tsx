import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { bilingual, T } from "../i18n";
import { DEFAULT_EXPECTATIONS, importPrompt, tokenBlock } from "../import-prompt";
import type { ImportedWorld } from "../types";
import { Modal } from "../ui";

const DAYS = [7, 30, 90];

/** Kind names typed by the author: lowercase letters and digits, no repeats. */
export function parseKinds(typed: string): string[] {
  return [
    ...new Set(
      typed
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((k) => /^[a-z][a-z0-9]{0,39}$/.test(k)),
    ),
  ];
}

/** A block of text the author copies whole. */
function Copyable({
  id,
  label,
  text,
  rows,
  nowrap,
}: {
  id: string;
  label: string;
  text: string;
  rows: number;
  nowrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // the text stays selectable in its box
    }
  };
  return (
    <>
      <label htmlFor={id}>
        <T>{label}</T>
      </label>
      <textarea
        id={id}
        readOnly
        rows={rows}
        wrap={nowrap ? "off" : "soft"}
        value={text}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" onClick={copy}>
        <T>{copied ? "Copied" : "Copy"}</T>
      </button>
    </>
  );
}

/**
 * Import a world. Importing is how a world is made, so nothing has to exist first: the author names
 * the world, and the app makes it with a token for each worker (one for everything, and one each for
 * characters, accessories and settings). The tokens and the prompt for the agent are shown once.
 */
export function ImportWorld({
  onClose,
  onOpen,
  onMade,
}: {
  onClose: () => void;
  onOpen: (name: string) => void;
  /** The world now exists: the list of worlds behind this dialog should be read again. */
  onMade?: () => void;
}) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [settings, setSettings] = useState("place");
  const [days, setDays] = useState(30);
  const [made, setMade] = useState<ImportedWorld>();
  const [expectations, setExpectations] = useState(DEFAULT_EXPECTATIONS);

  const kinds = parseKinds(settings);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await act(() =>
      api.importWorld({ title: title.trim(), tagline: tagline.trim(), settingsKinds: kinds, days }),
    );
    if (out) {
      setMade(out);
      onMade?.();
    }
  };

  if (made) {
    const prompt = importPrompt({
      server: window.location.origin,
      world: made.world.name,
      settingsKinds: kinds,
      expectations,
    });
    return (
      <Modal titleId="import-world-title" onClose={onClose} wide>
        <section className="import-made">
          <h2 id="import-world-title">
            <T with={{ title: made.world.title }}>{"Ready to import into {title}"}</T>
          </h2>
          <p className="hint">
            <T>
              Copy the tokens and the prompt now: the tokens will not be shown again. Set the tokens
              as environment variables in the terminal where the agent runs.
            </T>
          </p>
          <Copyable
            id="import-tokens"
            label="Tokens"
            text={tokenBlock(made.tokens)}
            rows={4}
            nowrap
          />
          <label htmlFor="import-expectations">
            <T>What you expect of the import (edit it)</T>
          </label>
          <textarea
            id="import-expectations"
            rows={8}
            value={expectations}
            onChange={(e) => setExpectations(e.target.value)}
          />
          <Copyable id="import-prompt" label="Prompt for the agent" text={prompt} rows={10} />
          <p className="hint">
            <T>
              In the prompt, fill in the three places in angle brackets: the source folder, the
              folder the agent works in, and the Nirmata repository.
            </T>
          </p>
          <footer className="dialog-actions">
            <button type="button" onClick={onClose}>
              <T>Done</T>
            </button>
            <button type="button" className="primary" onClick={() => onOpen(made.world.name)}>
              <T>Open the world</T>
            </button>
          </footer>
        </section>
      </Modal>
    );
  }

  return (
    <Modal titleId="import-world-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id="import-world-title">
          <T>Import a world</T>
        </h2>
        <p className="hint">
          <T>
            Name the world. It is made now, empty, with a token for each agent that will fill it
            from your files.
          </T>
        </p>
        <label htmlFor="iw-title">
          <T>Title</T>
        </label>
        <input
          id="iw-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="iw-tagline">
          <T>A line about it (optional)</T>
        </label>
        <input
          id="iw-tagline"
          value={tagline}
          maxLength={200}
          onChange={(e) => setTagline(e.target.value)}
        />
        <label htmlFor="iw-settings">
          <T>Kinds of card the settings worker may write, separated by commas</T>
        </label>
        <input
          id="iw-settings"
          value={settings}
          onChange={(e) => setSettings(e.target.value)}
          spellCheck={false}
        />
        <label htmlFor="iw-days">
          <T>The tokens last</T>
        </label>
        <select id="iw-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {bilingual("{n} days", { n: d })}
            </option>
          ))}
        </select>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !title.trim() || kinds.length === 0}
          >
            <T>Make the world and its tokens</T>
          </button>
        </footer>
      </form>
    </Modal>
  );
}
