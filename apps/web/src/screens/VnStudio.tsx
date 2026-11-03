import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api";
import { useAct } from "../app-context";
import { bilingual, T } from "../i18n";
import { isActive, type JobsState, jobForAsset, jobsActions } from "../jobs/store";
import { useNav } from "../nav";
import type {
  GenerateAssetInput,
  AssetKind,
  GenerationJob,
  VnAssetDatasetEntry,
  VnAssetDetail,
  VnAssetItem,
  VnWithAssetsSummary,
} from "../types";

type Choice = "better" | "keep" | "worse";
interface SavedPrompt {
  positivePrompt: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

type Filter = "all" | "shared" | AssetKind;

const CHOICES: Array<{ id: Choice; mark: string; label: string }> = [
  { id: "better", mark: "▲", label: "Better" },
  { id: "keep", mark: "●", label: "Keep" },
  { id: "worse", mark: "▼", label: "Worse" },
];

const KIND_LABEL: Record<AssetKind, string> = {
  sprite: "Sprites",
  cg: "Event CGs",
  bg: "Backgrounds",
  clothes: "Clothes",
  adornment: "Adornments",
  object: "Objects",
};

/** Clothes and adornments are locked to one character (the unclad base `naked` is the exception); objects link to characters and/or CGs. */
function lockLabel(item: VnAssetItem): string | null {
  if (item.type !== "clothes" && item.type !== "adornment" && item.type !== "object") return null;
  const to = [...(item.lockedTo ?? []), ...(item.linkedCgs ?? [])];
  if (to.length > 0) return to.join(", ");
  return /(^|_)naked$/i.test(item.name) && item.type !== "object" ? "" : null;
}

const baseTag = (tag: string) =>
  (tag.replace(/^\(+/, "").replace(/\)+$/, "").split(":")[0] ?? "").trim();

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the render is doing now, stage by stage and node by node, straight from ComfyUI. */
function JobStatus({ job, onCancel }: { job: GenerationJob; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  const active = isActive(job);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const counted = job.nodes.filter((n) => n.state !== "cached");
  const finished = counted.filter((n) => n.state === "done").length;
  const current = job.nodes.find((n) => n.state === "active");

  return (
    <section className="vs-card vs-job" aria-live="polite">
      <header className="vs-job-head">
        <strong className={`vs-job-state vs-${job.state}`}>
          <T>
            {job.state === "done"
              ? "Done"
              : job.state === "error"
                ? "Failed"
                : job.state === "cancelled"
                  ? "Cancelled"
                  : "Working"}
          </T>
        </strong>
        <small className="vs-muted">
          {elapsed((active ? now : job.updatedAt) - job.startedAt)}
        </small>
        {active && (
          <button type="button" className="vs-btn vs-btn-quiet" onClick={onCancel}>
            <T>Cancel</T>
          </button>
        )}
      </header>

      <ol className="vs-stages">
        {job.stages.map((s) => (
          <li key={s.id} data-state={s.state}>
            <T>{s.label}</T>
            {s.id === "queue" && s.state === "active" && job.queuePosition
              ? ` · #${job.queuePosition}`
              : ""}
          </li>
        ))}
      </ol>

      {job.nodes.length > 0 && (
        <>
          <p className="vs-meter">
            <small>
              {current ? current.title : <T>Workflow steps</T>}
              {job.progress ? ` · ${job.progress.value}/${job.progress.max}` : ""}
            </small>
            {job.progress && <progress max={job.progress.max} value={job.progress.value} />}
          </p>
          <p className="vs-meter">
            <small>
              <T>Workflow</T> {finished}/{counted.length}
            </small>
            <progress max={Math.max(1, counted.length)} value={finished} />
          </p>
          <details className="vs-nodes">
            <summary>
              <T>All steps</T>
            </summary>
            <ol>
              {job.nodes.map((n) => (
                <li key={n.id} data-state={n.state}>
                  {n.title}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      {job.error && <p className="vs-error">{bilingual(job.error)}</p>}
    </section>
  );
}

export function VnStudio() {
  const nav = useNav();
  const { act } = useAct();
  const dispatch = useDispatch();
  const jobsState = useSelector((s: JobsState) => s);
  // the latest nav, for effects that must not run again just because the selection moved
  const navRef = useRef(nav);
  navRef.current = nav;

  const [allVns, setAllVns] = useState<VnWithAssetsSummary[]>([]);
  const [assets, setAssets] = useState<{
    sprites: VnAssetItem[];
    cgs: VnAssetItem[];
    backgrounds: VnAssetItem[];
    clothes: VnAssetItem[];
    adornments: VnAssetItem[];
    objects: VnAssetItem[];
  } | null>(null);

  const activeWorld = nav.vnWorld || allVns[0]?.worldName;
  const activeSlug = nav.vnSlug || allVns[0]?.slug;
  const activeType: AssetKind = nav.vnAssetType || "sprite";
  const activeName = nav.vnAssetName;

  const [detail, setDetail] = useState<VnAssetDetail | null>(null);
  const [positivePrompt, setPositivePrompt] = useState("");
  const [references, setReferences] = useState<string[]>([]);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(22);
  const [cfg, setCfg] = useState(7.5);
  const [sampler, setSampler] = useState("dpmpp_2m");
  const [scheduler, setScheduler] = useState("karras");
  const [seed, setSeed] = useState<number | undefined>(undefined);

  const [assetSearch, setAssetSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Filter>("all");

  const [selectedBadges, setSelectedBadges] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, Choice>>({});
  const [newTagInput, setNewTagInput] = useState("");

  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<VnAssetDatasetEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "failed">("");

  const job = jobForAsset(jobsState, activeWorld, activeType, activeName);
  // the latest few, to restore from here; the dataset gallery holds them all
  const recent = useMemo(
    () => [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6),
    [history],
  );
  const generating = jobsState.starting || (job ? isActive(job) : false);

  // pick the jobs back up after a refresh
  useEffect(() => {
    dispatch(jobsActions.hydrate());
  }, [dispatch]);

  useEffect(() => {
    void act(api.allVns).then((v) => {
      setAllVns(v ?? []);
      const here = navRef.current;
      if (v && v.length > 0 && v[0] && !here.vnWorld && !here.vnSlug) {
        here.toVn(v[0].worldName, v[0].slug);
      }
    });
  }, [act]);

  const loadAssets = useCallback(async () => {
    if (!activeWorld || !activeSlug) return;
    const res = await act(() => api.vnAssets(activeWorld, activeSlug));
    setAssets(res ?? null);
    return res;
  }, [act, activeWorld, activeSlug]);

  // the list of assets belongs to the visual novel, so it is read when that changes, not for each asset picked
  useEffect(() => {
    void loadAssets().then((res) => {
      const here = navRef.current;
      if (res && !here.vnAssetName && activeWorld && activeSlug) {
        const first = res.sprites[0] || res.cgs[0] || res.backgrounds[0];
        if (first) here.toVn(activeWorld, activeSlug, first.type, first.name);
      }
    });
  }, [loadAssets, activeWorld, activeSlug]);

  const selection = `${activeWorld}|${activeSlug}|${activeType}|${activeName}`;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /** Back to a blank form, so nothing of the asset that was open shows while the next one loads. */
  const blankForm = useCallback(() => {
    setDetail(null);
    setPreviewUrl(undefined);
    setHistory([]);
    setPositivePrompt("");
    setNegativePrompt("");
    setSteps(22);
    setCfg(7.5);
    setSampler("dpmpp_2m");
    setScheduler("karras");
    setSeed(undefined);
    setSelectedBadges([]);
    setFeedback({});
    setReferences([]);
    setMessage("");
    setSaveStatus("");
  }, []);

  const loadDetail = useCallback(
    async (resetForm: boolean) => {
      if (!activeWorld || !activeSlug || !activeName) return;
      const asked = `${activeWorld}|${activeSlug}|${activeType}|${activeName}`;
      const d = await act(() => api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName));
      // another asset was picked while this one loaded: its answer must not fill the form
      if (selectionRef.current !== asked) return;
      if (resetForm) setLoadingDetail(false);
      if (!d) return;
      setDetail(d);
      setPreviewUrl(d.url);
      setHistory(d.datasetHistory || []);
      if (resetForm) {
        setPositivePrompt(d.positivePrompt);
        setNegativePrompt(d.negativePrompt);
        setSteps(d.steps ?? 22);
        setCfg(d.cfg ?? 7.5);
        setSampler(d.sampler ?? "dpmpp_2m");
        setScheduler(d.scheduler ?? "karras");
        setSeed(d.seed);
        setSelectedBadges([]);
        setFeedback({});
        setReferences(d.references?.suggested ?? []);
        setMessage("");
      }
    },
    [act, activeWorld, activeSlug, activeType, activeName],
  );

  // ---- keeping what the author types ----
  // Edits are saved a moment after the last keystroke, to the asset they were made on. Picking another
  // asset saves any edit still waiting before the form is cleared.
  const edited = useRef(false);
  const waiting = useRef<{ target: [string, string, AssetKind, string]; body: SavedPrompt } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveNow = useCallback(async () => {
    clearTimeout(timer.current);
    const job = waiting.current;
    waiting.current = null;
    if (!job) return;
    const [w, v, t, n] = job.target;
    const key = `${w}|${v}|${t}|${n}`;
    if (selectionRef.current === key) setSaveStatus("saving");
    try {
      await api.saveAssetPrompt(w, v, t, n, job.body);
      if (selectionRef.current === key) setSaveStatus("saved");
    } catch {
      if (selectionRef.current === key) setSaveStatus("failed");
    }
  }, []);

  /** Called by the controls the author changes, not when a form is filled in from the server. */
  const markEdited = () => {
    edited.current = true;
  };

  // The asset on show, read when an edit is made. It is not a dependency of the effect below: picking
  // another asset must not count as an edit, or the old asset's text would be saved onto the new one.
  const target = useRef<[string, string, AssetKind, string] | null>(null);
  target.current =
    activeWorld && activeSlug && activeName
      ? [activeWorld, activeSlug, activeType, activeName]
      : null;

  useEffect(() => {
    if (!edited.current || !target.current) return;
    waiting.current = {
      target: target.current,
      body: { positivePrompt, negativePrompt, steps, cfg, sampler, scheduler },
    };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), 800);
  }, [positivePrompt, negativePrompt, steps, cfg, sampler, scheduler, saveNow]);

  // leaving the page saves what is waiting
  useEffect(() => () => void saveNow(), [saveNow]);

  useEffect(() => {
    // a new asset was picked: save any edit still waiting, clear the form, then load the new one
    void saveNow();
    edited.current = false;
    blankForm();
    if (activeWorld && activeSlug && activeName) setLoadingDetail(true);
    void loadDetail(true);
  }, [loadDetail, blankForm, saveNow, activeWorld, activeSlug, activeName]);

  // When a render this page watched ends, show its result. A job that was already over when the
  // page opened only refreshes the picture and history; it does not overwrite what is being edited.
  const watched = useRef(new Set<string>());
  useEffect(() => {
    if (!job) return;
    if (isActive(job)) {
      watched.current.add(job.id);
      return;
    }
    if (job.state === "done" && job.result && watched.current.has(job.id)) {
      watched.current.delete(job.id);
      setPreviewUrl(job.result.assetUrl);
      setPositivePrompt(job.result.positivePrompt);
      setNegativePrompt(job.result.negativePrompt);
      setSelectedBadges([]);
      setFeedback({});
      void loadDetail(false);
      void loadAssets();
    }
  }, [job, loadDetail, loadAssets]);

  const query = assetSearch.trim().toLowerCase();
  const matches = useCallback(
    (item: VnAssetItem) =>
      !query ||
      item.name.toLowerCase().includes(query) ||
      (item.defaultPrompt ? item.defaultPrompt.toLowerCase().includes(query) : false),
    [query],
  );

  const groups = useMemo(() => {
    if (!assets) return [];
    const pick = (kind: AssetKind, list: VnAssetItem[]) => {
      if (typeFilter === "shared") return list.filter((i) => i.isShared && matches(i));
      if (typeFilter !== "all" && typeFilter !== kind) return [];
      return list.filter(matches);
    };
    return [
      { kind: "sprite" as const, items: pick("sprite", assets.sprites) },
      { kind: "cg" as const, items: pick("cg", assets.cgs) },
      { kind: "bg" as const, items: pick("bg", assets.backgrounds) },
      { kind: "clothes" as const, items: pick("clothes", assets.clothes ?? []) },
      { kind: "adornment" as const, items: pick("adornment", assets.adornments ?? []) },
      { kind: "object" as const, items: pick("object", assets.objects ?? []) },
    ].filter((g) => g.items.length > 0);
  }, [assets, typeFilter, matches]);

  const totalVisible = groups.reduce((n, g) => n + g.items.length, 0);

  const parsedTags = useMemo(
    () => [
      ...new Set(
        positivePrompt
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
    [positivePrompt],
  );

  const toggleBadge = (tag: string) => {
    const clean = baseTag(tag);
    if (selectedBadges.includes(clean)) {
      setSelectedBadges((prev) => prev.filter((b) => b !== clean));
      setFeedback((prev) => {
        const next = { ...prev };
        delete next[clean];
        return next;
      });
    } else {
      setSelectedBadges((prev) => [...prev, clean]);
      setFeedback((prev) => ({ ...prev, [clean]: "keep" }));
    }
  };

  const handleAddCustomTag = () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    markEdited();
    setPositivePrompt((prev) => (prev ? `${prev}, ${trimmed}` : trimmed));
    setSelectedBadges((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setFeedback((prev) => ({ ...prev, [trimmed]: "better" }));
    setNewTagInput("");
  };

  const handleRestoreRun = (entry: VnAssetDatasetEntry) => {
    markEdited();
    if (entry.prompt) setPositivePrompt(entry.prompt);
    if (entry.negativePrompt) setNegativePrompt(entry.negativePrompt);
    if (entry.imageUrl) setPreviewUrl(entry.imageUrl);
    if (entry.feedback) {
      setFeedback(entry.feedback);
      setSelectedBadges(Object.keys(entry.feedback));
    }
  };

  const handleGenerate = () => {
    if (!activeWorld || !activeSlug || !activeName) return;
    const selectedItem = assets
      ? [
          ...assets.sprites,
          ...assets.cgs,
          ...assets.backgrounds,
          ...(assets.clothes ?? []),
          ...(assets.adornments ?? []),
          ...(assets.objects ?? []),
        ].find(
          (a) => a.name === activeName && a.type === activeType,
        )
      : null;
    const targetSlug =
      selectedItem?.vnSlug ||
      (selectedItem?.isShared ? "_shared" : activeSlug === "_all" ? "_shared" : activeSlug);
    const payload: GenerateAssetInput = {
      type: activeType,
      name: activeName,
      targetPath: detail?.targetPath,
      positivePrompt,
      negativePrompt,
      steps,
      cfg,
      sampler,
      scheduler,
      seed: seed ?? Math.floor(Math.random() * 1000000),
      feedback,
      ...((activeType === "sprite" || activeType === "cg") && references.length > 0 ? { references } : {}),
    };
    setMessage("");
    dispatch(jobsActions.start(activeWorld, targetSlug, payload));
  };

  const run = async (work: () => Promise<string | undefined>) => {
    try {
      const text = await work();
      if (text) setMessage(text);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const refreshAfterChange = async () => {
    await Promise.all([loadAssets(), loadDetail(false)]);
  };

  const handleArchiveOne = () =>
    run(async () => {
      if (!activeWorld || !activeSlug || !activeName) return;
      const res = await act(() =>
        api.archiveOneVnAsset(activeWorld, activeSlug, activeType, activeName),
      );
      if (!res?.ok) return;
      await loadDetail(false);
      return bilingual("Archived to dataset history.");
    });

  const handleDeleteOne = () =>
    run(async () => {
      if (!activeWorld || !activeSlug || !activeName) return;
      if (!window.confirm(`Delete rendered file for ${activeName}? It will be reset to Pending.`))
        return;
      const res = await act(() =>
        api.deleteOneVnAsset(activeWorld, activeSlug, activeType, activeName),
      );
      if (!res?.ok) return;
      setPreviewUrl(undefined);
      await refreshAfterChange();
      return bilingual("Deleted {name}; back to Pending.", { name: activeName });
    });

  const handleArchiveAll = () =>
    run(async () => {
      if (!activeWorld || !activeSlug) return;
      const res = await act(() => api.archiveAllVnAssets(activeWorld, activeSlug));
      if (!res?.ok) return;
      await loadDetail(false);
      return bilingual("Archived {count} assets.", { count: res.archivedCount });
    });

  const handleDeleteAll = () =>
    run(async () => {
      if (!activeWorld || !activeSlug) return;
      if (
        !window.confirm(
          `Delete all rendered assets for ${activeSlug}? They will be reset to Pending.`,
        )
      )
        return;
      const res = await act(() => api.deleteAllVnAssets(activeWorld, activeSlug));
      if (!res?.ok) return;
      setPreviewUrl(undefined);
      await refreshAfterChange();
      return bilingual("Deleted {count} rendered files.", { count: res.deletedCount });
    });

  const vnValue =
    activeSlug === "_all" || activeSlug === "_shared" ? activeSlug : `${activeWorld}:${activeSlug}`;
  const onPickVn = (value: string) => {
    if (!activeWorld) return;
    if (value === "_all" || value === "_shared") return nav.toVn(activeWorld, value);
    const [world, ...rest] = value.split(":");
    if (world) nav.toVn(world, rest.join(":"));
  };

  return (
    <section className="vs">
      <header className="vs-top">
        <h1>
          <T>Asset Studio</T>
        </h1>
        <label className="vs-pick">
          <small>
            <T>Visual novel</T>
          </small>
          <select
            value={vnValue}
            onChange={(e) => onPickVn(e.target.value)}
            disabled={allVns.length === 0}
          >
            <option value="_all">{bilingual("All assets")}</option>
            <option value="_shared">{bilingual("Shared pool")}</option>
            {allVns.map((vn) => (
              <option key={`${vn.worldName}:${vn.slug}`} value={`${vn.worldName}:${vn.slug}`}>
                {vn.worldTitle} — {vn.title || vn.slug}
              </option>
            ))}
          </select>
        </label>
      </header>

      {allVns.length === 0 && (
        <p className="vs-muted">
          <T>No visual novels found. Adapt a chapter first.</T>
        </p>
      )}

      <section className="vs-layout">
        {/* ---- asset list ---- */}
        <aside className="vs-list vs-card">
          <form
            className="vs-search"
            onSubmit={(e) => {
              e.preventDefault();
              const first = groups[0]?.items[0];
              if (first && activeWorld && activeSlug)
                nav.toVn(activeWorld, activeSlug, first.type, first.name);
            }}
          >
            <input
              type="search"
              placeholder="Search assets"
              aria-label="Search assets"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
            />
            <select
              aria-label="Show"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as Filter)}
            >
              <option value="all">{bilingual("All")}</option>
              <option value="shared">{bilingual("Shared")}</option>
              <option value="sprite">{bilingual("Sprites")}</option>
              <option value="cg">{bilingual("Event CGs")}</option>
              <option value="bg">{bilingual("Backgrounds")}</option>
              <option value="clothes">{bilingual("Clothes")}</option>
              <option value="adornment">{bilingual("Adornments")}</option>
              <option value="object">{bilingual("Objects")}</option>
            </select>
          </form>

          <nav className="vs-scroll">
            {!assets ? (
              <p className="vs-muted">
                <T>Loading assets…</T>
              </p>
            ) : totalVisible === 0 ? (
              <p className="vs-muted">
                <T>Nothing matches.</T>
              </p>
            ) : (
              groups.map((g) => (
                <section key={g.kind}>
                  <h3 className="vs-group">
                    <T>{KIND_LABEL[g.kind]}</T> <small>{g.items.length}</small>
                  </h3>
                  <ul>
                    {g.items.map((item) => {
                      const running = Object.values(jobsState.byId).some(
                        (j) => isActive(j) && j.type === item.type && j.name === item.name,
                      );
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="vs-item"
                            aria-current={activeType === item.type && activeName === item.name}
                            onClick={() =>
                              activeWorld &&
                              activeSlug &&
                              nav.toVn(activeWorld, activeSlug, item.type, item.name)
                            }
                          >
                            <small className="vs-item-name" title={item.name}>
                              {item.name}
                            </small>
                            <small className="vs-item-meta">
                              {item.isShared && <em>shared</em>}
                              {lockLabel(item) !== null &&
                                (lockLabel(item) ? (
                                  <em title={bilingual("Locked to")}>🔒 {lockLabel(item)}</em>
                                ) : (
                                  <em>{bilingual("Base")}</em>
                                ))}
                              {lockLabel(item) === null &&
                                item.type !== "sprite" &&
                                item.type !== "cg" &&
                                item.type !== "bg" && <em>{bilingual("Not linked yet")}</em>}
                              {item.vnSlug &&
                                item.vnSlug !== "_shared" &&
                                activeSlug === "_all" && <em>{item.vnSlug}</em>}
                              <i data-on={running ? "running" : item.exists ? "done" : "pending"}>
                                {running ? "…" : item.exists ? "✓" : "○"}
                              </i>
                            </small>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </nav>

          <details className="vs-menu">
            <summary>
              <T>Batch actions</T>
            </summary>
            <nav className="vs-menu-body">
              <button type="button" className="vs-btn" onClick={handleArchiveAll}>
                <T>Archive all</T>
              </button>
              <button type="button" className="vs-btn vs-btn-danger" onClick={handleDeleteAll}>
                <T>Delete all</T>
              </button>
            </nav>
          </details>
        </aside>

        {/* ---- workspace ---- */}
        <main className="vs-main">
          {!activeName ? (
            <p className="vs-card vs-muted">
              <T>Select an asset from the list to edit its prompt and generate it.</T>
            </p>
          ) : (
            <>
              <header className="vs-asset-head">
                <hgroup>
                  <p className="vs-kicker">
                    <T>{KIND_LABEL[activeType]}</T>
                  </p>
                  <h2 title={activeName}>{activeName}</h2>
                  {(() => {
                    const cur = [
                      ...(assets?.clothes ?? []),
                      ...(assets?.adornments ?? []),
                      ...(assets?.objects ?? []),
                    ].find((a) => a.type === activeType && a.name === activeName);
                    const label = cur ? lockLabel(cur) : null;
                    return label ? (
                      <p className="vs-muted">
                        <T>Locked to</T> {label}
                      </p>
                    ) : null;
                  })()}
                </hgroup>
                <nav className="vs-head-actions">
                  <button
                    type="button"
                    className="vs-btn"
                    disabled={!detail?.exists}
                    onClick={handleArchiveOne}
                  >
                    <T>Archive</T>
                  </button>
                  <button
                    type="button"
                    className="vs-btn vs-btn-danger"
                    disabled={!detail?.exists}
                    onClick={handleDeleteOne}
                  >
                    <T>Delete</T>
                  </button>
                </nav>
              </header>

              <section className="vs-stage-row">
                <figure className="vs-preview vs-card">
                  {previewUrl ? (
                    <img src={previewUrl} alt={activeName} />
                  ) : (
                    <figcaption>
                      <T>Not generated yet</T>
                    </figcaption>
                  )}
                </figure>
                {job ? (
                  <JobStatus job={job} onCancel={() => dispatch(jobsActions.cancel(job.id))} />
                ) : (
                  <section className="vs-card vs-job vs-idle">
                    <p className="vs-muted">
                      <T>No render running. Adjust the tags below, then Generate.</T>
                    </p>
                  </section>
                )}
              </section>

              <details className="vs-card vs-fold" open>
                <summary>
                  <T>Tags and feedback</T>
                  {selectedBadges.length > 0 && (
                    <small className="vs-count">{selectedBadges.length}</small>
                  )}
                </summary>
                <p className="vs-hint">
                  <T>Pick tags to steer. Better adds attention, Worse lowers it.</T>
                </p>
                <ul className="vs-chips">
                  {parsedTags.map((t) => {
                    const clean = baseTag(t);
                    const on = selectedBadges.includes(clean);
                    return (
                      <li key={t}>
                        <button
                          type="button"
                          className="vs-chip"
                          aria-pressed={on}
                          onClick={() => toggleBadge(clean)}
                          title={t}
                        >
                          {t}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {selectedBadges.length > 0 && (
                  <ul className="vs-feedback">
                    {selectedBadges.map((tag) => (
                      <li key={tag}>
                        <fieldset>
                          <legend title={tag}>{tag}</legend>
                          <p className="vs-seg">
                            {CHOICES.map((c) => (
                              <label key={c.id} data-choice={c.id}>
                                <input
                                  type="radio"
                                  name={`fb-${tag}`}
                                  checked={(feedback[tag] || "keep") === c.id}
                                  onChange={() => setFeedback((prev) => ({ ...prev, [tag]: c.id }))}
                                />
                                <small>
                                  <b aria-hidden="true">{c.mark}</b> <T>{c.label}</T>
                                </small>
                              </label>
                            ))}
                          </p>
                        </fieldset>
                      </li>
                    ))}
                  </ul>
                )}

                <form
                  className="vs-add"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddCustomTag();
                  }}
                >
                  <input
                    type="text"
                    placeholder="Add a tag (ribbon, blush…)"
                    aria-label="Add a tag"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                  />
                  <button type="submit" className="vs-btn">
                    <T>Add</T>
                  </button>
                </form>
              </details>

              <details className="vs-card vs-fold" open>
                <summary>
                  <T>Prompts</T>
                </summary>
                <label className="vs-field">
                  <small>
                    <T>Positive</T>
                  </small>
                  <textarea
                    rows={4}
                    value={positivePrompt}
                    onChange={(e) => {
                      markEdited();
                      setPositivePrompt(e.target.value);
                    }}
                  />
                </label>
                <label className="vs-field">
                  <small>
                    <T>Negative</T>
                  </small>
                  <textarea
                    rows={2}
                    value={negativePrompt}
                    onChange={(e) => {
                      markEdited();
                      setNegativePrompt(e.target.value);
                    }}
                  />
                </label>
              </details>

              {(activeType === "sprite" || activeType === "cg") && (
                <details
                  className="vs-card vs-fold"
                  open={(detail?.references?.suggested.length ?? 0) > 0}
                >
                  <summary>
                    <T>Reference images</T>
                    {references.length > 0 && (
                      <small className="vs-count">{references.length}</small>
                    )}
                  </summary>
                  <p className="vs-muted">
                    {activeType === "sprite" ? (
                      <T>
                        The ticked sprites are the starting point: this one is made from them, so
                        the character stays the same.
                      </T>
                    ) : (
                      <T>
                        The ticked sprites show the image who is in it. Tick one sprite per
                        character.
                      </T>
                    )}
                  </p>
                  {(detail?.references?.available.length ?? 0) === 0 ? (
                    <p className="vs-muted">
                      <T>No other sprites exist yet.</T>
                    </p>
                  ) : (
                    <ul className="vs-refs">
                      {detail?.references?.available.map((name) => (
                        <li key={name}>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={references.includes(name)}
                              onChange={(e) =>
                                setReferences((prev) =>
                                  e.target.checked
                                    ? [...prev, name]
                                    : prev.filter((n) => n !== name),
                                )
                              }
                            />
                            {name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}

              <details className="vs-card vs-fold">
                <summary>
                  <T>Sampler</T>
                  <small className="vs-muted">
                    {sampler} · {steps} <T>steps</T> · <T>guidance</T> {cfg}
                  </small>
                </summary>
                <form className="vs-params">
                  <label>
                    <small>
                      <T>Steps</T>
                    </small>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={steps}
                      onChange={(e) => {
                        markEdited();
                        setSteps(Number(e.target.value));
                      }}
                    />
                  </label>
                  <label>
                    <small>
                      <T>Guidance</T>
                    </small>
                    <input
                      type="number"
                      step={0.5}
                      min={1}
                      max={20}
                      value={cfg}
                      onChange={(e) => {
                        markEdited();
                        setCfg(Number(e.target.value));
                      }}
                    />
                  </label>
                  <label>
                    <small>
                      <T>Sampler</T>
                    </small>
                    <select
                      value={sampler}
                      onChange={(e) => {
                        markEdited();
                        setSampler(e.target.value);
                      }}
                    >
                      <option value="dpmpp_2m">dpmpp_2m</option>
                      <option value="euler">euler</option>
                      <option value="euler_ancestral">euler_ancestral</option>
                      <option value="heun">heun</option>
                    </select>
                  </label>
                  <label>
                    <small>
                      <T>Scheduler</T>
                    </small>
                    <select
                      value={scheduler}
                      onChange={(e) => {
                        markEdited();
                        setScheduler(e.target.value);
                      }}
                    >
                      <option value="karras">karras</option>
                      <option value="normal">normal</option>
                      <option value="exponential">exponential</option>
                    </select>
                  </label>
                  <label>
                    <small>
                      <T>Seed</T>
                    </small>
                    <input
                      type="number"
                      placeholder="Random"
                      value={seed ?? ""}
                      onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                    />
                  </label>
                </form>
              </details>

              <details className="vs-card vs-fold">
                <summary>
                  <T>History</T>
                  <small className="vs-count">{history.length}</small>
                </summary>
                {history.length === 0 ? (
                  <p className="vs-muted">
                    <T>No archived passes yet. Earlier renders are kept here automatically.</T>
                  </p>
                ) : (
                  <ul className="vs-gallery">
                    {recent.map((h) => (
                      <li key={h.timestamp}>
                        <button
                          type="button"
                          className="vs-shot"
                          onClick={() => handleRestoreRun(h)}
                          title={h.prompt}
                        >
                          {h.imageUrl && <img src={h.imageUrl} alt={h.timestamp} loading="lazy" />}
                          <time>{h.timestamp}</time>
                          {h.feedback && Object.keys(h.feedback).length > 0 && (
                            <small className="vs-shot-fb">
                              {Object.entries(h.feedback)
                                .filter(([, v]) => v !== "keep")
                                .map(([k, v]) => `${v === "better" ? "▲" : "▼"} ${k}`)
                                .join(" · ")}
                            </small>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {history.length > 0 && (
                  <button
                    type="button"
                    className="vs-btn"
                    onClick={() =>
                      activeWorld &&
                      activeSlug &&
                      nav.toDataset(activeWorld, activeSlug, activeType, activeName)
                    }
                  >
                    <T>Open full gallery</T>
                  </button>
                )}
              </details>

              <footer className="vs-actions">
                <button
                  type="button"
                  className="vs-btn vs-btn-primary"
                  disabled={generating || loadingDetail || !detail}
                  onClick={handleGenerate}
                >
                  {generating ? <T>Generating…</T> : <T>Generate</T>}
                </button>
                <output className="vs-message">
                  {jobsState.startError
                    ? bilingual(jobsState.startError)
                    : loadingDetail
                      ? bilingual("Loading this asset…")
                      : message}
                </output>
                {saveStatus !== "" && (
                  <output className="vs-saved" data-state={saveStatus}>
                    {saveStatus === "saving" ? (
                      <T>Saving…</T>
                    ) : saveStatus === "saved" ? (
                      <T>Prompt saved</T>
                    ) : (
                      <T>Could not save the prompt</T>
                    )}
                  </output>
                )}
              </footer>
            </>
          )}
        </main>
      </section>
    </section>
  );
}
