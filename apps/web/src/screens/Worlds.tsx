import { useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { T } from "../i18n";
import { useNav } from "../nav";
import type { RecentStory, WorldSummary } from "../types";
import { Empty, Panel } from "../ui";
import { Workspace } from "./Workspace";
import { CreateWorld, OpenStoryNotice, StoryRow } from "./world-parts";

/**
 * The host's page behind the story window. Everything in every world is reachable from here
 * without opening anything first: pick up the story you were in, explore a world, start a story
 * in it, make a new world, change its details or put it away. Starting or continuing a story
 * opens its world, and the story appears in the window. While one is open, starting or
 * continuing another waits until it is put away.
 */
export function Worlds() {
  const nav = useNav();
  return nav.world ? <Workspace key={nav.world} name={nav.world} /> : <Home />;
}

// ---- the home page: where you left off, and every world ------------------------------------

function Home() {
  const nav = useNav();
  const onOpen = (name: string) => nav.open(name);
  const { state } = useApp();
  const { act, busy } = useAct();
  const locked = state.story !== null;
  const [recent, setRecent] = useState<RecentStory[]>();
  const [worlds, setWorlds] = useState<WorldSummary[]>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void act(api.recent).then((r) => setRecent(r ?? []));
    void act(api.worlds).then((w) => setWorlds(w ?? []));
  }, [act]);

  return (
    <section className="worlds">
      <header className="hero">
        <p className="eyebrow">
          <T>For storytellers, alone or at a table</T>
        </p>
        <h1>
          <T>Build worlds. Host stories in them.</T>
        </h1>
        <p className="lede">
          <T>
            {
              "A world is a folder of cards you write once: people, places, plots, rules. A story is one run inside it, with its own copy, so the world stays yours while the story goes wherever it goes."
            }
          </T>
        </p>
      </header>
      <OpenStoryNotice />
      <Panel title="Pick up where you left off">
        {!recent ? (
          <Empty>
            <T>Looking for your stories…</T>
          </Empty>
        ) : recent.length === 0 ? (
          <Empty>
            <T>
              Nothing has been played yet. Choose a world below and start a story; it saves itself
              as you play.
            </T>
          </Empty>
        ) : (
          <ul className="stories">
            {recent.map((s) => (
              <StoryRow
                key={`${s.world}/${s.id}`}
                story={s}
                world={s.worldTitle}
                busy={busy || locked}
                onContinue={() => act(() => api.resumeStoryIn(s.world, s.id))}
              />
            ))}
          </ul>
        )}
      </Panel>

      <section className="shelf" aria-labelledby="worlds-title">
        <header className="shelf-head">
          <h2 id="worlds-title">
            <T>Your worlds</T>
          </h2>
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            <T>New world</T>
          </button>
        </header>
        {!worlds ? (
          <Empty>
            <T>Looking for your worlds…</T>
          </Empty>
        ) : worlds.length === 0 ? (
          <Empty>
            <T with={{ file: <code>world.json</code> }}>
              {
                "There are no worlds yet. Make one with “New world”, or put a world folder (one with a {file}) in your worlds folder and reload."
              }
            </T>
          </Empty>
        ) : (
          <ul className="cards">
            {worlds.map((w) => (
              <li key={w.name}>
                <button type="button" className="world-card" onClick={() => onOpen(w.name)}>
                  <strong>{w.title}</strong>
                  <small className="muted">
                    {w.problem ? (
                      <T with={{ problem: w.problem }}>{"Can't be read: {problem}"}</T>
                    ) : (
                      w.tagline || <T>No tagline yet</T>
                    )}
                  </small>
                  <small className="meta">
                    <T with={{ n: w.stories }}>
                      {w.stories === 0
                        ? "No stories yet"
                        : w.stories === 1
                          ? "{n} saved story"
                          : "{n} saved stories"}
                    </T>
                  </small>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="world-new" onClick={() => setCreating(true)}>
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <T>New world</T>
              </button>
            </li>
          </ul>
        )}
      </section>

      {creating && (
        <CreateWorld
          onClose={() => setCreating(false)}
          onCreated={(w) => {
            setCreating(false);
            onOpen(w.name);
          }}
        />
      )}
    </section>
  );
}
