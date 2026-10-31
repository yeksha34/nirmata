import { useCallback, useEffect, useMemo, useState } from "react";
import { T } from "../i18n";
import type { VnManifest, VnMenuChoice, VnSlide, VnSlideDeck } from "../types";
import { applyVarOps } from "./types";
import { VnCanvas } from "./VnCanvas";
import "./vn-player.css";

const TYPEWRITER_SPEED_MS = 25;
const AUTOPLAY_DELAY_MS = 1600;

export function VnPlayer({
  world,
  manifest,
  slides,
  initialVariables,
  nextVnTitle,
  onNextVn,
  onClose,
}: {
  world: { name: string; title: string };
  manifest: VnManifest;
  slides: VnSlideDeck;
  initialVariables?: Record<string, number | boolean | string>;
  nextVnTitle?: string;
  onNextVn?: (
    nextSlug: string,
    currentVariables: Record<string, number | boolean | string>,
  ) => void;
  onClose: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [variables, setVariables] = useState<Record<string, number | boolean | string>>(() => {
    const initial: Record<string, number | boolean | string> = {};
    if (manifest.variables) {
      for (const [key, def] of Object.entries(manifest.variables)) {
        initial[key] = def.initial;
      }
    }
    if (initialVariables) {
      for (const [key, val] of Object.entries(initialVariables)) {
        initial[key] = val;
      }
    }
    return initial;
  });

  const [typewriterLen, setTypewriterLen] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [skip, setSkip] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endingName, setEndingName] = useState<string>();
  const [history, setHistory] = useState<Array<{ slide: VnSlide; choiceMade?: string }>>([]);

  const currentSlide: VnSlide | undefined = slides.slides[slideIndex];
  const nextSlug = manifest.nextSlug;
  const fullText = currentSlide?.dialogue.text || "";
  const isTypewriterDone = typewriterLen >= fullText.length;

  // Reset typewriter when moving to a new slide
  useEffect(() => {
    const textLen = slides.slides[slideIndex]?.dialogue.text.length ?? 0;
    setTypewriterLen(skip ? textLen : 0);
  }, [slideIndex, slides.slides, skip]);

  // Typewriter streaming interval
  useEffect(() => {
    if (ended || isTypewriterDone) return;
    const interval = setInterval(() => {
      setTypewriterLen((prev) => {
        const next = prev + 1;
        if (next >= fullText.length) {
          clearInterval(interval);
          return fullText.length;
        }
        return next;
      });
    }, TYPEWRITER_SPEED_MS);

    return () => clearInterval(interval);
  }, [ended, isTypewriterDone, fullText.length]);

  // Map scene IDs to their initial slide index for jumps
  const sceneStartIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < slides.slides.length; i++) {
      const s = slides.slides[i];
      if (s && !map.has(s.sceneId)) {
        map.set(s.sceneId, i);
      }
    }
    return map;
  }, [slides.slides]);

  // Advance to next slide or complete typewriter
  const advance = useCallback(() => {
    if (!currentSlide || ended) return;

    // 1. If text is still streaming, click completes the line immediately
    if (!isTypewriterDone) {
      setTypewriterLen(fullText.length);
      return;
    }

    // 2. If current slide is a menu, player must click a choice option
    if (currentSlide.action.type === "menu") {
      return;
    }

    // Record to history
    setHistory((prev) => [...prev, { slide: currentSlide }]);

    // 3. Handle jump action
    if (currentSlide.action.type === "jump") {
      const targetIdx = sceneStartIndexMap.get(currentSlide.action.targetSceneId);
      if (targetIdx !== undefined) {
        setSlideIndex(targetIdx);
      } else {
        setEnded(true);
      }
      return;
    }

    // 4. Handle end action
    if (currentSlide.action.type === "end") {
      setEnded(true);
      setEndingName(currentSlide.action.endingName);
      return;
    }

    // 5. Handle continue
    if (currentSlide.action.type === "continue") {
      const targetSlideId = currentSlide.action.nextSlideId;
      if (targetSlideId) {
        const nextIdx = slides.slides.findIndex((s) => s.id === targetSlideId);
        if (nextIdx >= 0) {
          setSlideIndex(nextIdx);
          return;
        }
      }
      if (slideIndex + 1 < slides.slides.length) {
        setSlideIndex(slideIndex + 1);
      } else {
        setEnded(true);
      }
    }
  }, [
    currentSlide,
    ended,
    isTypewriterDone,
    fullText.length,
    sceneStartIndexMap,
    slides.slides,
    slideIndex,
  ]);

  // Auto-play timer
  useEffect(() => {
    if (!autoPlay || !isTypewriterDone || ended) return;
    if (currentSlide?.action.type === "menu") return;

    const timeout = setTimeout(() => {
      advance();
    }, AUTOPLAY_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [autoPlay, isTypewriterDone, ended, currentSlide?.action.type, advance]);

  // Select a choice in a MENU
  const selectChoice = (choice: VnMenuChoice) => {
    if (!currentSlide) return;

    // Apply variable operations
    if (choice.varChanges && choice.varChanges.length > 0) {
      setVariables((prev) => applyVarOps(prev, choice.varChanges));
    }

    // Record in history
    setHistory((prev) => [...prev, { slide: currentSlide, choiceMade: choice.text }]);

    // Jump to choice's target scene
    const targetIdx = sceneStartIndexMap.get(choice.targetSceneId);
    if (targetIdx !== undefined) {
      setSlideIndex(targetIdx);
    } else {
      setEnded(true);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (backlogOpen) setBacklogOpen(false);
        else if (variablesOpen) setVariablesOpen(false);
        else onClose();
      } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        if (ended) {
          if (nextSlug && onNextVn) {
            onNextVn(nextSlug, variables);
          }
        } else {
          advance();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown as unknown as EventListener);
    return () => window.removeEventListener("keydown", onKeyDown as unknown as EventListener);
  }, [advance, backlogOpen, variablesOpen, onClose, ended, nextSlug, onNextVn, variables]);

  const restart = () => {
    setSlideIndex(0);
    setEnded(false);
    setEndingName(undefined);
    setTypewriterLen(0);
    setHistory([]);
    const resetVars: Record<string, number | boolean | string> = {};
    if (manifest.variables) {
      for (const [k, d] of Object.entries(manifest.variables)) {
        resetVars[k] = d.initial;
      }
    }
    if (initialVariables) {
      for (const [k, v] of Object.entries(initialVariables)) {
        resetVars[k] = v;
      }
    }
    setVariables(resetVars);
  };

  if (!currentSlide && !ended) {
    return (
      <dialog className="vn-player-modal" open>
        <article className="vn-ending-card">
          <p className="muted">
            <T>No slides available in this visual novel.</T>
          </p>
          <button type="button" className="vn-btn-tool" onClick={onClose}>
            <T>Close</T>
          </button>
        </article>
      </dialog>
    );
  }

  const displayedText = fullText.slice(0, typewriterLen);
  const isMonologue = currentSlide?.dialogue.isMonologue === true;
  const speaker = currentSlide?.dialogue.speaker;

  return (
    <dialog className="vn-player-modal" open aria-label={`${world.title}: ${slides.title}`}>
      <section className="vn-viewport">
        {/* Layer 1-3: Phaser Canvas Stage */}
        {currentSlide && (
          <VnCanvas stage={currentSlide.stage} worldName={world.name} vnSlug={manifest.slug} />
        )}

        {/* Top Header Bar */}
        <header className="vn-header-bar">
          <section className="vn-header-info">
            <data className="vn-route-chip">
              {currentSlide?.sceneId} · {currentSlide?.route}
            </data>
            <strong className="vn-title">{slides.title}</strong>
          </section>

          <nav className="vn-header-actions">
            <button
              type="button"
              className={`vn-btn-tool ${autoPlay ? "active" : ""}`}
              onClick={() => setAutoPlay((p) => !p)}
            >
              <T>Auto</T>
            </button>
            <button
              type="button"
              className={`vn-btn-tool ${skip ? "active" : ""}`}
              onClick={() => setSkip((p) => !p)}
            >
              <T>Skip</T>
            </button>
            <button
              type="button"
              className={`vn-btn-tool ${backlogOpen ? "active" : ""}`}
              onClick={() => {
                setBacklogOpen((p) => !p);
                setVariablesOpen(false);
              }}
            >
              <T>Log</T>
            </button>
            <button
              type="button"
              className={`vn-btn-tool ${variablesOpen ? "active" : ""}`}
              onClick={() => {
                setVariablesOpen((p) => !p);
                setBacklogOpen(false);
              }}
            >
              <T>Variables</T>
            </button>
            {nextSlug && onNextVn && (
              <button
                type="button"
                className="vn-btn-tool vn-btn-header-next"
                onClick={() => onNextVn(nextSlug, variables)}
                title={nextVnTitle ? `Next: ${nextVnTitle}` : "Next Chapter"}
              >
                <T>Next</T> →
              </button>
            )}
            <button
              type="button"
              className="vn-btn-close"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </nav>
        </header>

        {/* Layer 4: Interactive Dialogue Box */}
        {currentSlide && !ended && (
          <section className="vn-dialogue-layer">
            <button type="button" className="vn-dialogue-box" onClick={advance}>
              {speaker && <header className="vn-speaker-tag">{speaker}</header>}
              <blockquote className={`vn-dialogue-text ${isMonologue ? "monologue" : ""}`}>
                {isMonologue && <i className="vn-monologue-glyph">“</i>}
                {displayedText}
                {isMonologue && isTypewriterDone && <i className="vn-monologue-glyph">”</i>}
              </blockquote>
              {isTypewriterDone && currentSlide.action.type !== "menu" && (
                <output className="vn-advance-glyph">▼</output>
              )}
            </button>
          </section>
        )}

        {/* Layer 5: Interactive Choice Menu Overlay */}
        {currentSlide?.action.type === "menu" && isTypewriterDone && !ended && (
          <menu className="vn-choices-overlay">
            {currentSlide.action.choices.map((choice) => (
              <button
                key={choice.text + choice.targetSceneId}
                type="button"
                className="vn-choice-btn"
                onClick={() => selectChoice(choice)}
              >
                <strong>{choice.text}</strong>
                {choice.isCanon && (
                  <data className="vn-choice-canon-tag">
                    <T>canon</T>
                  </data>
                )}
              </button>
            ))}
          </menu>
        )}

        {/* Layer 6: Conclusion / Ending Screen */}
        {ended && (
          <article className="vn-ending-card">
            <h2 className="vn-ending-title">
              {endingName ? endingName.replace(/_/g, " ").toUpperCase() : <T>Chapter Complete</T>}
            </h2>
            <p className="vn-ending-desc">
              <T>You have reached the end of this visual novel adaptation beat.</T>
            </p>

            {Object.keys(variables).length > 0 && (
              <section className="vn-ending-scores">
                <h4>
                  <T>Attributes &amp; Scores</T>
                </h4>
                <ol className="vn-ending-scores-grid">
                  {Object.entries(variables).map(([key, val]) => (
                    <li key={key} className="vn-ending-score-item">
                      <strong className="vn-score-label">{key}</strong>
                      <data className="vn-score-value" value={String(val)}>
                        {String(val)}
                      </data>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <menu className="vn-ending-actions">
              {nextSlug && onNextVn && (
                <button
                  type="button"
                  className="vn-btn-tool active vn-btn-next-chapter"
                  onClick={() => onNextVn(nextSlug, variables)}
                >
                  <T>Next Chapter</T> {nextVnTitle ? `(${nextVnTitle})` : ""} →
                </button>
              )}
              <button
                type="button"
                className={`vn-btn-tool ${!nextSlug || !onNextVn ? "active" : ""}`}
                onClick={restart}
              >
                <T>Restart</T>
              </button>
              <button type="button" className="vn-btn-tool" onClick={onClose}>
                <T>Close</T>
              </button>
            </menu>
          </article>
        )}

        {/* Backlog Drawer */}
        {backlogOpen && (
          <aside className="vn-drawer">
            <header className="vn-drawer-header">
              <h3>
                <T>Dialogue History</T>
              </h3>
              <button type="button" className="vn-btn-close" onClick={() => setBacklogOpen(false)}>
                ✕
              </button>
            </header>
            <ol className="vn-drawer-body">
              {history.length === 0 ? (
                <p className="muted">
                  <T>No dialogue history yet.</T>
                </p>
              ) : (
                history.map((item, idx) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: backlog history is append-only
                  <li key={item.slide.id + idx} className="vn-backlog-item">
                    {item.slide.dialogue.speaker && (
                      <cite className="vn-backlog-speaker">{item.slide.dialogue.speaker}</cite>
                    )}
                    <p>{item.slide.dialogue.text}</p>
                    {item.choiceMade && (
                      <p className="muted" style={{ marginTop: 4 }}>
                        ↳ <T>Chose:</T> <strong>{item.choiceMade}</strong>
                      </p>
                    )}
                  </li>
                ))
              )}
            </ol>
          </aside>
        )}

        {/* Variables Drawer */}
        {variablesOpen && (
          <aside className="vn-drawer">
            <header className="vn-drawer-header">
              <h3>
                <T>Variables</T>
              </h3>
              <button
                type="button"
                className="vn-btn-close"
                onClick={() => setVariablesOpen(false)}
              >
                ✕
              </button>
            </header>
            <ol className="vn-drawer-body">
              {Object.keys(variables).length === 0 ? (
                <p className="muted">
                  <T>No variables tracked in this adaptation.</T>
                </p>
              ) : (
                Object.entries(variables).map(([name, val]) => (
                  <li key={name} className="vn-variable-row">
                    <strong className="vn-var-name">{name}</strong>
                    <data className="vn-var-val">{String(val)}</data>
                  </li>
                ))
              )}
            </ol>
          </aside>
        )}
      </section>
    </dialog>
  );
}
