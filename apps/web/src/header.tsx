import { api } from "./api";
import { useAct, useApp } from "./app-context";
import { Tip } from "./controls";
import { T } from "./i18n";
import { JumpBox, SHORTCUT, useJump, useNav } from "./nav";
import { Brand, SeatBadge } from "./ui";

export function HeaderBar() {
  const { state, leave } = useApp();
  const { act } = useAct();
  const nav = useNav();
  const jump = useJump();
  const you = state.you;
  const isHost = you?.seat === "host";
  return (
    <header className="topbar">
      <Brand />
      {isHost && (
        <nav className="topnav" aria-label="Main">
          <button
            type="button"
            className="navlink"
            aria-current={nav.world === undefined ? "page" : undefined}
            onClick={nav.home}
          >
            <T>Worlds</T>
          </button>
        </nav>
      )}
      {state.world && state.story && (
        <span className="world-name" title={state.world.tagline}>
          {state.world.title}
        </span>
      )}
      <span className="spacer" />
      {isHost && (
        <button
          type="button"
          className="jump"
          onClick={jump.show}
          aria-label="Jump to a world or card"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span className="jump-text">
            <T>Jump to a world or card</T>
          </span>
          <kbd>{SHORTCUT}</kbd>
        </button>
      )}
      {jump.open && <JumpBox onClose={jump.hide} />}
      <Tip
        below
        text={
          state.connection === "live"
            ? "Connected"
            : state.connection === "lost"
              ? "Connection lost. Trying again…"
              : "Connecting…"
        }
      >
        <span className={`dot dot-${state.connection}`} role="status">
          <span className="sr-only">
            {state.connection === "live" ? "Connected" : "Connection lost, trying again"}
          </span>
        </span>
      </Tip>
      {you && (
        <details className="menu">
          <summary>
            <span className="nick-text">{you.nick}</span>{" "}
            <SeatBadge seat={you.seat} muted={you.muted} />
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
              <T>Leave the table</T>
            </button>
          </div>
        </details>
      )}
    </header>
  );
}
