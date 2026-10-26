import { useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
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
    <div className="worlds">
      <header className="hero">
        <p className="eyebrow">For storytellers, alone or at a table</p>
        <h1>Build worlds. Host stories in them.</h1>
        <p className="lede">
          A world is a folder of cards you write once: people, places, plots, rules. A story is one
          run inside it, with its own copy, so the world stays yours while the story goes wherever
          it goes.
        </p>
      </header>
      <OpenStoryNotice />
      <Panel title="Pick up where you left off">
        {!recent ? (
          <Empty>Looking for your stories…</Empty>
        ) : recent.length === 0 ? (
          <Empty>
            Nothing has been played yet. Choose a world below and start a story; it saves itself as
            you play.
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

      <Panel
        title="Your worlds"
        aside={
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New world
          </button>
        }
      >
        {!worlds ? (
          <Empty>Looking for your worlds…</Empty>
        ) : worlds.length === 0 ? (
          <Empty>
            There are no worlds yet. Make one with “New world”, or put a world folder (one with a{" "}
            <code>world.json</code>) in your worlds folder and reload.
          </Empty>
        ) : (
          <ul className="cards">
            {worlds.map((w) => (
              <li key={w.name}>
                <button type="button" className="world-card" onClick={() => onOpen(w.name)}>
                  <strong>{w.title}</strong>
                  <span className="muted">
                    {w.problem ? `Can't be read: ${w.problem}` : w.tagline || "No tagline yet"}
                  </span>
                  <span className="meta">
                    {w.stories === 0
                      ? "No stories yet"
                      : `${w.stories} saved ${w.stories === 1 ? "story" : "stories"}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {creating && (
        <CreateWorld
          onClose={() => setCreating(false)}
          onCreated={(w) => {
            setCreating(false);
            onOpen(w.name);
          }}
        />
      )}
    </div>
  );
}
