import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAct, useApp } from "../app-context";
import { T } from "../i18n";
import { useNav } from "../nav";
import type {
  GenerateAssetInput,
  VnAssetDatasetEntry,
  VnAssetDetail,
  VnAssetItem,
  VnWithAssetsSummary,
} from "../types";
import { Empty, Panel } from "../ui";

export function VnStudio() {
  const nav = useNav();
  const { act } = useAct();
  const [allVns, setAllVns] = useState<VnWithAssetsSummary[]>([]);
  const [assets, setAssets] = useState<{
    sprites: VnAssetItem[];
    cgs: VnAssetItem[];
    backgrounds: VnAssetItem[];
  } | null>(null);

  // Active selections
  const activeWorld = nav.vnWorld || allVns[0]?.worldName;
  const activeSlug = nav.vnSlug || allVns[0]?.slug;
  const activeType = nav.vnAssetType || "sprite";
  const activeName = nav.vnAssetName;

  const [detail, setDetail] = useState<VnAssetDetail | null>(null);
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(22);
  const [cfg, setCfg] = useState(7.5);
  const [sampler, setSampler] = useState("dpmpp_2m");
  const [scheduler, setScheduler] = useState("karras");
  const [seed, setSeed] = useState<number | undefined>(undefined);

  // Asset list search & category filtering
  const [assetSearch, setAssetSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "shared" | "sprite" | "cg" | "bg">("all");
  const [galleryMode, setGalleryMode] = useState<"gallery" | "list">("gallery");

  // Danbooru badges & attention adjustment
  const [selectedBadges, setSelectedBadges] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, "better" | "keep" | "worse">>({});
  const [newTagInput, setNewTagInput] = useState("");

  const [generating, setGenerating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<VnAssetDatasetEntry[]>([]);

  // Load all VNs
  useEffect(() => {
    void act(api.allVns).then((v) => {
      setAllVns(v ?? []);
      if (v && v.length > 0 && v[0] && !nav.vnWorld && !nav.vnSlug) {
        nav.toVn(v[0].worldName, v[0].slug);
      }
    });
  }, [act, nav]);

  // Load assets for selected VN
  useEffect(() => {
    if (!activeWorld || !activeSlug) return;
    void act(() => api.vnAssets(activeWorld, activeSlug)).then((res) => {
      setAssets(res ?? null);
      if (res && !activeName) {
        const first = res.sprites[0] || res.cgs[0] || res.backgrounds[0];
        if (first) {
          nav.toVn(activeWorld, activeSlug, first.type, first.name);
        }
      }
    });
  }, [activeWorld, activeSlug, activeName, act, nav]);

  // Load detail for selected asset
  useEffect(() => {
    if (!activeWorld || !activeSlug || !activeName) return;
    void act(() => api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName)).then((d) => {
      if (d) {
        setDetail(d);
        setPositivePrompt(d.positivePrompt);
        setNegativePrompt(d.negativePrompt);
        setPreviewUrl(d.url);
        setHistory(d.datasetHistory || []);
        if (d.steps !== undefined) setSteps(d.steps);
        if (d.cfg !== undefined) setCfg(d.cfg);
        if (d.sampler !== undefined) setSampler(d.sampler);
        if (d.scheduler !== undefined) setScheduler(d.scheduler);
        if (d.seed !== undefined) setSeed(d.seed);
        setSelectedBadges([]);
        setFeedback({});
      }
    });
  }, [activeWorld, activeSlug, activeType, activeName, act]);

  // Targeted asset search and filtering
  const query = assetSearch.trim().toLowerCase();
  const matches = useCallback(
    (item: VnAssetItem) => {
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        (item.defaultPrompt ? item.defaultPrompt.toLowerCase().includes(query) : false)
      );
    },
    [query],
  );

  const filteredSprites = useMemo(() => {
    if (!assets) return [];
    if (typeFilter === "shared") return assets.sprites.filter((s) => s.isShared && matches(s));
    if (typeFilter !== "all" && typeFilter !== "sprite") return [];
    return assets.sprites.filter(matches);
  }, [assets, typeFilter, matches]);

  const filteredCgs = useMemo(() => {
    if (!assets) return [];
    if (typeFilter === "shared") return assets.cgs.filter((c) => c.isShared && matches(c));
    if (typeFilter !== "all" && typeFilter !== "cg") return [];
    return assets.cgs.filter(matches);
  }, [assets, typeFilter, matches]);

  const filteredBackgrounds = useMemo(() => {
    if (!assets) return [];
    if (typeFilter === "shared") return assets.backgrounds.filter((b) => b.isShared && matches(b));
    if (typeFilter !== "all" && typeFilter !== "bg") return [];
    return assets.backgrounds.filter(matches);
  }, [assets, typeFilter, matches]);

  const sharedCount = useMemo(() => {
    if (!assets) return 0;
    return (
      assets.sprites.filter((s) => s.isShared).length +
      assets.cgs.filter((c) => c.isShared).length +
      assets.backgrounds.filter((b) => b.isShared).length
    );
  }, [assets]);

  const totalVisible = filteredSprites.length + filteredCgs.length + filteredBackgrounds.length;

  const handleSelectFirstMatch = () => {
    if (!activeWorld || !activeSlug) return;
    const first = filteredSprites[0] || filteredCgs[0] || filteredBackgrounds[0];
    if (first) {
      nav.toVn(activeWorld, activeSlug, first.type, first.name);
    }
  };

  // Parse prompt into Danbooru tag tokens
  const parsedTags = useMemo(() => {
    if (!positivePrompt) return [];
    return positivePrompt
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [positivePrompt]);

  const toggleBadge = (tag: string) => {
    // Strip weighting syntax to get base keyword
    const cleanTag = (tag.replace(/^\(+/, "").replace(/\)+$/, "").split(":")[0] ?? "").trim();
    if (selectedBadges.includes(cleanTag)) {
      setSelectedBadges((prev) => prev.filter((b) => b !== cleanTag));
      setFeedback((prev) => {
        const next = { ...prev };
        delete next[cleanTag];
        return next;
      });
    } else {
      setSelectedBadges((prev) => [...prev, cleanTag]);
      setFeedback((prev) => ({ ...prev, [cleanTag]: "keep" }));
    }
  };

  const setTagAction = (tag: string, action: "better" | "keep" | "worse") => {
    setFeedback((prev) => ({ ...prev, [tag]: action }));
  };

  const handleAddCustomTag = () => {
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    setPositivePrompt((prev) => (prev ? `${prev}, ${trimmed}` : trimmed));
    setSelectedBadges((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setFeedback((prev) => ({ ...prev, [trimmed]: "better" }));
    setNewTagInput("");
  };

  const handleRestoreRun = (entry: VnAssetDatasetEntry) => {
    if (entry.prompt) setPositivePrompt(entry.prompt);
    if (entry.negativePrompt) setNegativePrompt(entry.negativePrompt);
    if (entry.imageUrl) setPreviewUrl(entry.imageUrl);
    if (entry.feedback) {
      setFeedback(entry.feedback);
      setSelectedBadges(Object.keys(entry.feedback));
    }
  };

  const handleGenerate = async () => {
    if (!activeWorld || !activeSlug || !activeName) return;
    setGenerating(true);
    setStatusText("Dispatching workflow to ComfyUI...");

    const selectedItem = assets
      ? [...assets.sprites, ...assets.cgs, ...assets.backgrounds].find(
          (a) => a.name === activeName && a.type === activeType,
        )
      : null;
    const targetSlug =
      selectedItem?.vnSlug ||
      (selectedItem?.isShared ? "_shared" : activeSlug === "_all" ? "_shared" : activeSlug);

    try {
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
      };

      const res = await act(() => api.generateVnAsset(activeWorld, targetSlug, payload));
      if (res && res.ok) {
        setPreviewUrl(res.assetUrl);
        setPositivePrompt(res.positivePrompt);
        setNegativePrompt(res.negativePrompt);
        setStatusText("Generation complete!");

        // Refresh detail to get latest dataset history
        const refreshed = await api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName);
        if (refreshed) {
          setDetail(refreshed);
          setHistory(refreshed.datasetHistory || []);
        }
      }
    } catch (e) {
      setStatusText((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleArchiveOne = async () => {
    if (!activeWorld || !activeSlug || !activeName) return;
    try {
      const res = await act(() => api.archiveOneVnAsset(activeWorld, activeSlug, activeType, activeName));
      if (res && res.ok) {
        setStatusText("Asset archived to dataset history.");
        const refreshed = await api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName);
        if (refreshed) {
          setDetail(refreshed);
          setHistory(refreshed.datasetHistory || []);
        }
      }
    } catch (e) {
      setStatusText((e as Error).message);
    }
  };

  const handleDeleteOne = async () => {
    if (!activeWorld || !activeSlug || !activeName) return;
    if (!window.confirm(`Delete rendered file for ${activeName}? It will be reset to Pending.`)) return;
    try {
      const res = await act(() => api.deleteOneVnAsset(activeWorld, activeSlug, activeType, activeName));
      if (res && res.ok) {
        setStatusText(`Deleted ${activeName}. Asset reset to Pending.`);
        setPreviewUrl(undefined);
        const [refreshedAssets, refreshedDetail] = await Promise.all([
          api.vnAssets(activeWorld, activeSlug),
          api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName),
        ]);
        if (refreshedAssets) setAssets(refreshedAssets);
        if (refreshedDetail) {
          setDetail(refreshedDetail);
          setPreviewUrl(refreshedDetail.url);
        }
      }
    } catch (e) {
      setStatusText((e as Error).message);
    }
  };

  const handleArchiveAll = async () => {
    if (!activeWorld || !activeSlug) return;
    try {
      const res = await act(() => api.archiveAllVnAssets(activeWorld, activeSlug));
      if (res && res.ok) {
        setStatusText(`Archived ${res.archivedCount} assets to dataset history.`);
        if (activeName) {
          const refreshed = await api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName);
          if (refreshed) {
            setDetail(refreshed);
            setHistory(refreshed.datasetHistory || []);
          }
        }
      }
    } catch (e) {
      setStatusText((e as Error).message);
    }
  };

  const handleDeleteAll = async () => {
    if (!activeWorld || !activeSlug) return;
    if (!window.confirm(`Delete all rendered assets for ${activeSlug}? They will be reset to Pending.`)) return;
    try {
      const res = await act(() => api.deleteAllVnAssets(activeWorld, activeSlug));
      if (res && res.ok) {
        setStatusText(`Deleted ${res.deletedCount} rendered files. All assets reset to Pending.`);
        setPreviewUrl(undefined);
        const [refreshedAssets, refreshedDetail] = await Promise.all([
          api.vnAssets(activeWorld, activeSlug),
          activeName ? api.vnAssetDetail(activeWorld, activeSlug, activeType, activeName) : Promise.resolve(null),
        ]);
        if (refreshedAssets) setAssets(refreshedAssets);
        if (refreshedDetail) {
          setDetail(refreshedDetail);
          setPreviewUrl(refreshedDetail.url);
        }
      }
    } catch (e) {
      setStatusText((e as Error).message);
    }
  };

  return (
    <section className="vn-studio">
      <header className="hero">
        <p className="eyebrow">
          <T>ComfyUI Visual Novel Asset Studio</T>
        </p>
        <h1>
          <T>Asset Feedback & Reinforcement Studio</T>
        </h1>
        <p className="lede">
          <T>
            Inspect visual novel asset budgets, tokenize prompt tags into Danbooru badges, tune attention weights
            interactively, and archive feedback training sets.
          </T>
        </p>
      </header>

      {/* Top Selector: Choose Visual Novel */}
      <nav className="vn-selector-bar">
        <strong className="vn-selector-label">
          <T>Visual Novel:</T>
        </strong>
        {activeWorld && (
          <>
            <button
              type="button"
              className="vn-pill-btn"
              aria-pressed={activeSlug === "_all"}
              onClick={() => nav.toVn(activeWorld, "_all")}
            >
              <T>All Assets</T>
            </button>
            <button
              type="button"
              className="vn-pill-btn"
              aria-pressed={activeSlug === "_shared"}
              onClick={() => nav.toVn(activeWorld, "_shared")}
            >
              <T>Shared Pool</T>
            </button>
          </>
        )}
        {allVns.length === 0 ? (
          <Empty>
            <T>No visual novels found. Adapt a chapter first.</T>
          </Empty>
        ) : (
          allVns.map((vn) => {
            const isSelected = vn.worldName === activeWorld && vn.slug === activeSlug;
            return (
              <button
                key={`${vn.worldName}:${vn.slug}`}
                type="button"
                className="vn-pill-btn"
                aria-pressed={isSelected}
                onClick={() => nav.toVn(vn.worldName, vn.slug)}
              >
                {vn.worldTitle} — {vn.title || vn.slug} ({vn.tier || "short"})
              </button>
            );
          })
        )}
      </nav>

      <section className="vn-studio-grid">
        {/* Left Column: Asset Explorer List with Targeted Search and Scroll */}
        <aside className="vn-asset-col">
          <Panel title="VN Assets">
            {!assets ? (
              <Empty>
                <T>Loading assets…</T>
              </Empty>
            ) : (
              <section className="vn-asset-col">
                {/* Search & Filter Header */}
                <form
                  className="vn-asset-search-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSelectFirstMatch();
                  }}
                >
                  <label className="vn-search-input-wrap">
                    <input
                      type="search"
                      className="vn-asset-search-input"
                      placeholder="Search assets..."
                      value={assetSearch}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      aria-label="Search assets"
                    />
                    {assetSearch && (
                      <button
                        type="button"
                        className="vn-search-clear-btn"
                        aria-label="Clear search"
                        onClick={() => setAssetSearch("")}
                      >
                        ×
                      </button>
                    )}
                  </label>

                  <nav className="vn-filter-tabs">
                    <button
                      type="button"
                      className="vn-filter-tab"
                      aria-pressed={typeFilter === "all"}
                      onClick={() => setTypeFilter("all")}
                    >
                      <T>All</T> (
                      {assets.sprites.length + assets.cgs.length + assets.backgrounds.length})
                    </button>
                    <button
                      type="button"
                      className="vn-filter-tab"
                      aria-pressed={typeFilter === "shared"}
                      onClick={() => setTypeFilter("shared")}
                    >
                      <T>Shared</T> ({sharedCount})
                    </button>
                    <button
                      type="button"
                      className="vn-filter-tab"
                      aria-pressed={typeFilter === "sprite"}
                      onClick={() => setTypeFilter("sprite")}
                    >
                      <T>Sprites</T> ({assets.sprites.length})
                    </button>
                    <button
                      type="button"
                      className="vn-filter-tab"
                      aria-pressed={typeFilter === "cg"}
                      onClick={() => setTypeFilter("cg")}
                    >
                      <T>Event CGs</T> ({assets.cgs.length})
                    </button>
                    <button
                      type="button"
                      className="vn-filter-tab"
                      aria-pressed={typeFilter === "bg"}
                      onClick={() => setTypeFilter("bg")}
                    >
                      <T>Backgrounds</T> ({assets.backgrounds.length})
                    </button>
                  </nav>
                </form>

                <nav className="vn-batch-actions">
                  <button
                    type="button"
                    className="button button-subtle vn-batch-btn"
                    onClick={handleArchiveAll}
                    title="Archive all rendered assets to dataset history"
                  >
                    <T>Archive All</T>
                  </button>
                  <button
                    type="button"
                    className="button button-subtle button-danger-text vn-batch-btn"
                    onClick={handleDeleteAll}
                    title="Delete all rendered asset files and reset to pending"
                  >
                    <T>Delete All</T>
                  </button>
                </nav>

                {/* Scrollable Asset List */}
                <nav className="vn-asset-scroll-area">
                  {totalVisible === 0 ? (
                    <Empty>
                      <T>Nothing matches.</T>
                    </Empty>
                  ) : (
                    <>
                      {/* Sprites */}
                      {filteredSprites.length > 0 && (
                        <section className="vn-category-group">
                          <h4 className="vn-category-title">
                            <T>Character Sprites</T> ({filteredSprites.length})
                          </h4>
                          <ul className="vn-asset-list">
                            {filteredSprites.map((s) => {
                              const isSel = activeType === "sprite" && activeName === s.name;
                              return (
                                <li key={s.id}>
                                  <button
                                    type="button"
                                    className="vn-asset-btn"
                                    aria-current={isSel}
                                    onClick={() => nav.toVn(activeWorld, activeSlug, "sprite", s.name)}
                                  >
                                    <label>{s.name}</label>
                                    {s.isShared && (
                                      <small className="badge-shared">
                                        <T>Shared</T>
                                      </small>
                                    )}
                                    {s.vnSlug && s.vnSlug !== "_shared" && activeSlug === "_all" && (
                                      <small className="badge-vn">{s.vnSlug}</small>
                                    )}
                                    <small className="vn-asset-status">
                                      {s.exists ? "✓ " : "○ "}
                                      <T>{s.exists ? "Rendered" : "Pending"}</T>
                                    </small>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}

                      {/* Event CGs */}
                      {filteredCgs.length > 0 && (
                        <section className="vn-category-group">
                          <h4 className="vn-category-title">
                            <T>Event CG Scenes</T> ({filteredCgs.length})
                          </h4>
                          <ul className="vn-asset-list">
                            {filteredCgs.map((cg) => {
                              const isSel = activeType === "cg" && activeName === cg.name;
                              return (
                                <li key={cg.id}>
                                  <button
                                    type="button"
                                    className="vn-asset-btn"
                                    aria-current={isSel}
                                    onClick={() => nav.toVn(activeWorld, activeSlug, "cg", cg.name)}
                                  >
                                    <label>{cg.name}</label>
                                    {cg.isShared && (
                                      <small className="badge-shared">
                                        <T>Shared</T>
                                      </small>
                                    )}
                                    {cg.vnSlug && cg.vnSlug !== "_shared" && activeSlug === "_all" && (
                                      <small className="badge-vn">{cg.vnSlug}</small>
                                    )}
                                    <small className="vn-asset-status">
                                      {cg.exists ? "✓ " : "○ "}
                                      <T>{cg.exists ? "Rendered" : "Pending"}</T>
                                    </small>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}

                      {/* Backgrounds */}
                      {filteredBackgrounds.length > 0 && (
                        <section className="vn-category-group">
                          <h4 className="vn-category-title">
                            <T>Backgrounds</T> ({filteredBackgrounds.length})
                          </h4>
                          <ul className="vn-asset-list">
                            {filteredBackgrounds.map((bg) => {
                              const isSel = activeType === "bg" && activeName === bg.name;
                              return (
                                <li key={bg.id}>
                                  <button
                                    type="button"
                                    className="vn-asset-btn"
                                    aria-current={isSel}
                                    onClick={() => nav.toVn(activeWorld, activeSlug, "bg", bg.name)}
                                  >
                                    <label>{bg.name}</label>
                                    {bg.isShared && (
                                      <small className="badge-shared">
                                        <T>Shared</T>
                                      </small>
                                    )}
                                    {bg.vnSlug && bg.vnSlug !== "_shared" && activeSlug === "_all" && (
                                      <small className="badge-vn">{bg.vnSlug}</small>
                                    )}
                                    <small className="vn-asset-status">
                                      {bg.exists ? "✓ " : "○ "}
                                      <T>{bg.exists ? "Rendered" : "Pending"}</T>
                                    </small>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      )}
                    </>
                  )}
                </nav>
              </section>
            )}
          </Panel>
        </aside>

        {/* Center Column: Inspector, Preview, Badges, and Feedback Questionnaire */}
        <article className="vn-workspace-col">
          <Panel title={`Asset Studio: ${activeType.toUpperCase()} — ${activeName || "Select an asset"}`}>
            {!activeName ? (
              <Empty>
                <T>Select an asset from the left to view prompt inputs and trigger generation.</T>
              </Empty>
            ) : (
              <section className="vn-workspace-col">
                {/* Image Stage Preview */}
                <figure className="vn-stage-preview">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={activeName}
                      className="vn-stage-img"
                    />
                  ) : (
                    <section className="vn-stage-placeholder">
                      <p>
                        <T>Asset Pending Generation</T>
                      </p>
                      <p className="sub">
                        <T>Use the questionnaire below and click Trigger Generation.</T>
                      </p>
                    </section>
                  )}

                  {generating && (
                    <section className="vn-stage-overlay">
                      <output className="boot">
                        <T>{statusText || "Rendering through ComfyUI..."}</T>
                      </output>
                    </section>
                  )}
                </figure>

                {/* Danbooru Tag Badges Cloud */}
                <section className="vn-tags-section">
                  <h4 className="vn-tags-title">
                    <T>Danbooru Tag Badges (Click to Add to Attention Adjustment Questionnaire):</T>
                  </h4>
                  <ul className="vn-tags-cloud">
                    {parsedTags.map((t, idx) => {
                      const clean = (t.replace(/^\(+/, "").replace(/\)+$/, "").split(":")[0] ?? "").trim();
                      const isSelected = selectedBadges.includes(clean);
                      return (
                        <li key={`${clean}-${idx}`}>
                          <button
                            type="button"
                            className="vn-tag-chip"
                            aria-pressed={isSelected}
                            onClick={() => toggleBadge(clean)}
                          >
                            {isSelected ? `✓ ${t}` : `+ ${t}`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* Attention Adjustment Questionnaire */}
                {selectedBadges.length > 0 && (
                  <section className="vn-feedback-box">
                    <h4 className="vn-feedback-title">
                      <T>Attention Adjustment Questionnaire</T>
                    </h4>
                    <p className="vn-feedback-desc">
                      <T>
                        Select feedback for each active tag. "Make better" reinforces weights (+0.2); "Make worse"
                        penalizes or negates.
                      </T>
                    </p>
                    <ul className="vn-feedback-list">
                      {selectedBadges.map((tag) => {
                        const currentChoice = feedback[tag] || "keep";
                        return (
                          <li key={tag} className="vn-feedback-row">
                            <label className="vn-feedback-tag">{tag}</label>
                            <nav className="vn-feedback-btn-group">
                              <button
                                type="button"
                                className="btn-action action-better"
                                aria-pressed={currentChoice === "better"}
                                onClick={() => setTagAction(tag, "better")}
                              >
                                <T>▲ Make better</T>
                              </button>
                              <button
                                type="button"
                                className="btn-action action-keep"
                                aria-pressed={currentChoice === "keep"}
                                onClick={() => setTagAction(tag, "keep")}
                              >
                                <T>● Keep as is</T>
                              </button>
                              <button
                                type="button"
                                className="btn-action action-worse"
                                aria-pressed={currentChoice === "worse"}
                                onClick={() => setTagAction(tag, "worse")}
                              >
                                <T>▼ Make worse</T>
                              </button>
                            </nav>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}

                {/* Quick Tag Adder */}
                <form
                  className="vn-tag-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddCustomTag();
                  }}
                >
                  <input
                    type="text"
                    className="vn-tag-input"
                    placeholder="Add custom Danbooru tag (e.g. ribbon, blush, twintails)..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                  />
                  <button type="submit" className="button">
                    <T>Add Tag</T>
                  </button>
                </form>

                {/* Positive Prompt Textarea */}
                <fieldset className="vn-field-group">
                  <label className="vn-field-label">
                    <T>Positive Prompt:</T>
                  </label>
                  <textarea
                    rows={4}
                    value={positivePrompt}
                    onChange={(e) => setPositivePrompt(e.target.value)}
                    className="vn-textarea"
                  />
                </fieldset>

                {/* Negative Prompt Textarea */}
                <fieldset className="vn-field-group">
                  <label className="vn-field-label">
                    <T>Negative Prompt:</T>
                  </label>
                  <textarea
                    rows={2}
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="vn-textarea"
                  />
                </fieldset>

                {/* Execution Button */}
                <footer className="vn-action-bar">
                  <button
                    type="button"
                    className="button button-primary vn-generate-btn"
                    disabled={generating}
                    onClick={handleGenerate}
                  >
                    {generating ? <T>Generating via ComfyUI...</T> : <T>Trigger Generation with Feedback</T>}
                  </button>
                  <button
                    type="button"
                    className="button button-subtle vn-action-btn"
                    disabled={!detail?.exists}
                    onClick={handleArchiveOne}
                    title="Archive current asset version to dataset history"
                  >
                    <T>Archive Asset</T>
                  </button>
                  <button
                    type="button"
                    className="button button-subtle button-danger-text vn-action-btn"
                    disabled={!detail?.exists}
                    onClick={handleDeleteOne}
                    title="Delete rendered asset file and reset to pending"
                  >
                    <T>Delete Asset</T>
                  </button>
                  {statusText && <output className="vn-status-msg">{statusText}</output>}
                </footer>
              </section>
            )}
          </Panel>
        </article>

        {/* Right Column: Sampler Settings & Feedback Dataset History */}
        <aside className="vn-sampler-col">
          <Panel title="Sampler Parameters">
            <form className="vn-param-form">
              <label className="vn-param-label">
                <T>Steps:</T>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="vn-param-input"
                />
              </label>
              <label className="vn-param-label">
                <T>CFG Scale:</T>
                <input
                  type="number"
                  step={0.5}
                  min={1}
                  max={20}
                  value={cfg}
                  onChange={(e) => setCfg(Number(e.target.value))}
                  className="vn-param-input"
                />
              </label>
              <label className="vn-param-label">
                <T>Sampler:</T>
                <select
                  value={sampler}
                  onChange={(e) => setSampler(e.target.value)}
                  className="vn-param-input"
                >
                  <option value="dpmpp_2m">dpmpp_2m</option>
                  <option value="euler">euler</option>
                  <option value="euler_ancestral">euler_ancestral</option>
                  <option value="heun">heun</option>
                </select>
              </label>
              <label className="vn-param-label">
                <T>Scheduler:</T>
                <select
                  value={scheduler}
                  onChange={(e) => setScheduler(e.target.value)}
                  className="vn-param-input"
                >
                  <option value="karras">karras</option>
                  <option value="normal">normal</option>
                  <option value="exponential">exponential</option>
                </select>
              </label>
              <label className="vn-param-label">
                <T>Seed (optional):</T>
                <input
                  type="number"
                  placeholder="Randomize"
                  value={seed ?? ""}
                  onChange={(e) => setSeed(e.target.value ? Number(e.target.value) : undefined)}
                  className="vn-param-input"
                />
              </label>
            </form>
          </Panel>

          {/* Dataset & Archival History / Gallery */}
          <Panel title={`Dataset History (${history.length})`}>
            {history.length === 0 ? (
              <Empty>
                <T>No archived passes yet. Previous runs will be preserved here automatically.</T>
              </Empty>
            ) : (
              <section className="vn-gallery-container">
                <nav className="vn-gallery-toggle">
                  <button
                    type="button"
                    className="vn-gallery-tab"
                    aria-pressed={galleryMode === "gallery"}
                    onClick={() => setGalleryMode("gallery")}
                  >
                    <T>Gallery</T>
                  </button>
                  <button
                    type="button"
                    className="vn-gallery-tab"
                    aria-pressed={galleryMode === "list"}
                    onClick={() => setGalleryMode("list")}
                  >
                    <T>List</T>
                  </button>
                </nav>

                {galleryMode === "gallery" ? (
                  <ul className="vn-gallery-grid">
                    {history.map((h) => (
                      <li key={h.timestamp} className="vn-gallery-card">
                        {h.imageUrl && (
                          <figure
                            className="vn-gallery-thumb-wrap"
                            onClick={() => handleRestoreRun(h)}
                          >
                            <img
                              src={h.imageUrl}
                              alt={h.timestamp}
                              className="vn-gallery-thumb"
                              loading="lazy"
                            />
                          </figure>
                        )}
                        <section className="vn-gallery-info">
                          <time className="vn-history-time">{h.timestamp}</time>
                          <p className="vn-gallery-prompt">{h.prompt}</p>
                          {h.feedback && Object.keys(h.feedback).length > 0 && (
                            <ul className="vn-history-tags">
                              {Object.entries(h.feedback).map(([k, v]) => (
                                <li key={k} className={`vn-history-tag ${v}`}>
                                  {k}: {v}
                                </li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="vn-restore-btn"
                            onClick={() => handleRestoreRun(h)}
                          >
                            <T>Restore Run</T>
                          </button>
                        </section>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="vn-history-container">
                    {history.map((h) => (
                      <li key={h.timestamp} className="vn-history-card">
                        <time className="vn-history-time">{h.timestamp}</time>
                        <p className="vn-history-prompt">{h.prompt}</p>
                        {h.feedback && Object.keys(h.feedback).length > 0 && (
                          <ul className="vn-history-tags">
                            {Object.entries(h.feedback).map(([k, v]) => (
                              <li
                                key={k}
                                className={`vn-history-tag ${v}`}
                              >
                                {k}: {v}
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className="vn-restore-btn"
                          onClick={() => handleRestoreRun(h)}
                        >
                          <T>Restore Run</T>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </Panel>
        </aside>
      </section>
    </section>
  );
}
