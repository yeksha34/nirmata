import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { Breadcrumbs } from "../breadcrumbs";
import { Tip } from "../controls";
import { T } from "../i18n";
import { useNav } from "../nav";
import { type Book, bookFromWorld, bookFromWriting, bookFromWritings } from "../reader/book";
import { Reader } from "../reader/Reader";
import { SourceBadge } from "../source-badge";
import type {
  CardKind,
  VnManifest,
  VnSlideDeck,
  WorldDetail,
  WorldSummary,
  WritingSummary,
} from "../types";
import { Empty, Modal, Panel } from "../ui";
import { VnPlayer } from "../vn/VnPlayer";
import {
  CardEditor,
  CardList,
  inListOrder,
  CardTextDialog,
  type Dialog,
  RemoveCard,
  useTemplates,
  WorldFacts,
} from "./Manager";
import { AgentAccess } from "./agent-access";
import { WritingDetail, WritingsList } from "./Writings";
import {
  CreateWorld,
  EditWorld,
  OpenStoryNotice,
  PublishWorld,
  PutAway,
  StartStory,
  StoryRow,
} from "./world-parts";

type Tab = "cards" | "chapters" | "drafts" | "stories" | "world";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "cards", label: "Cards" },
  { id: "chapters", label: "Chapters" },
  { id: "drafts", label: "Drafts" },
  { id: "stories", label: "Stories" },
  { id: "world", label: "World" },
];

/**
 * One world, as a workspace: a slim rail of your worlds (a circle each), this world's cards and
 * stories, and the chosen card open for editing beside them. On a narrow screen the rail becomes a row
 * above, and the cards and the editor become one at a time. Nothing here opens the world; stories begun afterwards use the cards as saved.
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
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("cards");
  const [making, setMaking] = useState<CardKind>();
  const [dialog, setDialog] = useState<Dialog>();
  const [editing, setEditing] = useState(false);
  const [putting, setPutting] = useState(false);
  const [agentAccess, setAgentAccess] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [reading, setReading] = useState<Book>();
  const [selectedWriting, setSelectedWriting] = useState<string>();
  const [playingVn, setPlayingVn] = useState<{
    manifest: VnManifest;
    slides: VnSlideDeck;
    variables?: Record<string, number | boolean | string>;
  } | null>(null);

  const load = useCallback(
    () => act(() => api.worldDetail(name)).then((d) => setDetail(d ?? null)),
    [act, name],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const loadWorlds = useCallback(
    () => void act(api.worlds).then((w) => setWorlds(w ?? [])),
    [act],
  );
  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

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
      <Empty>
        <T>Opening the world…</T>
      </Empty>
    );
  if (detail === null)
    return (
      <>
        <button type="button" className="plain" onClick={nav.home}>
          <T>← All worlds</T>
        </button>
        <Empty>
          <T>This world could not be opened. The reason is shown above.</T>
        </Empty>
      </>
    );

  const { world, stories, cards, broken, chapters, drafts } = detail;
  const counts: Partial<Record<Tab, number>> = {
    cards: cards.length,
    chapters: chapters.length,
    drafts: drafts.length,
    stories: stories.length,
  };
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

  const currentWritings = tab === "chapters" ? chapters : drafts;
  const activeWriting =
    currentWritings.find((i) => i.path === selectedWriting) ?? currentWritings[0];

  const around = <X,>(list: X[], at: number, label: (x: X) => string, go: (x: X) => void) => {
    const pick = (x: X | undefined) => (x === undefined ? undefined : { label: label(x), onClick: () => go(x) });
    return at < 0 ? {} : { prev: pick(list[at - 1]), next: pick(list[at + 1]) };
  };
  const ordered = inListOrder(cards);
  const siblings =
    tab === "cards" && selected
      ? around(ordered, ordered.indexOf(selected), (c) => c.fm.name ?? c.path, (c) => nav.selectCard(c.path))
      : tab === "chapters" && activeWriting
        ? around(currentWritings, currentWritings.indexOf(activeWriting), (w) => w.title, (w) => setSelectedWriting(w.path))
        : {};

  const worldAt = worlds.findIndex((w) => w.name === name);
  const worldSiblings = around(worlds, worldAt, (w) => w.title, (w) => nav.open(w.name));

  const playVn = async (
    slug: string,
    carriedVariables?: Record<string, number | boolean | string>,
  ) => {
    const res = await act(() => api.vn(name, slug));
    if (res?.slides) {
      setPlayingVn({
        manifest: res.manifest,
        slides: res.slides,
        variables: carriedVariables,
      });
    }
  };

  const handleNextVn = (
    nextSlug: string,
    currentVariables: Record<string, number | boolean | string>,
  ) => {
    void playVn(nextSlug, currentVariables);
  };

  const adaptVn = async (item: WritingSummary) => {
    const slug = item.path.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
    const res = await act(() =>
      api.scaffoldVn(name, {
        slug,
        title: item.title,
        source: item.path,
        mode: "mode_1",
        tier: "short",
      }),
    );
    if (res) {
      void load();
      await playVn(slug);
    }
  };

  const compileVn = async (slug: string) => {
    const res = await act(() => api.compileVn(name, slug));
    if (res) {
      void load();
      await playVn(slug);
    }
  };

  const readWriting = async (item: WritingSummary) => {
    const writing = await act(() => api.writing(name, item.path));
    if (writing)
      setReading(
        bookFromWriting({ title: world.title }, writing, tab === "chapters" ? "chapter" : "draft"),
      );
  };

  const readAllChapters = async () => {
    const all = await act(() => Promise.all(chapters.map((i) => api.writing(name, i.path))));
    if (all) setReading(bookFromWritings({ name, title: world.title }, all));
  };

  return (
    <>
      <OpenStoryNotice />
      {!editingCard && (
        <header className="level-bar">
          <button type="button" className="back-pill" onClick={nav.home}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            <T>Worlds</T>
          </button>
          <Breadcrumbs
            worldTitle={world.title}
            chapterTitle={tab === "chapters" && activeWriting ? activeWriting.title : undefined}
            chapterSlug={
              tab === "chapters" && activeWriting
                ? activeWriting.path.replace(/\.md$/, "").split("/").pop()
                : undefined
            }
            subView={tab === "chapters" ? nav.chapterView : undefined}
            {...(tab === "chapters" && activeWriting ? siblings : worldSiblings)}
          />
        </header>
      )}
      <div className="ws" data-editing={editingCard ? "true" : "false"}>

        <section className="ws-list" aria-label={world.title}>
          <header className="ws-title">
            <hgroup>
              <h1>
                {world.title}
                {detail.cardSource && <SourceBadge source={detail.cardSource} />}
              </h1>
              <p className="muted">{world.tagline || <T>No tagline yet.</T>}</p>
            </hgroup>
            {!world.problem && (
              <menu className="title-actions">
                <li>
                  <Tip below text="Tokens that let an agent import or adapt this world">
                    <button type="button" onClick={() => setAgentAccess(true)}>
                      <T>Agent access</T>
                    </button>
                  </Tip>
                </li>
                <li>
                  <Tip below text="Freeze the cards into a version that visual novels and readers use">
                    <button type="button" disabled={busy} onClick={() => setPublishing(true)}>
                      <T>Publish</T>
                    </button>
                  </Tip>
                </li>
                {cards.length > 0 && (
                  <li>
                    <Tip below text="Read it as a book">
                      <button
                        type="button"
                        onClick={() =>
                          setReading(bookFromWorld({ ...world, ...detail.manifest, name }, cards))
                        }
                      >
                        <T>Read</T>
                      </button>
                    </Tip>
                  </li>
                )}
                <li>
                  <Tip
                    below
                    text={
                      locked
                        ? "A story is open. Put it away first."
                        : latest
                          ? "Carry on with the latest story"
                          : "Start a story"
                    }
                  >
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || locked}
                      onClick={play}
                    >
                      <T>{latest ? "Continue" : "Play"}</T>
                    </button>
                  </Tip>
                </li>
              </menu>
            )}
          </header>

          {world.problem ? (
            <Panel title="This world can't be read">
              <p className="error">
                <T>{world.problem}</T>
              </p>
              <p className="hint">
                <T with={{ file: <code>{name}/world.json</code> }}>
                  {"Fix {file} in your worlds folder and reload, or put the world away."}
                </T>
              </p>
              <button type="button" className="danger" onClick={() => setPutting(true)}>
                <T>Put away</T>
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
                    <T>{t.label}</T>
                    {counts[t.id] !== undefined && (
                      <data className="tab-count" value={counts[t.id]}>
                        {" "}
                        {counts[t.id]}
                      </data>
                    )}
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

              {tab === "chapters" && (
                <WritingsList
                  title="Chapters"
                  kind="chapters"
                  items={chapters}
                  vns={detail.vns}
                  selected={activeWriting?.path}
                  onSelect={setSelectedWriting}
                  onReadAll={readAllChapters}
                  busy={busy}
                />
              )}

              {tab === "drafts" && (
                <WritingsList
                  title="Drafts"
                  kind="drafts"
                  items={drafts}
                  vns={detail.vns}
                  selected={activeWriting?.path}
                  onSelect={setSelectedWriting}
                  busy={busy}
                />
              )}

              {tab === "stories" && (
                <>
                  <StartStory name={name} arcs={arcs} locked={locked} />
                  <Panel title="Saved stories">
                    {stories.length === 0 ? (
                      <Empty>
                        <T with={{ title: world.title }}>
                          {"No stories in {title} yet. Start one above."}
                        </T>
                      </Empty>
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
                  <section className="world-danger">
                    <button type="button" className="danger" onClick={() => setPutting(true)}>
                      <T>Put away</T>
                    </button>
                    <p className="hint">
                      <T>
                        Nothing is deleted: the folder is renamed, and renaming it back brings it
                        back.
                      </T>
                    </p>
                  </section>
                </>
              )}
            </>
          )}
        </section>

        <section className="ws-editor" aria-label="Card">
          {tab === "cards" && selected && (
            <header className="level-bar">
              <button type="button" className="back-pill" onClick={() => nav.selectCard(undefined)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
                <T>World · Cards</T>
              </button>
              <Breadcrumbs worldTitle={world.title} cardName={selected.fm.name} {...siblings} />
            </header>
          )}
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
          {(tab === "chapters" || tab === "drafts") && activeWriting && (
            <WritingDetail
              key={activeWriting.path}
              world={{ name, title: world.title }}
              kind={tab}
              item={activeWriting}
              vn={detail.vns?.find((v) => v.source === activeWriting.path)}
              busy={busy}
              onPlayVn={playVn}
              onRead={readWriting}
              onAdaptVn={adaptVn}
              onCompileVn={compileVn}
            />
          )}
          {(tab === "chapters" || tab === "drafts") && !activeWriting && (
            <section className="editor-empty">
              <p className="eyebrow quiet">
                <T>{tab === "chapters" ? "Chapters" : "Drafts"}</T>
              </p>
              <p>
                <T>Choose a writing to read or inspect</T>
              </p>
            </section>
          )}
          {tab === "cards" && !editingCard && (
            <section className="editor-empty">
              <p className="eyebrow quiet">
                <T>Cards</T>
              </p>
              <p>
                <T>
                  {cards.length === 0
                    ? "This world has no cards yet. Make a character, a place or a rule and the storyteller will use it."
                    : "Choose a card to read or change it, or make a new one."}
                </T>
              </p>
              <p className="hint">
                <T>
                  Stories already begun keep their own copy of the cards, so changes here show up in
                  stories you start afterwards.
                </T>
              </p>
            </section>
          )}
          {tab !== "cards" && tab !== "chapters" && tab !== "drafts" && (
            <section className="editor-empty">
              <p className="eyebrow quiet">
                <T>Cards</T>
              </p>
              <p>
                <T>Choose a card to read or change it, or make a new one.</T>
              </p>
              <button type="button" onClick={() => setTab("cards")}>
                <T>Go to the cards</T>
              </button>
            </section>
          )}
        </section>
      </div>

      {reading && <Reader book={reading} onClose={() => setReading(undefined)} />}
      {playingVn && (
        <VnPlayer
          key={playingVn.manifest.slug}
          world={{ name, title: world.title }}
          manifest={playingVn.manifest}
          slides={playingVn.slides}
          initialVariables={playingVn.variables}
          nextVnTitle={
            playingVn.manifest.nextSlug
              ? detail?.vns?.find((v) => v.slug === playingVn.manifest.nextSlug)?.title
              : undefined
          }
          onNextVn={handleNextVn}
          onClose={() => setPlayingVn(null)}
        />
      )}
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
            loadWorlds();
          }}
        />
      )}
      {publishing && <PublishWorld world={world} onClose={() => setPublishing(false)} />}
      {agentAccess && (
        <Modal titleId="agent-access-title" wide onClose={() => setAgentAccess(false)}>
          <AgentAccess world={name} titleId="agent-access-title" />
          <footer className="dialog-actions">
            <button type="button" onClick={() => setAgentAccess(false)}>
              <T>Done</T>
            </button>
          </footer>
        </Modal>
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
    </>
  );
}
