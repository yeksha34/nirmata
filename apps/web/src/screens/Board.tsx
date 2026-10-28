import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { Field, Tip, useAsk } from "../controls";
import { MODE_LABEL } from "../format";
import { T } from "../i18n";
import { type Book, bookFromDraft } from "../reader/book";
import { Reader } from "../reader/Reader";
import { waitingFor } from "../store";
import type { Draft, Participant, Remark } from "../types";
import { Empty, Panel, SeatBadge } from "../ui";

/** Who is at the table, and (for the host) the in-fiction powers over them. */
export function People() {
  const { state } = useApp();
  const board = state.board;
  const { act } = useAct();
  const ask = useAsk();
  if (!board) return null;
  const hostView = state.you?.host === true;
  const online = new Set(board.online.map((n) => n.toLowerCase()));

  const mod = async (p: Participant, action: "kick" | "mute" | "unmute") => {
    if (
      action === "kick" &&
      !(await ask.confirm("Send {nick} away from the table?", { nick: p.nick }, "Send away"))
    )
      return;
    void act(() => api.moderate({ action, nick: p.nick }));
  };
  const rename = async (p: Participant) => {
    const next = (
      await ask.prompt("A new name for {nick}:", p.nick, { nick: p.nick }, "Rename")
    )?.trim();
    if (next && next !== p.nick)
      void act(() => api.moderate({ action: "rename", nick: p.nick, newNick: next }));
  };

  return (
    <Panel title="At the table">
      <ul className="people">
        {board.participants.map((p) => (
          <li key={p.nick}>
            <Tip text={online.has(p.nick.toLowerCase()) ? "Here" : "Not connected"}>
              <output
                className={`dot dot-${online.has(p.nick.toLowerCase()) ? "live" : "lost"}`}
                aria-label={online.has(p.nick.toLowerCase()) ? "Here" : "Not connected"}
              />
            </Tip>
            <bdi className="nick">{p.nick}</bdi>
            <SeatBadge seat={p.seat} muted={p.muted} />
            {hostView && p.seat !== "host" && (
              <details className="menu menu-right">
                <summary aria-label={`Actions for ${p.nick}`}>…</summary>
                <menu className="menu-body">
                  <li>
                    <button type="button" onClick={() => mod(p, p.muted ? "unmute" : "mute")}>
                      <T>{p.muted ? "Let them speak" : "Hush"}</T>
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => rename(p)}>
                      <T>Rename</T>
                    </button>
                  </li>
                  <li>
                    <button type="button" className="danger" onClick={() => mod(p, "kick")}>
                      <T>Send away</T>
                    </button>
                  </li>
                </menu>
              </details>
            )}
          </li>
        ))}
      </ul>
      {board.notices.length > 0 && (
        <ul className="notices" aria-label="What has happened at the table">
          {board.notices.slice(-4).map((n) => (
            <li key={n.id}>
              <T>{n.text}</T>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Everyone's turn-in-progress, and the talk around it. Nothing is sent until the round closes. */
export function BoardPanel() {
  const { state } = useApp();
  const { act } = useAct();
  const board = state.board;
  if (!board) return null;
  const me = state.you;
  const waiting = waitingFor(board);
  const mine = board.drafts.find((d) => d.nick.toLowerCase() === me?.nick.toLowerCase());

  return (
    <Panel
      title="The table's turn"
      aside={
        me?.host && board.drafts.length > 0 && !board.busy ? (
          <button type="button" onClick={() => act(api.closeRound)}>
            <T>Send it now</T>
          </button>
        ) : undefined
      }
    >
      <p className="round-status" aria-live="polite">
        {board.busy ? (
          <T>The story is writing…</T>
        ) : board.drafts.length === 0 ? (
          <T>Nobody has written yet. Everyone's turn goes in together.</T>
        ) : waiting.length === 0 ? (
          <T>Everyone's ready.</T>
        ) : (
          <T with={{ names: waiting.join(", ") }}>{"Waiting for {names}."}</T>
        )}
      </p>

      {board.drafts.length === 0 ? (
        <Empty>
          <T>Turns appear here as people write them, so you can talk before anything is sent.</T>
        </Empty>
      ) : (
        <ul className="drafts">
          {board.drafts.map((d) => (
            <DraftCard
              key={d.nick}
              draft={d}
              isMine={d.nick === mine?.nick}
              canSpeak={canSpeak(me)}
            />
          ))}
        </ul>
      )}

      <Remarks />
    </Panel>
  );
}

function canSpeak(me: { seat: string; muted: boolean } | undefined): boolean {
  return me !== undefined && me.seat !== "spectator" && !me.muted;
}

function DraftCard({
  draft,
  isMine,
  canSpeak,
}: {
  draft: Draft;
  isMine: boolean;
  canSpeak: boolean;
}) {
  const { act } = useAct();
  const [objecting, setObjecting] = useState(false);
  const [reading, setReading] = useState<Book>();
  const [text, setText] = useState("");

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.object(draft.nick, text.trim()));
    if (ok) {
      setText("");
      setObjecting(false);
    }
  };

  return (
    <li className={`draft${draft.ready ? " is-ready" : ""}`}>
      <header className="draft-head">
        <strong>{isMine ? <T>You</T> : draft.nick}</strong>
        <data value={draft.mode} className="chip">
          <T>{MODE_LABEL[draft.mode]}</T>
        </data>
        {draft.ready && (
          <strong className="ready">
            ✓ <T>Ready</T>
          </strong>
        )}
        {draft.objections > 0 && (
          <Tip text="Objections still standing">
            <data value={draft.objections} className="objection-count">
              <T with={{ n: draft.objections }}>
                {draft.objections === 1 ? "{n} objection" : "{n} objections"}
              </T>
            </data>
          </Tip>
        )}
      </header>
      <p>{draft.text}</p>
      <button type="button" className="plain" onClick={() => setReading(bookFromDraft(draft))}>
        <T>Read</T>
      </button>
      {reading && <Reader book={reading} onClose={() => setReading(undefined)} />}
      {!isMine && canSpeak && !objecting && (
        <button type="button" className="plain" onClick={() => setObjecting(true)}>
          <T>Object…</T>
        </button>
      )}
      {objecting && (
        <form className="inline-form" onSubmit={send}>
          <Field placeholder="Why not, {nick}?" values={{ nick: draft.nick }} empty={!text}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={`Your objection to ${draft.nick}'s turn`}
              maxLength={500}
              // biome-ignore lint/a11y/noAutofocus: the person just asked to type here
              autoFocus
            />
          </Field>
          <button type="submit" disabled={!text.trim()}>
            <T>Object</T>
          </button>
          <button type="button" className="plain" onClick={() => setObjecting(false)}>
            <T>Cancel</T>
          </button>
        </form>
      )}
    </li>
  );
}

function Remarks() {
  const { state } = useApp();
  const { act } = useAct();
  const [text, setText] = useState("");
  const board = state.board;
  const me = state.you;
  if (!board) return null;

  const talk = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.remark(text.trim()));
    if (ok) setText("");
  };

  return (
    <section className="remarks" aria-label="Talk about the turn">
      {board.remarks.length > 0 && (
        <ul>
          {board.remarks.map((r) => (
            <RemarkLine
              key={r.id}
              remark={r}
              mine={r.by.toLowerCase() === me?.nick.toLowerCase()}
            />
          ))}
        </ul>
      )}
      {canSpeak(me) ? (
        <form className="inline-form" onSubmit={talk}>
          <Field placeholder="Say something to the table" empty={!text}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Say something to the table"
              maxLength={500}
            />
          </Field>
          <button type="submit" disabled={!text.trim()}>
            <T>Say</T>
          </button>
        </form>
      ) : (
        <p className="hint">
          <T>
            {me?.muted
              ? "You're hushed for now: you can read, but not write."
              : "Join in to talk with the table."}
          </T>
        </p>
      )}
    </section>
  );
}

function RemarkLine({ remark, mine }: { remark: Remark; mine: boolean }) {
  const { act } = useAct();
  return (
    <li className={`remark remark-${remark.kind}${remark.answered ? " is-answered" : ""}`}>
      <strong className="remark-by">
        {mine ? <T>You</T> : remark.by}
        {remark.kind === "objection" && remark.about ? ` → ${remark.about}` : ""}
      </strong>
      {remark.text}
      {remark.answered && (
        <em>
          {" "}
          <T>(answered)</T>
        </em>
      )}
      {mine && (
        <Tip text="Take back">
          <button
            type="button"
            className="plain"
            aria-label="Take back"
            onClick={() => act(() => api.withdraw(remark.id))}
          >
            ×
          </button>
        </Tip>
      )}
    </li>
  );
}
