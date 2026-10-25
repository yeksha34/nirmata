import { type ReactNode, useEffect, useRef } from "react";
import { api } from "./api";
import { useAct, useApp } from "./app-context";
import type { SeatKind } from "./types";

export function Brand() {
  return (
    <span className="brand">
      <svg viewBox="0 0 32 32" width="22" height="22" role="img" aria-label="Nirmata">
        <rect width="32" height="32" rx="7" fill="currentColor" />
        <path
          d="M8 24V8l16 16V8"
          stroke="var(--paper)"
          strokeWidth="3"
          fill="none"
          strokeLinejoin="round"
        />
      </svg>
      <span>Nirmata</span>
    </span>
  );
}

const SEAT_LABEL: Record<SeatKind, string> = {
  host: "Host",
  player: "Playing",
  spectator: "Watching",
};

export function SeatBadge({ seat, muted }: { seat: SeatKind; muted?: boolean }) {
  return (
    <span className={`badge badge-${seat}`}>
      {SEAT_LABEL[seat]}
      {muted ? " · hushed" : ""}
    </span>
  );
}

export function HeaderBar() {
  const { state, leave } = useApp();
  const { act } = useAct();
  const you = state.you;
  return (
    <header className="topbar">
      <Brand />
      {state.world && state.story && (
        <span className="world-name" title={state.world.tagline}>
          {state.world.title}
        </span>
      )}
      <span className="spacer" />
      <span
        className={`dot dot-${state.connection}`}
        role="status"
        title={
          state.connection === "live"
            ? "Connected"
            : state.connection === "lost"
              ? "Connection lost. Trying again…"
              : "Connecting…"
        }
      >
        <span className="sr-only">
          {state.connection === "live" ? "Connected" : "Connection lost, trying again"}
        </span>
      </span>
      {you && (
        <details className="menu">
          <summary>
            {you.nick} <SeatBadge seat={you.seat} muted={you.muted} />
          </summary>
          <div className="menu-body">
            <button
              type="button"
              onClick={() =>
                act(async () => {
                  await api.leave().catch(() => undefined);
                  leave();
                })
              }
            >
              Leave the table
            </button>
          </div>
        </details>
      )}
    </header>
  );
}

export function Toasts() {
  const { state, dispatch } = useApp();
  if (!state.notices.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {state.notices.map((n) => (
        <div
          key={n.id}
          className={`toast toast-${n.kind}`}
          role={n.kind === "error" ? "alert" : "status"}
        >
          <span>{n.text}</span>
          <button
            type="button"
            className="plain"
            aria-label="Dismiss"
            onClick={() => dispatch({ type: "dismiss", id: n.id })}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A dialog that opens as soon as it is shown; Escape or `onClose` puts it away. */
export function Modal({
  titleId,
  onClose,
  wide,
  children,
}: {
  titleId: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog wide" : "dialog"}
      onClose={onClose}
      aria-labelledby={titleId}
    >
      {children}
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
