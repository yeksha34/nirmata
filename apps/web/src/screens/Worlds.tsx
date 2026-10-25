import { type FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { ago, list } from "../format";
import type { Card, RecentStory, StorySummary, WorldDetail, WorldSummary } from "../types";
import { Empty, Modal, Panel } from "../ui";

/**
 * The host's page behind the story window. Everything in every world is reachable from here
 * without opening anything first: pick up the story you were in, explore a world, start a story
 * in it, make a new world, change its details or put it away. Starting or continuing a story
 * opens its world, and the story appears in the window. While one is open, starting or
 * continuing another waits until it is put away.
 */
export function Worlds() {
  const [page, setPage] = useState<string>();
  return page ? (
    <WorldPage name={page} onBack={() => setPage(undefined)} />
  ) : (
    <Home onOpen={setPage} />
  );
}

// ---- the home page: where you left off, and every world ------------------------------------

/** Shown while a story is open in the window: why starting another waits, and how to free it. */
function OpenStoryNotice() {
  const { state } = useApp();
  const { act, busy } = useAct();
  if (!state.story) return null;
  const writing = state.streaming !== null || state.story.busy || state.board?.busy === true;
  return (
    <Panel title="A story is open">
      <p>
        {state.world
          ? `A story in ${state.world.title} is open in the window.`
          : "A story is open."}{" "}
        Put it away (it stays saved) to start or continue a different one.
      </p>
      <button type="button" disabled={busy || writing} onClick={() => act(api.closeStory)}>
        Put the story away
      </button>
    </Panel>
  );
}

function Home({ onOpen }: { onOpen: (name: string) => void }) {
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

function StoryRow({
  story,
  world,
  busy,
  onContinue,
}: {
  story: StorySummary;
  /** The world's title, when the row is shown outside that world's own page. */
  world?: string;
  busy: boolean;
  onContinue: () => void;
}) {
  return (
    <li className="story-row">
      <div className="story-row-text">
        {world && <span className="chip">{world}</span>}
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
        onClick={onContinue}
      >
        Continue
      </button>
    </li>
  );
}

// ---- making a world --------------------------------------------------------------------------

function CreateWorld({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (world: WorldSummary) => void;
}) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [premise, setPremise] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const world = await act(() =>
      api.createWorld({ title: title.trim(), tagline: tagline.trim(), premise: premise.trim() }),
    );
    if (world) onCreated(world);
  };

  return (
    <Modal titleId="new-world-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id="new-world-title">New world</h2>
        <label htmlFor="nw-title">Title</label>
        <input
          id="nw-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="nw-tagline">A line about it (optional)</label>
        <input
          id="nw-tagline"
          value={tagline}
          maxLength={200}
          onChange={(e) => setTagline(e.target.value)}
        />
        <label htmlFor="nw-premise">What is it like? (optional)</label>
        <textarea
          id="nw-premise"
          rows={5}
          value={premise}
          maxLength={4000}
          onChange={(e) => setPremise(e.target.value)}
        />
        <p className="hint">
          The storyteller always keeps this in mind. You can add places, people and rules as cards
          in the world's folder later.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            Make the world
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---- one world's page ------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  lore: "Lore",
  character: "Characters",
  place: "Places",
  arc: "Story arcs",
  rule: "Rules",
  scene: "Scenes",
};
const KIND_ORDER = Object.keys(KIND_LABEL);

function WorldPage({ name, onBack }: { name: string; onBack: () => void }) {
  const { state } = useApp();
  const { act, busy } = useAct();
  const locked = state.story !== null;
  /** undefined while loading; null when it could not be loaded. */
  const [detail, setDetail] = useState<WorldDetail | null>();
  const [editing, setEditing] = useState(false);
  const [putting, setPutting] = useState(false);

  const load = useCallback(
    () => act(() => api.worldDetail(name)).then((d) => setDetail(d ?? null)),
    [act, name],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (detail === undefined)
    return (
      <div className="worlds">
        <Empty>Opening the world…</Empty>
      </div>
    );
  if (detail === null)
    return (
      <div className="worlds">
        <button type="button" className="plain back" onClick={onBack}>
          ← All worlds
        </button>
        <Empty>This world could not be opened. The reason is shown above.</Empty>
      </div>
    );

  const { world, stories, cards } = detail;
  const arcs = cards.filter((c) => c.fm.kind === "arc");

  return (
    <div className="worlds">
      <button type="button" className="plain back" onClick={onBack}>
        ← All worlds
      </button>
      <OpenStoryNotice />
      <div className="world-head">
        <div>
          <h1>{world.title}</h1>
          <p className="muted">{world.tagline || "No tagline yet."}</p>
        </div>
        <div className="head-actions">
          <button type="button" onClick={() => setEditing(true)}>
            Edit details
          </button>
          <button type="button" className="danger" onClick={() => setPutting(true)}>
            Put away
          </button>
        </div>
      </div>

      {world.problem ? (
        <Panel title="This world can't be read">
          <p className="error">{world.problem}</p>
          <p className="hint">
            Fix <code>{name}/world.json</code> in your worlds folder and reload, or put the world
            away.
          </p>
        </Panel>
      ) : (
        <>
          <StartStory name={name} arcs={arcs} locked={locked} />
          <Panel title="Saved stories">
            {stories.length === 0 ? (
              <Empty>No stories in {world.title} yet. Start one above.</Empty>
            ) : (
              <ul className="stories">
                {stories.map((s) => (
                  <StoryRow
                    key={s.id}
                    story={s}
                    busy={busy || locked}
                    onContinue={() => act(() => api.resumeStoryIn(name, s.id))}
                  />
                ))}
              </ul>
            )}
          </Panel>
          <Cards cards={cards} />
        </>
      )}

      {editing && (
        <EditWorld
          world={world}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
      {putting && (
        <PutAway
          world={world}
          onClose={() => setPutting(false)}
          onDone={() => {
            setPutting(false);
            onBack();
          }}
        />
      )}
    </div>
  );
}

function StartStory({ name, arcs, locked }: { name: string; arcs: Card[]; locked: boolean }) {
  const { act, busy: working } = useAct();
  const busy = working || locked;
  const [arc, setArc] = useState("");
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
          onClick={() => act(() => api.startStoryIn(name, arc || undefined))}
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

function Cards({ cards }: { cards: Card[] }) {
  const kinds = [
    ...KIND_ORDER.filter((k) => cards.some((c) => c.fm.kind === k)),
    ...[...new Set(cards.map((c) => c.fm.kind))].filter((k) => !KIND_ORDER.includes(k)),
  ];
  return (
    <Panel title="What's in this world">
      {cards.length === 0 ? (
        <Empty>
          No cards yet. Add markdown files under <code>lore/</code>, <code>characters/</code>,{" "}
          <code>setting/</code> or <code>plot/</code> in the world's folder.
        </Empty>
      ) : (
        <>
          {kinds.map((kind) => (
            <section key={kind} className="card-group">
              <h3>{KIND_LABEL[kind] ?? kind}</h3>
              {cards
                .filter((c) => c.fm.kind === kind)
                .map((c) => (
                  <details key={c.fm.id} className="card-item">
                    <summary>
                      <strong>{c.fm.name}</strong>
                      {c.fm.always && <span className="chip">always in view</span>}
                      {c.fm.summary && <span className="muted"> {c.fm.summary}</span>}
                    </summary>
                    <p className="card-body">{c.body.trim() || "(no text)"}</p>
                  </details>
                ))}
            </section>
          ))}
          <p className="hint">
            To change a card, edit its markdown file in the world's folder. Editing here comes
            later.
          </p>
        </>
      )}
    </Panel>
  );
}

function EditWorld({
  world,
  onClose,
  onSaved,
}: {
  world: WorldSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { act, busy } = useAct();
  const [title, setTitle] = useState(world.title);
  const [tagline, setTagline] = useState(world.tagline);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const done = await act(() =>
      api.editWorld(world.name, { title: title.trim(), tagline: tagline.trim() }),
    );
    if (done) onSaved();
  };

  return (
    <Modal titleId="edit-world-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id="edit-world-title">Edit details</h2>
        <label htmlFor="ew-title">Title</label>
        <input
          id="ew-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="ew-tagline">A line about it</label>
        <input
          id="ew-tagline"
          value={tagline}
          maxLength={200}
          onChange={(e) => setTagline(e.target.value)}
        />
        <p className="hint">
          The folder keeps its name, <code>{world.name}</code>. Stories already started keep the
          title they began with.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PutAway({
  world,
  onClose,
  onDone,
}: {
  world: WorldSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const { state } = useApp();
  const { act, busy } = useAct();
  const inUse = state.story !== null && state.world?.name === world.name;
  return (
    <Modal titleId="put-away-title" onClose={onClose}>
      <h2 id="put-away-title">Put “{world.title}” away?</h2>
      <p>
        It disappears from your worlds, along with its {world.stories}{" "}
        {world.stories === 1 ? "story" : "stories"}. Nothing is deleted: its folder is renamed to
        start with <code>_archived-</code>, and renaming it back brings it back.
      </p>
      {inUse && (
        <p className="error">
          A story in this world is open at the table. It closes for everyone, and stays saved.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Keep it
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            const done = await act(() => api.archiveWorld(world.name));
            if (done) onDone();
          }}
        >
          Put it away
        </button>
      </div>
    </Modal>
  );
}
