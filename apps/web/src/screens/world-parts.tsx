import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useAct, useApp, useSave } from "../app-context";
import { Choice, Field } from "../controls";
import { agoParts, words } from "../format";
import { Both, T } from "../i18n";
import type { Card, Manifest, Perspective, StorySummary, WorldSummary } from "../types";
import { Modal, Panel } from "../ui";

// Pieces of the worlds pages that more than one of them uses.

/** Shown while a story is open in the window: why starting another waits, and how to free it. */
/** How long ago a story was last played, in words. */
export function Ago({ iso }: { iso: string }) {
  const when = agoParts(iso);
  if (!when) return null;
  if ("date" in when) {
    const at = new Date(Date.parse(iso));
    const format = (locale: string) =>
      at.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
    return <Both hi={format("hi-IN")} en={format("en-GB")} />;
  }
  return <T with={{ n: when.n }}>{when.text}</T>;
}

export function OpenStoryNotice() {
  const { state } = useApp();
  const { act, busy } = useAct();
  if (!state.story) return null;
  const writing = state.streaming !== null || state.story.busy || state.board?.busy === true;
  return (
    <Panel title="A story is open">
      <p>
        {state.world ? (
          <T with={{ title: state.world.title }}>{"A story in {title} is open in the window."}</T>
        ) : (
          <T>A story is open.</T>
        )}{" "}
        <T>Put it away (it stays saved) to start or continue a different one.</T>
      </p>
      <button type="button" disabled={busy || writing} onClick={() => act(api.closeStory)}>
        <T>Put the story away</T>
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
      {world && <small className="chip">{world}</small>}
      <p className="preview">
        {story.damaged ? (
          <T>This story's file can't be read.</T>
        ) : (
          story.preview || <T>Just begun</T>
        )}
      </p>
      <p className="meta">
        {story.damaged ? (
          <T>Needs repair before it can be continued</T>
        ) : (
          <>
            <Ago iso={story.updatedAt} /> ·{" "}
            <T with={{ n: story.turns }}>{story.turns === 1 ? "{n} turn" : "{n} turns"}</T>
            {story.players.length > 0 && (
              <>
                {" "}
                · <T with={{ names: story.players.join(", ") }}>{"with {names}"}</T>
              </>
            )}
          </>
        )}
      </p>
      <button
        type="button"
        className="primary"
        disabled={busy || story.damaged}
        onClick={onContinue}
      >
        <T>Continue</T>
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
        <h2 id="new-world-title">
          <T>New world</T>
        </h2>
        <label htmlFor="nw-title">
          <T>Title</T>
        </label>
        <input
          id="nw-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="nw-tagline">
          <T>A line about it (optional)</T>
        </label>
        <input
          id="nw-tagline"
          value={tagline}
          maxLength={200}
          onChange={(e) => setTagline(e.target.value)}
        />
        <label htmlFor="nw-premise">
          <T>What is it like? (optional)</T>
        </label>
        <textarea
          id="nw-premise"
          rows={5}
          value={premise}
          maxLength={4000}
          onChange={(e) => setPremise(e.target.value)}
        />
        <p className="hint">
          <T>
            The storyteller always keeps this in mind. You can add places, people and rules as cards
            in the world's folder later.
          </T>
        </p>
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            <T>Make the world</T>
          </button>
        </footer>
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
      <form
        className="new-story"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => api.startStoryIn(name, arc || undefined));
        }}
      >
        {arcs.length > 0 && (
          <Choice
            legend="Begin with"
            value={arc}
            options={[
              { value: "", label: "Let the story begin its own way" },
              ...arcs.map((a) => ({ value: a.fm.id, label: a.fm.name, raw: true })),
            ]}
            onChange={setArc}
          />
        )}
        <button type="submit" className="primary" disabled={busy}>
          <T>Start a new story</T>
        </button>
        <p className="hint">
          <T>
            The story takes its own copy of the world's cards, so changing the world later never
            changes a story you've started.
          </T>
        </p>
      </form>
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
        <h2 id="edit-world-title">
          <T>Edit the world</T>
        </h2>
        <label htmlFor="ew-title">
          <T>Title</T>
        </label>
        <input
          id="ew-title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="ew-tagline">
          <T>A line about it</T>
        </label>
        <input
          id="ew-tagline"
          value={tagline}
          maxLength={200}
          onChange={(e) => setTagline(e.target.value)}
        />
        <label htmlFor="ew-genre">
          <T>Genre</T>
        </label>
        <Field placeholder="gothic, sea" empty={!genre}>
          <input id="ew-genre" value={genre} onChange={(e) => setGenre(e.target.value)} />
        </Field>
        <label htmlFor="ew-tone">
          <T>Tone</T>
        </label>
        <Field placeholder="cozy, eerie" empty={!tone}>
          <input id="ew-tone" value={tone} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <p className="hint">
          <T>Separate words with commas.</T>
        </p>
        <Choice
          legend="Told in"
          value={perspective}
          options={[
            { value: "first-person", label: "First person (I)" },
            { value: "second-person", label: "Second person (you)" },
            { value: "third-person", label: "Third person (they)" },
          ]}
          onChange={setPerspective}
        />
        <p className="hint">
          <T with={{ name: <code>{world.name}</code> }}>
            {
              "The folder keeps its name, {name}. Stories already started keep the title they began with."
            }
          </T>
        </p>
        {problem && (
          <p className="error" role="alert">
            <T>{problem}</T>
          </p>
        )}
        <footer className="dialog-actions">
          <button type="button" onClick={onClose}>
            <T>Cancel</T>
          </button>
          <button type="submit" className="primary" disabled={busy || !title.trim()}>
            <T>Save</T>
          </button>
        </footer>
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
      <h2 id="put-away-title">
        <T with={{ title: world.title }}>{"Put “{title}” away?"}</T>
      </h2>
      <p>
        <T with={{ n: world.stories, prefix: <code>_archived-</code> }}>
          {world.stories === 1
            ? "It disappears from your worlds, along with its {n} story. Nothing is deleted: its folder is renamed to start with {prefix}, and renaming it back brings it back."
            : "It disappears from your worlds, along with its {n} stories. Nothing is deleted: its folder is renamed to start with {prefix}, and renaming it back brings it back."}
        </T>
      </p>
      {inUse && (
        <p className="error">
          <T>
            A story in this world is open at the table. It closes for everyone, and stays saved.
          </T>
        </p>
      )}
      <footer className="dialog-actions">
        <button type="button" onClick={onClose}>
          <T>Keep it</T>
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
          <T>Put it away</T>
        </button>
      </footer>
    </Modal>
  );
}
