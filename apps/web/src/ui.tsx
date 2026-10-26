import { type ReactNode, useEffect, useRef } from "react";
import { useApp } from "./app-context";
import { T } from "./i18n";
import type { SeatKind } from "./types";

export function Brand() {
  return (
    <span className="brand">
      <svg
        viewBox="0 0 24 24"
        width="26"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2v2M9 4h6M8 7h8l1 10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
        <path d="M12 10c1.6 1.6 1.6 3.2 0 4.8-1.6-1.6-1.6-3.2 0-4.8z" />
      </svg>
      <span>
        <T>Nirmata</T>
      </span>
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
      <T>{SEAT_LABEL[seat]}</T>
      {muted && (
        <>
          {" · "}
          <T>hushed</T>
        </>
      )}
    </span>
  );
}

/** Problems found in a card or a world, each shown in Hindi (with its English on hover). */
export function Problems({ list }: { list: readonly string[] }) {
  return (
    <>
      {list.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the problems never reorder
        <span key={i}>
          {i > 0 && "; "}
          <T>{text}</T>
        </span>
      ))}
    </>
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
          <span>
            <T>{n.text}</T>
          </span>
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
  plain,
  aside,
  children,
}: {
  title: string;
  /** The title is something a person wrote (a world's name), so it is not translated. */
  plain?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{plain ? title : <T>{title}</T>}</h2>
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
