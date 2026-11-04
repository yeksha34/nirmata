import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { useAsk } from "../controls";
import { bilingual, T } from "../i18n";
import { useNav } from "../nav";
import { usePaged } from "../pager";
import { useDebounced } from "../use-debounced";
import type { AssetKind, VnAssetDatasetEntry, VnAssetItem, VnWithAssetsSummary } from "../types";

type Kind = AssetKind;

interface Run {
  asset: VnAssetItem;
  entries: VnAssetDatasetEntry[];
}

const BATCH = 6;

/**
 * Every archived render of a visual novel, or of one asset in it. Each run was kept, with its
 * prompt and the feedback that shaped the next one, when a new render replaced it.
 */
export function DatasetGallery() {
  const nav = useNav();
  const { act } = useAct();
  const ask = useAsk();
  const [vns, setVns] = useState<VnWithAssetsSummary[]>([]);
  const [items, setItems] = useState<VnAssetItem[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const world = nav.vnWorld || vns[0]?.worldName;
  const slug = nav.vnSlug || vns[0]?.slug;
  const type = nav.vnAssetType;
  const name = nav.vnAssetName;

  useEffect(() => {
    void act(api.allVns).then((v) => {
      setVns(v ?? []);
      if (v?.[0] && !nav.vnWorld && !nav.vnSlug) nav.toDataset(v[0].worldName, v[0].slug);
    });
  }, [act, nav]);

  useEffect(() => {
    if (!world || !slug) return;
    void act(() => api.vnAssets(world, slug)).then((res) => {
      setItems(res ? [...res.sprites, ...res.cgs, ...res.backgrounds] : []);
    });
  }, [act, world, slug]);

  // the runs on show: one asset's, or every asset's, fetched a few at a time
  useEffect(() => {
    if (!world || !slug) return;
    let live = true;
    const wanted = type && name ? items.filter((i) => i.type === type && i.name === name) : items;
    if (type && name && wanted.length === 0 && items.length > 0) {
      setRuns([]);
      return;
    }
    setLoading(true);
    void (async () => {
      const found: Run[] = [];
      for (let i = 0; i < wanted.length && live; i += BATCH) {
        const part = await Promise.all(
          wanted.slice(i, i + BATCH).map(async (asset) => {
            try {
              const d = await api.vnAssetDetail(world, slug, asset.type, asset.name);
              return { asset, entries: d.datasetHistory ?? [] };
            } catch {
              return { asset, entries: [] };
            }
          }),
        );
        found.push(...part.filter((p) => p.entries.length > 0));
      }
      if (live) {
        setRuns(found);
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [world, slug, type, name, items]);

  const query = useDebounced(search).trim().toLowerCase();
  const shown = useMemo(
    () =>
      runs
        .map((r) => ({
          ...r,
          entries: r.entries.filter(
            (e) =>
              !query ||
              e.prompt.toLowerCase().includes(query) ||
              Object.keys(e.feedback ?? {}).some((k) => k.toLowerCase().includes(query)),
          ),
        }))
        .filter((r) => r.entries.length > 0),
    [runs, query],
  );
  const pagedRuns = usePaged(shown, 5, query);
  const total = shown.reduce((n, r) => n + r.entries.length, 0);

  const deleteRun = async (assetName: string, entry: VnAssetDatasetEntry) => {
    if (!entry.imageUrl) return;
    const url = entry.imageUrl;
    const yes = await ask.confirm(
      "Delete this render of {name}? Its image file is removed and cannot be brought back.",
      { name: assetName },
      "Delete",
    );
    if (!yes) return;
    const done = await act(() => api.deleteDatasetRun(url));
    if (done) {
      setRuns((all) =>
        all.map((r) => ({ ...r, entries: r.entries.filter((e) => e.imageUrl !== url) })),
      );
    }
  };

  const vnValue = slug === "_all" || slug === "_shared" ? slug : `${world}:${slug}`;
  const pickVn = (value: string) => {
    if (!world) return;
    if (value === "_all" || value === "_shared") return nav.toDataset(world, value);
    const [w, ...rest] = value.split(":");
    if (w) nav.toDataset(w, rest.join(":"));
  };
  const assetValue = type && name ? `${type}:${name}` : "";
  const pickAsset = (value: string) => {
    if (!world || !slug) return;
    if (!value) return nav.toDataset(world, slug);
    const [t, ...rest] = value.split(":");
    nav.toDataset(world, slug, t as Kind, rest.join(":"));
  };

  return (
    <section className="vs ds">
      <header className="vs-top">
        <h1>
          <T>Dataset gallery</T>
        </h1>
        <form className="ds-filters">
          <label className="vs-pick">
            <small>
              <T>Visual novel</T>
            </small>
            <select
              value={vnValue}
              onChange={(e) => pickVn(e.target.value)}
              disabled={vns.length === 0}
            >
              <option value="_all">{bilingual("All assets")}</option>
              <option value="_shared">{bilingual("Shared pool")}</option>
              {vns.map((vn) => (
                <option key={`${vn.worldName}:${vn.slug}`} value={`${vn.worldName}:${vn.slug}`}>
                  {vn.worldTitle} — {vn.title || vn.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="vs-pick">
            <small>
              <T>Asset</T>
            </small>
            <select value={assetValue} onChange={(e) => pickAsset(e.target.value)}>
              <option value="">{bilingual("Every asset")}</option>
              {items.map((i) => (
                <option key={i.id} value={`${i.type}:${i.name}`}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="vs-pick">
            <small>
              <T>Find</T>
            </small>
            <input
              type="search"
              placeholder="Prompt or tag"
              aria-label="Find in prompts and tags"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </form>
      </header>

      <p className="vs-muted" aria-live="polite">
        {loading ? <T>Loading assets…</T> : `${total} ${bilingual("archived renders")}`}
      </p>

      {!loading && shown.length === 0 && (
        <p className="vs-card vs-muted">
          <T>No archived passes yet. Earlier renders are kept here automatically.</T>
        </p>
      )}

      {pagedRuns.items.map((r) => (
        <section key={r.asset.id} className="vs-card ds-group">
          <header className="ds-group-head">
            <h2 title={r.asset.name}>{r.asset.name}</h2>
            <small className="vs-count">{r.entries.length}</small>
            <button
              type="button"
              className="vs-btn"
              onClick={() => world && slug && nav.toVn(world, slug, r.asset.type, r.asset.name)}
            >
              <T>Open in studio</T>
            </button>
          </header>
          <ul className="ds-grid">
            {r.entries.map((e) => (
              <li key={e.timestamp} className="ds-run">
                {e.imageUrl ? (
                  <a href={e.imageUrl} target="_blank" rel="noreferrer" aria-label={e.timestamp}>
                    <img src={e.imageUrl} alt={e.timestamp} loading="lazy" />
                  </a>
                ) : (
                  <p className="vs-preview vs-muted">
                    <T>Not generated yet</T>
                  </p>
                )}
                <time>{e.timestamp}</time>
                {e.imageUrl && (
                  <button
                    type="button"
                    className="vs-btn"
                    onClick={() => void deleteRun(r.asset.name, e)}
                  >
                    <T>Delete</T>
                  </button>
                )}
                <p className="ds-prompt" title={e.prompt}>
                  {e.prompt}
                </p>
                {e.feedback && Object.keys(e.feedback).length > 0 && (
                  <ul className="ds-fb">
                    {Object.entries(e.feedback).map(([tag, choice]) => (
                      <li key={tag} data-choice={choice} title={tag}>
                        {choice === "better" ? "▲" : choice === "worse" ? "▼" : "●"} {tag}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {pagedRuns.pager}
    </section>
  );
}
