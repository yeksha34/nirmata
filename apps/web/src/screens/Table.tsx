import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { Field, Tip, useAsk } from "../controls";
import { MODE_HINT, MODE_LABEL, worldName } from "../format";
import { T } from "../i18n";
import { type Book, bookFromStory } from "../reader/book";
import { Reader } from "../reader/Reader";
import { visibleTurns } from "../store";
import type { Mode, TurnView } from "../types";
import { BoardPanel, People } from "./Board";

/** The story itself, the shared board beside it, and the way to write your own turn. */
export function TableScreen() {
  return (
    <article className="table">
      <StoryPane>
        <Composer />
      </StoryPane>
      <aside className="side-col">
        <BoardPanel />
        <People />
      </aside>
    </article>
  );
}

/** The story as written so far; its children (the composer) stay at its foot. */
function StoryPane({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const turns = visibleTurns(state);
  const story = state.story;
  const endRef = useRef<HTMLElement>(null);
  const stuck = useRef(true);

  // follow the story as it is written, unless the reader has scrolled up to re-read; what
  // scrolls is the story window's body
  useEffect(() => {
    const scroller = endRef.current?.closest(".win-body");
    if (!scroller) return;
    const onScroll = () => {
      stuck.current = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 160;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the story grows
  useEffect(() => {
    const scroller = endRef.current?.closest(".win-body");
    if (stuck.current && scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [turns.length, state.streaming]);

  if (!story) return null;
  const groups = groupTurns(turns);

  return (
    <section ref={endRef} className="story" aria-label="The story">
      <StoryBar />
      {state.warnings.length > 0 && state.you?.host && (
        <ul className="warnings" aria-label="Worth a look">
          {state.warnings.map((w) => (
            <li key={w}>
              <T>{w}</T>
            </li>
          ))}
        </ul>
      )}
      {groups.length === 0 && state.streaming === null && (
        <p className="empty">
          <T>The story is about to begin…</T>
        </p>
      )}
      {groups.map((g) =>
        g.kind === "host" ? (
          <HostText key={g.turns[0]?.id} text={g.turns[0]?.text ?? ""} />
        ) : (
          <PlayerLines key={g.turns[0]?.id} turns={g.turns} />
        ),
      )}
      {state.streaming !== null && (
        <article className="host-text streaming" aria-live="polite" aria-busy="true">
          {state.streaming ? (
            <Prose text={state.streaming} />
          ) : (
            <p className="muted">
              <T>The story is writing…</T>
            </p>
          )}
        </article>
      )}
      {children}
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
          <p key={i}>
            <T>{p.trim()}</T>
          </p>
        ))}
    </>
  );
}

function HostText({ text }: { text: string }) {
  return (
    <article className="host-text">
      <Prose text={text} />
    </article>
  );
}

function PlayerLines({ turns }: { turns: TurnView[] }) {
  return (
    <blockquote className="player-lines">
      {turns.map((t) => (
        <p key={t.id}>
          {t.by && <strong>{t.by} </strong>}
          <data value={t.mode ?? "do"} className="chip">
            <T>{MODE_LABEL[t.mode ?? "do"]}</T>
          </data>{" "}
          {t.text}
        </p>
      ))}
    </blockquote>
  );
}

function StoryBar() {
  const { state } = useApp();
  const { act, busy } = useAct();
  const ask = useAsk();
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState<Book>();
  const story = state.story;
  const me = state.you;
  const writing = state.streaming !== null || story?.busy === true || state.board?.busy === true;
  const canAct = me !== undefined && me.seat !== "spectator" && !me.muted;
  const host = me?.host === true;
  const chapters = story?.chapters ?? [];

  return (
    <header className="story-bar">
      <p className="story-bar-left">
        <Tip text="Saved automatically as {id}" values={{ id: story?.id ?? "" }}>
          <output className="saved">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>{" "}
            <T>Saved</T>
          </output>
        </Tip>
        {chapters.length > 0 && (
          <Tip
            text="Chapters"
            content={chapters.map((c, i) => (
              <Fragment key={c.title}>
                {i > 0 && ", "}
                <T>{c.title}</T>
              </Fragment>
            ))}
          >
            <small className="muted">
              <T with={{ n: chapters.length }}>
                {chapters.length === 1 ? "{n} chapter written" : "{n} chapters written"}
              </T>
            </small>
          </Tip>
        )}
      </p>
      <menu className="story-bar-actions">
        {writing ? (
          canAct && (
            <li>
              <button type="button" onClick={() => act(api.stop)}>
                <T>Stop</T>
              </button>
            </li>
          )
        ) : (
          <>
            <li>
              <Tip text="Write a different reply">
                <button type="button" disabled={!canAct || busy} onClick={() => act(api.retry)}>
                  <T>Try again</T>
                </button>
              </Tip>
            </li>
            <li>
              <Tip text="Let the story go on">
                <button
                  type="button"
                  className="primary"
                  disabled={!canAct || busy}
                  onClick={() => act(api.continueStory)}
                >
                  <T>Keep going</T>
                </button>
              </Tip>
            </li>
            <li>
              <Tip text="Take back the last turn">
                <button
                  type="button"
                  disabled={!canAct || busy}
                  onClick={() =>
                    act(async () => {
                      const r = await api.undo();
                      if (!r.undone) throw new Error("There is nothing to undo yet.");
                    })
                  }
                >
                  <T>Undo</T>
                </button>
              </Tip>
            </li>
          </>
        )}
        {story && (
          <li>
            <Tip text="Read it as a book">
              <button
                type="button"
                onClick={() =>
                  setReading(
                    bookFromStory(state.world, story.id, visibleTurns(state), story.chapters),
                  )
                }
              >
                <T>Read</T>
              </button>
            </Tip>
          </li>
        )}
        {host && (
          <li>
            <details className="menu menu-right">
              <summary>
                <T>More</T>
              </summary>
              <menu className="menu-body">
                <li>
                  <button type="button" onClick={() => setSaving(true)}>
                    <T>Save as a new world…</T>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    disabled={writing}
                    onClick={async () => {
                      const title = await ask.prompt(
                        "Name the next chapter (or leave blank):",
                        "",
                        {},
                        "Begin",
                        false,
                      );
                      if (title !== null)
                        void act(
                          () => api.breakChapter(title.trim() || undefined),
                          "A new chapter begins.",
                        );
                    }}
                  >
                    <T>Start a new chapter…</T>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    disabled={writing}
                    onClick={() => act(api.extractPlot, "Looking for plot points…")}
                  >
                    <T>Update plot points</T>
                  </button>
                </li>
                <li>
                  <button type="button" disabled={writing} onClick={() => act(api.closeStory)}>
                    <T>Put the story away</T>
                  </button>
                </li>
              </menu>
            </details>
          </li>
        )}
      </menu>
      {saving && <SaveWorld onClose={() => setSaving(false)} />}
      {reading && <Reader book={reading} onClose={() => setReading(undefined)} />}
    </header>
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
        <>
          <h2 id="save-title">
            <T>Saved</T>
          </h2>
          <p>
            <T with={{ title: title.trim(), cards: saved.cards, chapters: saved.chapters }}>
              {saved.chapters === 0
                ? "“{title}” is in your library, with {cards} cards."
                : saved.chapters === 1
                  ? "“{title}” is in your library, with {cards} cards and {chapters} chapter."
                  : "“{title}” is in your library, with {cards} cards and {chapters} chapters."}
            </T>{" "}
            <T>
              Everything that happened in this story is now part of that world. The original is
              untouched.
            </T>
          </p>
          <footer className="dialog-actions">
            <button type="button" onClick={onClose}>
              <T>Keep playing here</T>
            </button>
            <button type="button" className="primary" disabled={busy} onClick={openIt}>
              <T>Open it now</T>
            </button>
          </footer>
        </>
      ) : (
        <form onSubmit={submit}>
          <h2 id="save-title">
            <T>Save as a new world</T>
          </h2>
          <p className="muted">
            <T>
              Keeps this story's cards, with everything that has happened written into them, and its
              chapters. New stories you start there begin from here.
            </T>
          </p>
          <label htmlFor="world-title">
            <T>Title</T>
          </label>
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
          <label htmlFor="world-name">
            <T>Folder name</T>
          </label>
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
          <p className="hint">
            <T>Lowercase letters, digits and hyphens.</T>
          </p>
          <footer className="dialog-actions">
            <button type="button" onClick={onClose}>
              <T>Cancel</T>
            </button>
            <button type="submit" className="primary" disabled={busy || !title.trim() || !name}>
              <T>{busy ? "Saving…" : "Save"}</T>
            </button>
          </footer>
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
      <section className="composer watching">
        <p>
          <T>You're watching. Join in whenever you like.</T>
        </p>
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
          <T>Join in</T>
        </button>
      </section>
    );
  }
  if (me.muted) {
    return (
      <section className="composer watching">
        <p>
          <T>You're hushed for now: you can read, but not write.</T>
        </p>
      </section>
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
        <legend className="sr-only">
          <T>What kind of turn</T>
        </legend>
        {MODES.map((m) => (
          <Tip key={m} text={MODE_HINT[m]}>
            <button
              type="button"
              aria-pressed={mode === m}
              className={mode === m ? "is-on" : ""}
              onClick={() => pick(m)}
            >
              <T>{MODE_LABEL[m]}</T>
            </button>
          </Tip>
        ))}
        <small className="hint">
          <T>{MODE_HINT[mode]}</T>
        </small>
      </fieldset>
      <Field
        placeholder={mode === "say" ? "“…”" : mode === "story" ? "The story should…" : "I…"}
        empty={!text}
        multiline
      >
        <textarea
          value={text}
          onChange={(e) => edit(e.target.value)}
          rows={3}
          maxLength={2000}
          aria-label="Your turn"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !isReady) {
              e.preventDefault();
              void ready();
            }
          }}
        />
      </Field>
      <footer className="composer-actions">
        <small className="hint">
          <T>
            {writing
              ? "You can write ahead while the story is writing."
              : isReady
                ? "Ready. Waiting for the others, or change your turn."
                : "Others see this as you write. Ready sends it when everyone is ready."}
          </T>
        </small>
        <button
          type="submit"
          className={isReady ? "" : "primary"}
          disabled={!isReady && !text.trim()}
        >
          <T>{isReady ? "Not ready" : "Ready"}</T>
        </button>
      </footer>
    </form>
  );
}
