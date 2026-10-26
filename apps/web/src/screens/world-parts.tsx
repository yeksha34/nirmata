import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useAct, useApp, useSave } from "../app-context";
import { ago, list, words } from "../format";
import type { Card, Manifest, Perspective, StorySummary, WorldSummary } from "../types";
import { Modal, Panel } from "../ui";

// Pieces of the worlds pages that more than one of them uses.

/** Shown while a story is open in the window: why starting another waits, and how to free it. */
export function OpenStoryNotice() {
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

export function StoryRow({
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

export function CreateWorld({
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

export function StartStory({
  name,
  arcs,
  locked,
}: {
  name: string;
  arcs: Card[];
  locked: boolean;
}) {
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

export function EditWorld({
  world,
  manifest,
  onClose,
  onSaved,
}: {
  world: WorldSummary;
  manifest?: Manifest | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { problem, busy, run } = useSave();
  const [title, setTitle] = useState(world.title);
  const [tagline, setTagline] = useState(world.tagline);
  const [genre, setGenre] = useState((manifest?.genre ?? []).join(", "));
  const [tone, setTone] = useState((manifest?.tone ?? []).join(", "));
  const [perspective, setPerspective] = useState<Perspective>(
    manifest?.perspective ?? "second-person",
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const done = await run(() =>
      api.editWorld(world.name, {
        title: title.trim(),
        tagline: tagline.trim(),
        genre: words(genre),
        tone: words(tone),
        perspective,
      }),
    );
    if (done) onSaved();
  };

  return (
    <Modal titleId="edit-world-title" onClose={onClose}>
      <form onSubmit={submit}>
        <h2 id="edit-world-title">Edit the world</h2>
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
        <label htmlFor="ew-genre">Genre</label>
        <input
          id="ew-genre"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="gothic, sea"
        />
        <label htmlFor="ew-tone">Tone</label>
        <input
          id="ew-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="cozy, eerie"
        />
        <p className="hint">Separate words with commas.</p>
        <label htmlFor="ew-perspective">Told in</label>
        <select
          id="ew-perspective"
          value={perspective}
          onChange={(e) => setPerspective(e.target.value as Perspective)}
        >
          <option value="first-person">First person (I)</option>
          <option value="second-person">Second person (you)</option>
          <option value="third-person">Third person (they)</option>
        </select>
        <p className="hint">
          The folder keeps its name, <code>{world.name}</code>. Stories already started keep the
          title they began with.
        </p>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
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

export function PutAway({
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
