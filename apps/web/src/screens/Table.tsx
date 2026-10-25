import { type FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { MODE_HINT, MODE_LABEL, worldName } from "../format";
import { visibleTurns } from "../store";
import type { Mode, TurnView } from "../types";
import { BoardPanel, People } from "./Board";

/** The story itself, the shared board beside it, and the way to write your own turn. */
export function TableScreen() {
  return (
    <div className="table">
      <div className="story-col">
        <StoryPane />
        <Composer />
      </div>
      <aside className="side-col">
        <BoardPanel />
        <People />
      </aside>
    </div>
  );
}

function StoryPane() {
  const { state } = useApp();
  const turns = visibleTurns(state);
  const story = state.story;
  const endRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  // follow the story as it is written, unless the reader has scrolled up to re-read
  useEffect(() => {
    const onScroll = () => {
      const gap = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      stuck.current = gap < 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the story grows
  useEffect(() => {
    if (stuck.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, state.streaming]);

  if (!story) return null;
  const groups = groupTurns(turns);

  return (
    <section className="story" aria-label="The story">
      <StoryBar />
      {state.warnings.length > 0 && state.you?.host && (
        <ul className="warnings" aria-label="Worth a look">
          {state.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {groups.length === 0 && state.streaming === null && (
        <p className="empty">The story is about to begin…</p>
      )}
      {groups.map((g) =>
        g.kind === "host" ? (
          <HostText key={g.turns[0]?.id} text={g.turns[0]?.text ?? ""} />
        ) : (
          <PlayerLines key={g.turns[0]?.id} turns={g.turns} />
        ),
      )}
      {state.streaming !== null && (
        <div className="host-text streaming" aria-live="polite" aria-busy="true">
          {state.streaming ? (
            <Prose text={state.streaming} />
          ) : (
            <p className="muted">The story is writing…</p>
          )}
          <span className="caret" aria-hidden="true" />
        </div>
      )}
      <div ref={endRef} />
    </section>
  );
}

type Group = { kind: "host" | "players"; turns: TurnView[] };

/** Consecutive lines written together (one round) read as one block. */
function groupTurns(turns: TurnView[]): Group[] {
  const out: Group[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (t.role === "host") out.push({ kind: "host", turns: [t] });
    else if (last?.kind === "players") last.turns.push(t);
    else out.push({ kind: "players", turns: [t] });
  }
  return out;
}

function Prose({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          // paragraphs never reorder, so the position is a fine key
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <p key={i}>{p.trim()}</p>
        ))}
    </>
  );
}

function HostText({ text }: { text: string }) {
  return (
    <div className="host-text">
      <Prose text={text} />
    </div>
  );
}

function PlayerLines({ turns }: { turns: TurnView[] }) {
  return (
    <blockquote className="player-lines">
      {turns.map((t) => (
        <p key={t.id}>
          {t.by && <strong>{t.by} </strong>}
          <span className="chip">{MODE_LABEL[t.mode ?? "do"]}</span> {t.text}
        </p>
      ))}
    </blockquote>
  );
}

function StoryBar() {
  const { state } = useApp();
  const { act, busy } = useAct();
  const [saving, setSaving] = useState(false);
  const story = state.story;
  const me = state.you;
  const writing = state.streaming !== null || story?.busy === true || state.board?.busy === true;
  const canAct = me !== undefined && me.seat !== "spectator" && !me.muted;
  const host = me?.host === true;
  const chapters = story?.chapters ?? [];

  return (
    <div className="story-bar">
      <div className="story-bar-left">
        <span className="saved" title={`Saved automatically as ${story?.id ?? ""}`}>
          ● Saved
        </span>
        {chapters.length > 0 && (
          <span className="muted" title={chapters.map((c) => c.title).join(", ")}>
            {chapters.length} {chapters.length === 1 ? "chapter" : "chapters"} written
          </span>
        )}
      </div>
      <div className="story-bar-actions">
        {writing ? (
          canAct && (
            <button type="button" onClick={() => act(api.stop)}>
              Stop
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              disabled={!canAct || busy}
              onClick={() => act(api.retry)}
              title="Write a different reply"
            >
              Try again
            </button>
            <button
              type="button"
              disabled={!canAct || busy}
              onClick={() => act(api.continueStory)}
              title="Let the story go on"
            >
              Keep going
            </button>
            <button
              type="button"
              disabled={!canAct || busy}
              onClick={() =>
                act(async () => {
                  const r = await api.undo();
                  if (!r.undone) throw new Error("There is nothing to undo yet.");
                })
              }
              title="Take back the last turn"
            >
              Undo
            </button>
          </>
        )}
        {host && (
          <details className="menu menu-right">
            <summary>More</summary>
            <div className="menu-body">
              <button type="button" onClick={() => setSaving(true)}>
                Save as a new world…
              </button>
              <button
                type="button"
                disabled={writing}
                onClick={() => {
                  const title = window.prompt("Name the next chapter (or leave blank):", "");
                  if (title !== null)
                    void act(
                      () => api.breakChapter(title.trim() || undefined),
                      "A new chapter begins.",
                    );
                }}
              >
                Start a new chapter…
              </button>
              <button
                type="button"
                disabled={writing}
                onClick={() => act(api.extractPlot, "Looking for plot points…")}
              >
                Update plot points
              </button>
              <button type="button" disabled={writing} onClick={() => act(api.closeStory)}>
                Put the story away
              </button>
            </div>
          </details>
        )}
      </div>
      {saving && <SaveWorld onClose={() => setSaving(false)} />}
    </div>
  );
}

function SaveWorld({ onClose }: { onClose: () => void }) {
  const { state } = useApp();
  const { act, busy } = useAct();
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(`${state.world?.title ?? "My world"} (continued)`);
  const [name, setName] = useState(() =>
    worldName(`${state.world?.title ?? "My world"} continued`),
  );
  const [edited, setEdited] = useState(false);
  const [saved, setSaved] = useState<{ name: string; cards: number; chapters: number }>();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const result = await act(() => api.saveAsWorld({ name, title: title.trim() }));
    if (result) setSaved(result);
  };

  const openIt = async () => {
    if (!saved) return;
    const done = await act(async () => {
      await api.closeStory();
      return api.openWorld(saved.name);
    });
    if (done) onClose();
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="save-title">
      {saved ? (
        <div>
          <h2 id="save-title">Saved</h2>
          <p>
            “{title.trim()}” is in your library, with {saved.cards} cards
            {saved.chapters > 0
              ? ` and ${saved.chapters} ${saved.chapters === 1 ? "chapter" : "chapters"}`
              : ""}
            . Everything that happened in this story is now part of that world. The original is
            untouched.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Keep playing here
            </button>
            <button type="button" className="primary" disabled={busy} onClick={openIt}>
              Open it now
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 id="save-title">Save as a new world</h2>
          <p className="muted">
            Keeps this story's cards, with everything that has happened written into them, and its
            chapters. New stories you start there begin from here.
          </p>
          <label htmlFor="world-title">Title</label>
          <input
            id="world-title"
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!edited) setName(worldName(e.target.value));
            }}
            required
          />
          <label htmlFor="world-name">Folder name</label>
          <input
            id="world-name"
            value={name}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9\-]{1,39}"
            onChange={(e) => {
              setEdited(true);
              setName(e.target.value);
            }}
            required
          />
          <p className="hint">Lowercase letters, digits and hyphens.</p>
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !title.trim() || !name}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

const MODES: Mode[] = ["do", "say", "story"];

/** Your own line on the board. It is shared as you type; nothing goes to the story until everyone is ready. */
function Composer() {
  const { state, dispatch } = useApp();
  const { act } = useAct();
  const me = state.you;
  const board = state.board;
  const mine = board?.drafts.find((d) => d.nick.toLowerCase() === me?.nick.toLowerCase());
  const [mode, setMode] = useState<Mode>("do");
  const [text, setText] = useState("");
  const sent = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // the table took the round: clear the box for the next one
  useEffect(() => {
    if (!mine && sent.current) {
      sent.current = false;
      setText("");
    }
  }, [mine]);
  // come back to a half-written turn after a reconnect
  useEffect(() => {
    if (mine && !text && !sent.current) {
      setText(mine.text);
      setMode(mine.mode);
      sent.current = true;
    }
  }, [mine, text]);

  if (!me) return null;
  if (me.seat === "spectator") {
    return (
      <div className="composer watching">
        <p>You're watching. Join in whenever you like.</p>
        <button
          type="button"
          className="primary"
          onClick={() =>
            act(async () => {
              const r = await api.play();
              dispatch({ type: "you", you: r.you });
            })
          }
        >
          Join in
        </button>
      </div>
    );
  }
  if (me.muted) {
    return (
      <div className="composer watching">
        <p>You're hushed for now: you can read, but not write.</p>
      </div>
    );
  }

  const push = (nextMode: Mode, nextText: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      sent.current = nextText.trim().length > 0;
      void act(() => api.setDraft(nextMode, nextText));
    }, 250);
  };
  const edit = (nextText: string) => {
    setText(nextText);
    push(mode, nextText);
  };
  const pick = (next: Mode) => {
    setMode(next);
    if (text.trim()) push(next, text);
  };
  const ready = () =>
    act(async () => {
      window.clearTimeout(timer.current);
      await api.setDraft(mode, text);
      sent.current = true;
      await api.ready();
    });

  const isReady = mine?.ready === true;
  const writing = board?.busy === true;
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (isReady) void act(api.unready);
        else if (text.trim()) void ready();
      }}
    >
      <fieldset className="modes">
        <legend className="sr-only">What kind of turn</legend>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={mode === m ? "is-on" : ""}
            title={MODE_HINT[m]}
            onClick={() => pick(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
        <span className="hint">{MODE_HINT[mode]}</span>
      </fieldset>
      <textarea
        value={text}
        onChange={(e) => edit(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={mode === "say" ? "“…”" : mode === "story" ? "The story should…" : "I…"}
        aria-label="Your turn"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !isReady) {
            e.preventDefault();
            void ready();
          }
        }}
      />
      <div className="composer-actions">
        <span className="hint">
          {writing
            ? "You can write ahead while the story is writing."
            : isReady
              ? "Ready. Waiting for the others, or change your turn."
              : "Others see this as you write. Ready sends it when everyone is ready."}
        </span>
        <button
          type="submit"
          className={isReady ? "" : "primary"}
          disabled={!isReady && !text.trim()}
        >
          {isReady ? "Not ready" : "Ready"}
        </button>
      </div>
    </form>
  );
}
