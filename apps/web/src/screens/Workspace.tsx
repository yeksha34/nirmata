import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { useNav } from "../nav";
import type { CardKind, WorldDetail, WorldSummary } from "../types";
import { Empty, Panel } from "../ui";
import {
  CardEditor,
  CardList,
  CardTextDialog,
  type Dialog,
  RemoveCard,
  useTemplates,
  WorldFacts,
} from "./Manager";
import {
  CreateWorld,
  EditWorld,
  OpenStoryNotice,
  PutAway,
  StartStory,
  StoryRow,
} from "./world-parts";

type Tab = "cards" | "stories" | "world";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "cards", label: "Cards" },
  { id: "stories", label: "Stories" },
  { id: "world", label: "World" },
];

/**
 * One world, as a workspace: your worlds down the side, this world's cards and stories in the
 * middle, and the chosen card open for editing beside them. On a narrow screen the three become
 * one at a time. Nothing here opens the world; stories begun afterwards use the cards as saved.
 */
export function Workspace({ name }: { name: string }) {
  const nav = useNav();
  const { state } = useApp();
  const { act, busy } = useAct();
  const locked = state.story !== null;
  const templates = useTemplates();
  /** undefined while loading; null when it could not be loaded. */
  const [detail, setDetail] = useState<WorldDetail | null>();
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [tab, setTab] = useState<Tab>("cards");
  const [making, setMaking] = useState<CardKind>();
  const [dialog, setDialog] = useState<Dialog>();
  const [editing, setEditing] = useState(false);
  const [putting, setPutting] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    () => act(() => api.worldDetail(name)).then((d) => setDetail(d ?? null)),
    [act, name],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void act(api.worlds).then((w) => setWorlds(w ?? []));
  }, [act]);

  const { setCards } = nav;
  useEffect(() => {
    setCards(
      (detail?.cards ?? []).map((c) => ({
        path: c.path,
        name: c.fm.name,
        kind: c.fm.kind,
        summary: c.fm.summary ?? "",
        keywords: c.fm.keywords ?? [],
      })),
    );
  }, [detail, setCards]);

  // arriving from the jump box with a card chosen: show the cards
  useEffect(() => {
    if (nav.card) {
      setTab("cards");
      setMaking(undefined);
    }
  }, [nav.card]);

  if (detail === undefined)
    return (
      <div className="ws-wrap">
        <Empty>Opening the world…</Empty>
      </div>
    );
  if (detail === null)
    return (
      <div className="ws-wrap">
        <button type="button" className="plain" onClick={nav.home}>
          ← All worlds
        </button>
        <Empty>This world could not be opened. The reason is shown above.</Empty>
      </div>
    );

  const { world, stories, cards, broken } = detail;
  const arcs = cards.filter((c) => c.fm.kind === "arc");
  const selected = cards.find((c) => c.path === nav.card);
  const editingCard = selected !== undefined || making !== undefined;
  const latest = stories.find((s) => !s.damaged);
  const closeDialog = () => setDialog(undefined);

  const play = () =>
    act(async () => {
      if (latest) await api.resumeStoryIn(name, latest.id);
      else await api.startStoryIn(name);
    });

  return (
    <div className="ws-wrap">
      <OpenStoryNotice />
      <div className="ws" data-editing={editingCard ? "true" : "false"}>
        <aside className="ws-rail" aria-label="Your worlds">
          <p className="eyebrow quiet">Your worlds</p>
          <ul>
            {worlds.map((w) => (
              <li key={w.name}>
                <button
                  type="button"
                  className="rail-item"
                  aria-current={w.name === name ? "true" : undefined}
                  onClick={() => nav.open(w.name)}
                >
                  <span>{w.title}</span>
                  <span className="count">{w.stories}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="dashed" onClick={() => setCreating(true)}>
            <span aria-hidden="true">＋</span> New world
          </button>
          <button type="button" className="plain home-link" onClick={nav.home}>
            ← Front page
          </button>
        </aside>

        <section className="ws-list" aria-label={world.title}>
          <header className="ws-title">
            <div>
              <h1>{world.title}</h1>
              <p className="muted">{world.tagline || "No tagline yet."}</p>
            </div>
            {!world.problem && (
              <button
                type="button"
                className="primary"
                disabled={busy || locked}
                onClick={play}
                title={
                  locked
                    ? "A story is open. Put it away first."
                    : latest
                      ? "Carry on with the latest story"
                      : "Start a story"
                }
              >
                {latest ? "Continue" : "Play"}
              </button>
            )}
          </header>

          {world.problem ? (
            <Panel title="This world can't be read">
              <p className="error">{world.problem}</p>
              <p className="hint">
                Fix <code>{name}/world.json</code> in your worlds folder and reload, or put the
                world away.
              </p>
              <button type="button" className="danger" onClick={() => setPutting(true)}>
                Put away
              </button>
            </Panel>
          ) : (
            <>
              <nav className="tabs-line" aria-label="World sections">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-current={tab === t.id ? "true" : undefined}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                    {t.id === "cards" && <span className="tab-count"> {cards.length}</span>}
                    {t.id === "stories" && <span className="tab-count"> {stories.length}</span>}
                  </button>
                ))}
              </nav>

              {tab === "cards" && (
                <CardList
                  cards={cards}
                  broken={broken}
                  selected={nav.card}
                  onSelect={(path) => {
                    setMaking(undefined);
                    nav.selectCard(path);
                  }}
                  onNew={(kind) => {
                    nav.selectCard(undefined);
                    setMaking(kind);
                  }}
                  onDialog={setDialog}
                />
              )}

              {tab === "stories" && (
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
                </>
              )}

              {tab === "world" && (
                <>
                  {detail.manifest && (
                    <WorldFacts manifest={detail.manifest} onEdit={() => setEditing(true)} />
                  )}
                  <div className="world-danger">
                    <button type="button" className="danger" onClick={() => setPutting(true)}>
                      Put away
                    </button>
                    <p className="hint">
                      Nothing is deleted: the folder is renamed, and renaming it back brings it
                      back.
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <section className="ws-editor" aria-label="Card">
          {tab === "cards" && selected && (
            <CardEditor
              key={selected.path}
              world={name}
              kind={selected.fm.kind}
              card={selected}
              all={cards}
              templates={templates}
              onSaved={() => void load()}
              onBack={() => nav.selectCard(undefined)}
              onDialog={setDialog}
            />
          )}
          {tab === "cards" && !selected && making && (
            <CardEditor
              key={`new-${making}`}
              world={name}
              kind={making}
              all={cards}
              templates={templates}
              onSaved={(path) => {
                setMaking(undefined);
                nav.selectCard(path);
                void load();
              }}
              onBack={() => setMaking(undefined)}
              onDialog={setDialog}
            />
          )}
          {!(tab === "cards" && editingCard) && (
            <div className="editor-empty">
              <p className="eyebrow quiet">Cards</p>
              <p>
                {cards.length === 0
                  ? "This world has no cards yet. Make a character, a place or a rule and the storyteller will use it."
                  : "Choose a card to read or change it, or make a new one."}
              </p>
              <p className="hint">
                Stories already begun keep their own copy of the cards, so changes here show up in
                stories you start afterwards.
              </p>
              {tab !== "cards" && (
                <button type="button" onClick={() => setTab("cards")}>
                  Go to the cards
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {dialog?.is === "text" && (
        <CardTextDialog
          world={name}
          {...dialog}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            void load();
          }}
        />
      )}
      {dialog?.is === "remove" && (
        <RemoveCard
          world={name}
          {...dialog}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            if (dialog.path === nav.card) nav.selectCard(undefined);
            void load();
          }}
        />
      )}
      {editing && (
        <EditWorld
          world={world}
          manifest={detail.manifest}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
            void act(api.worlds).then((w) => setWorlds(w ?? []));
          }}
        />
      )}
      {putting && (
        <PutAway
          world={world}
          onClose={() => setPutting(false)}
          onDone={() => {
            setPutting(false);
            nav.home();
          }}
        />
      )}
      {creating && (
        <CreateWorld
          onClose={() => setCreating(false)}
          onCreated={(w) => {
            setCreating(false);
            nav.open(w.name);
          }}
        />
      )}
    </div>
  );
}
