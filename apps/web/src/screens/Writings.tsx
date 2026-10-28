import { useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { Tip } from "../controls";
import { T } from "../i18n";
import { type Book, bookFromWriting, bookFromWritings } from "../reader/book";
import { Reader } from "../reader/Reader";
import type { WritingSummary } from "../types";
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
}: {
  /** The world's folder name, and its title for the cover. */
  world: { name: string; title: string };
  title: string;
  kind: "chapters" | "drafts";
  items: WritingSummary[];
}) {
  const { act, busy } = useAct();
  const [reading, setReading] = useState<Book>();

  const readOne = async (item: WritingSummary) => {
    const writing = await act(() => api.writing(world.name, item.path));
    if (writing)
      setReading(bookFromWriting(world, writing, kind === "chapters" ? "chapter" : "draft"));
  };
  const readAll = async () => {
    const all = await act(() => Promise.all(items.map((i) => api.writing(world.name, i.path))));
    if (all) setReading(bookFromWritings(world, all));
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
            {items.map((item) => (
              <li key={item.path} className="writing-row">
                <strong>{item.title}</strong>
                <small className="muted">
                  <Ago iso={item.updatedAt} /> · <T with={{ n: kb(item.size) }}>{"{n} KB"}</T>
                </small>
                <Tip text="Read it as a book">
                  <button type="button" disabled={busy} onClick={() => readOne(item)}>
                    <T>Read</T>
                  </button>
                </Tip>
              </li>
            ))}
          </ul>
        </>
      )}
      {reading && <Reader book={reading} onClose={() => setReading(undefined)} />}
    </section>
  );
}
