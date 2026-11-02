import { useEffect, useState } from "react";
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
  const [comfyOnline, setComfyOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .comfyStatus()
      .then((s) => {
        if (active) setComfyOnline(s.online);
      })
      .catch(() => {
        if (active) setComfyOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="topbar">
      <Brand />
      {isHost && (
        <nav className="topnav" aria-label="Main">
          <button
            type="button"
            className="navlink"
            aria-current={nav.route === "worlds" ? "page" : undefined}
            onClick={() => nav.toWorlds()}
          >
            <T>Worlds</T>
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={nav.route === "vn" ? "page" : undefined}
            onClick={() => nav.toVn()}
          >
            <T>Visual Novels</T>
          </button>
          <button
            type="button"
            className="navlink"
            aria-current={nav.route === "dataset" ? "page" : undefined}
            onClick={() => nav.toDataset()}
          >
            <T>Dataset</T>
          </button>
        </nav>
      )}
      {state.world && state.story && (
        <p className="world-name" title={state.world.tagline}>
          {state.world.title}
        </p>
      )}
      {comfyOnline !== null && (
        <Tip below text={comfyOnline ? "ComfyUI Online (:8188)" : "ComfyUI Offline"}>
          <output className={`comfy-pill ${comfyOnline ? "online" : "offline"}`}>
            <T>● ComfyUI</T>
          </output>
        </Tip>
      )}
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
        <output
          className={`dot dot-${state.connection}`}
          aria-label={state.connection === "live" ? "Connected" : "Connection lost, trying again"}
        />
      </Tip>
      {you && (
        <details className="menu">
          <summary>
            <bdi className="nick-text">{you.nick}</bdi>{" "}
            <SeatBadge seat={you.seat} muted={you.muted} />
          </summary>
          <menu className="menu-body">
            <li>
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
            </li>
          </menu>
        </details>
      )}
    </header>
  );
}
