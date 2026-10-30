import { useEffect, useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { Tip } from "../controls";
import { T } from "../i18n";
import type { VnSummary, WritingSummary } from "../types";
import { Ago } from "./world-parts";

/** A size in kilobytes, to the nearest one (a short file is "1"). */
export const kb = (bytes: number): number => Math.max(1, Math.round(bytes / 1024));

/**
 * List of a world's chapters or drafts for the navigation column.
 * Cards are clickable to select and view details in the editor pane.
 */
export function WritingsList({
  title,
  kind,
  items,
  vns,
  selected,
  onSelect,
  onReadAll,
  busy,
}: {
  title: string;
  kind: "chapters" | "drafts";
  items: WritingSummary[];
  vns?: VnSummary[];
  selected?: string;
  onSelect: (path: string) => void;
  onReadAll?: () => void;
  busy?: boolean;
}) {
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
          {kind === "chapters" && items.length > 1 && onReadAll && (
            <button type="button" className="primary read-all" disabled={busy} onClick={onReadAll}>
              <T>Read all the chapters</T>
            </button>
          )}
          <ul className="writing-rows">
            {items.map((item) => {
              const vn = vns?.find((v) => v.source === item.path);
              const isSelected = selected === item.path;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    className={`writing-row ${isSelected ? "selected" : ""}`}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onSelect(item.path)}
                  >
                    <header className="writing-row-head">
                      <strong>{item.title}</strong>
                      {vn && (
                        <data value={vn.slideCount ?? 0} className="tag vn-badge">
                          <T with={{ count: vn.slideCount ?? 0 }}>{"VN: {count} slides"}</T>
                        </data>
                      )}
                    </header>
                    <small className="muted">
                      <Ago iso={item.updatedAt} /> · <T with={{ n: kb(item.size) }}>{"{n} KB"}</T>
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Details and action panel for the chosen chapter or draft, displayed in the right editor column.
 */
export function WritingDetail({
  world,
  kind,
  item,
  vn,
  busy,
  onPlayVn,
  onRead,
  onAdaptVn,
  onCompileVn,
}: {
  world: { name: string; title: string };
  kind: "chapters" | "drafts";
  item: WritingSummary;
  vn?: VnSummary;
  busy?: boolean;
  onPlayVn: (slug: string) => void;
  onRead: (item: WritingSummary) => void;
  onAdaptVn: (item: WritingSummary) => void;
  onCompileVn: (slug: string) => void;
}) {
  const { act } = useAct();
  const [content, setContent] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void act(() => api.writing(world.name, item.path)).then((res) => {
      if (!cancelled) {
        setContent(res?.text);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [world.name, item.path, act]);

  return (
    <article className="writing-detail">
      <header className="writing-detail-header">
        <p className="eyebrow quiet">
          <T>{kind === "chapters" ? "Chapter" : "Draft"}</T>
        </p>
        <h2>{item.title}</h2>
        <p className="muted">
          {item.path} · <Ago iso={item.updatedAt} /> · <T with={{ n: kb(item.size) }}>{"{n} KB"}</T>
        </p>
      </header>

      <menu className="writing-detail-actions">
        {vn && (
          <>
            <Tip text="Play this visual novel in the browser">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => onPlayVn(vn.slug)}
              >
                <T>Play VN</T>
              </button>
            </Tip>
            <Tip text="Compile visual novel slides">
              <button type="button" disabled={busy} onClick={() => onCompileVn(vn.slug)}>
                <T>Recompile VN</T>
              </button>
            </Tip>
          </>
        )}
        {!vn && (
          <Tip text="Adapt this prose into an interactive visual novel">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onAdaptVn(item)}
            >
              <T>Adapt to VN</T>
            </button>
          </Tip>
        )}
        <Tip text="Read it as a book">
          <button type="button" disabled={busy} onClick={() => onRead(item)}>
            <T>Read</T>
          </button>
        </Tip>
      </menu>

      {vn && (
        <section className="writing-vn-box">
          <header className="vn-box-header">
            <strong>
              <T>Visual novel</T>
            </strong>
            : {vn.title || vn.slug}
          </header>
          <ul className="vn-meta-list">
            <li>
              <strong>
                <T>Slides</T>:
              </strong>{" "}
              {vn.slideCount ?? 0}
            </li>
            <li>
              <strong>
                <T>Mode</T>:
              </strong>{" "}
              {vn.mode ?? "mode_1"}
            </li>
            <li>
              <strong>
                <T>Protagonist</T>:
              </strong>{" "}
              {vn.mc ?? "Protagonist"}
            </li>
            <li>
              <strong>
                <T>Routes</T>:
              </strong>{" "}
              {vn.routes?.join(", ") ?? "common"}
            </li>
          </ul>
        </section>
      )}

      <section className="writing-preview-box">
        <header className="preview-header">
          <strong>
            <T>Preview</T>
          </strong>
        </header>
        {loading ? (
          <p className="quiet">
            <T>Loading preview…</T>
          </p>
        ) : (
          <pre className="writing-preview-text">{content || ""}</pre>
        )}
      </section>
    </article>
  );
}
