import { useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { Tip } from "../controls";
import { T } from "../i18n";
import { type Book, bookFromWriting, bookFromWritings } from "../reader/book";
import { Reader } from "../reader/Reader";
import type { VnManifest, VnSlideDeck, VnSummary, WritingSummary } from "../types";
import { VnPlayer } from "../vn/VnPlayer";
import { Ago } from "./world-parts";

/** A size in kilobytes, to the nearest one (a short file is "1"). */
const kb = (bytes: number): number => Math.max(1, Math.round(bytes / 1024));

/**
 * A world's chapters or its drafts: the prose that sits in the world's folder beside the cards.
 * Each can be read as a book; the chapters can also be read together, one after the other.
 */
export function Writings({
  world,
  title,
  kind,
  items,
  vns,
  onVnChange,
}: {
  /** The world's folder name, and its title for the cover. */
  world: { name: string; title: string };
  title: string;
  kind: "chapters" | "drafts";
  items: WritingSummary[];
  vns?: VnSummary[];
  onVnChange?: () => void;
}) {
  const { act, busy } = useAct();
  const [reading, setReading] = useState<Book>();
  const [playingVn, setPlayingVn] = useState<{
    manifest: VnManifest;
    slides: VnSlideDeck;
  } | null>(null);

  const readOne = async (item: WritingSummary) => {
    const writing = await act(() => api.writing(world.name, item.path));
    if (writing)
      setReading(bookFromWriting(world, writing, kind === "chapters" ? "chapter" : "draft"));
  };
  const readAll = async () => {
    const all = await act(() => Promise.all(items.map((i) => api.writing(world.name, i.path))));
    if (all) setReading(bookFromWritings(world, all));
  };

  const playOne = async (slug: string) => {
    const res = await act(() => api.vn(world.name, slug));
    if (res?.slides) {
      setPlayingVn({ manifest: res.manifest, slides: res.slides });
    }
  };

  const adaptOne = async (item: WritingSummary) => {
    const slug = item.path.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
    const res = await act(() =>
      api.scaffoldVn(world.name, {
        slug,
        title: item.title,
        source: item.path,
      }),
    );
    if (res && onVnChange) onVnChange();
  };

  const compileOne = async (slug: string) => {
    const res = await act(() => api.compileVn(world.name, slug));
    if (res && onVnChange) onVnChange();
  };

  return (
    <section className="writings" aria-label={title}>
      {items.length === 0 ? (
        <p className="empty">
          <T>
            {kind === "chapters"
              ? "No chapters in this world yet."
              : "No drafts in this world yet."}
          </T>
        </p>
      ) : (
        <>
          {kind === "chapters" && items.length > 1 && (
            <button type="button" className="primary read-all" disabled={busy} onClick={readAll}>
              <T>Read all the chapters</T>
            </button>
          )}
          <ul className="writing-rows">
            {items.map((item) => {
              const vn = vns?.find((v) => v.source === item.path);
              return (
                <li key={item.path} className="writing-row">
                  <strong>{item.title}</strong>
                  <small className="muted">
                    <Ago iso={item.updatedAt} /> · <T with={{ n: kb(item.size) }}>{"{n} KB"}</T>
                  </small>
                  {vn && (
                    <>
                      <Tip text="Visual novel adaptation with slides ready">
                        <data value={vn.slideCount ?? 0} className="tag vn-badge">
                          <T with={{ count: vn.slideCount ?? 0 }}>{"VN: {count} slides"}</T>
                        </data>
                      </Tip>
                      <Tip text="Play this visual novel in the browser">
                        <button
                          type="button"
                          className="primary"
                          disabled={busy}
                          onClick={() => playOne(vn.slug)}
                        >
                          <T>Play VN</T>
                        </button>
                      </Tip>
                    </>
                  )}
                  <Tip text="Read it as a book">
                    <button type="button" disabled={busy} onClick={() => readOne(item)}>
                      <T>Read</T>
                    </button>
                  </Tip>
                  {vn ? (
                    <Tip text="Compile visual novel slides">
                      <button type="button" disabled={busy} onClick={() => compileOne(vn.slug)}>
                        <T>Recompile VN</T>
                      </button>
                    </Tip>
                  ) : (
                    <Tip text="Adapt this prose into an interactive visual novel">
                      <button type="button" disabled={busy} onClick={() => adaptOne(item)}>
                        <T>Adapt to VN</T>
                      </button>
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {reading && <Reader book={reading} onClose={() => setReading(undefined)} />}
      {playingVn && (
        <VnPlayer
          world={world}
          manifest={playingVn.manifest}
          slides={playingVn.slides}
          onClose={() => setPlayingVn(null)}
        />
      )}
    </section>
  );
}
