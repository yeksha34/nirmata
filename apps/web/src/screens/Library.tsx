import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { ago, list } from "../format";
import type { Card, StorySummary, WorldSummary } from "../types";
import { Empty, Panel } from "../ui";

/**
 * The host's front door: choose a world, then start a new story in it or continue a saved one.
 * Everything here is a choice you can see; nothing is configured outside the screen.
 */
export function Library() {
  const { state } = useApp();
  const { act, busy } = useAct();
  const [worlds, setWorlds] = useState<WorldSummary[]>();
  const [stories, setStories] = useState<StorySummary[]>();
  const open = state.world?.name;

  const loadWorlds = useCallback(() => act(api.worlds).then(setWorlds), [act]);
  const loadStories = useCallback(
    () => (open ? act(api.stories).then(setStories) : Promise.resolve(setStories(undefined))),
    [act, open],
  );

  useEffect(() => {
    void loadWorlds();
  }, [loadWorlds]);
  useEffect(() => {
    void loadStories();
  }, [loadStories]);

  return (
    <div className="library">
      <Panel title={open ? "Your worlds" : "Choose a world"}>
        {!worlds ? (
          <Empty>Looking for your worlds…</Empty>
        ) : worlds.length === 0 ? (
          <Empty>
            There are no worlds yet. Put a world folder (one with a <code>world.json</code>) in your
            worlds folder and reload this page.
          </Empty>
        ) : (
          <ul className="cards">
            {worlds.map((w) => (
              <li key={w.name}>
                <button
                  type="button"
                  className={`world-card${w.name === open ? " is-open" : ""}`}
                  disabled={busy || w.problem !== undefined}
                  aria-pressed={w.name === open}
                  onClick={() => act(() => api.openWorld(w.name))}
                >
                  <strong>{w.title}</strong>
                  <span className="muted">
                    {w.problem ? `Can't open: ${w.problem}` : w.tagline}
                  </span>
                  <span className="meta">
                    {w.stories === 0
                      ? "No stories yet"
                      : `${w.stories} saved ${w.stories === 1 ? "story" : "stories"}`}
                    {w.name === open ? " · open" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {open && (
        <>
          <NewStory />
          <Panel title="Continue a story">
            {!stories ? (
              <Empty>Looking for saved stories…</Empty>
            ) : stories.length === 0 ? (
              <Empty>
                No saved stories in {state.world?.title} yet. Start one above; it saves itself as
                you play.
              </Empty>
            ) : (
              <ul className="stories">
                {stories.map((s) => (
                  <StoryRow key={s.id} story={s} busy={busy} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function StoryRow({ story, busy }: { story: StorySummary; busy: boolean }) {
  const { act } = useAct();
  return (
    <li className="story-row">
      <div className="story-row-text">
        <p className="preview">
          {story.damaged ? "This story's file can't be read." : story.preview || "Just begun"}
        </p>
        <p className="meta">
          {story.damaged
            ? "Needs repair before it can be continued"
            : [
                ago(story.updatedAt),
                `${story.turns} ${story.turns === 1 ? "turn" : "turns"}`,
                story.players.length ? `with ${list(story.players)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>
      </div>
      <button
        type="button"
        className="primary"
        disabled={busy || story.damaged}
        onClick={() => act(() => api.resumeStory(story.id))}
      >
        Continue
      </button>
    </li>
  );
}

function NewStory() {
  const { act, busy } = useAct();
  const [arcs, setArcs] = useState<Card[]>([]);
  const [arc, setArc] = useState("");

  useEffect(() => {
    void act(api.sourceCards).then((cards) =>
      setArcs((cards ?? []).filter((c) => c.fm.kind === "arc")),
    );
  }, [act]);

  return (
    <Panel title="Start a new story">
      <div className="new-story">
        {arcs.length > 0 && (
          <>
            <label htmlFor="arc">Begin with</label>
            <select id="arc" value={arc} onChange={(e) => setArc(e.target.value)}>
              <option value="">Let the story begin its own way</option>
              {arcs.map((a) => (
                <option key={a.fm.id} value={a.fm.id}>
                  {a.fm.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => act(() => api.startStory(arc || undefined))}
        >
          Start a new story
        </button>
        <p className="hint">
          The story takes its own copy of the world's cards, so changing the world later never
          changes a story you've started.
        </p>
      </div>
    </Panel>
  );
}
