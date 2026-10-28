import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MODE_LABEL } from "../format";
import { T } from "../i18n";
import { type Block, type Book, inline, MOOD_LABEL, MOODS, type Mood } from "./book";
import { draw, MOOD_WEATHER, seed, step } from "./particles";
import { QuillCursor } from "./QuillCursor";
import { type Ambience, openAmbience } from "./sound";
import {
  clamp,
  keepPlace,
  type PerView,
  perViewFor,
  startPages,
  surfaces,
  viewCount,
  viewOf,
} from "./spread";
import "./reader.css";

/**
 * A paged reader for anything with words in it: a card, a whole world, the story so far, a draft.
 * The text is laid out once into columns the size of a page, and each page is a window onto the
 * right column, so it reflows with the screen and the type size. Turning a page lifts a leaf of
 * the same text around the spine. Behind it are a slow gradient, drifting weather and, if the
 * reader asks, the sound of the room.
 */

const SCALES = [0.86, 1, 1.14, 1.3, 1.5];
const PREFS_KEY = "nirmata.reader";
const TURN_MS = 900;
const GUTTER = 20;
const PAD_TOP = 40;
const PAD_BOTTOM = 52;

interface Prefs {
  scale: number;
  sound: boolean;
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      scale: Number.isInteger(saved.scale) ? clamp(saved.scale as number, 0, SCALES.length - 1) : 1,
      sound: saved.sound === true,
    };
  } catch {
    return { scale: 1, sound: false };
  }
}

function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private window or blocked storage: the reader just does not remember
  }
}

// ---- the text ---------------------------------------------------------------------------------

function Marked({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((part, i) => {
        // pieces of one line never reorder
        const key = `${i}`;
        if (part.t === "b") return <strong key={key}>{part.s}</strong>;
        if (part.t === "i") return <em key={key}>{part.s}</em>;
        if (part.t === "code") return <code key={key}>{part.s}</code>;
        return <Fragment key={key}>{part.s}</Fragment>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p>
          <Marked text={block.text} />
        </p>
      );
    case "lede":
      return (
        <p className="lede">
          <Marked text={block.text} />
        </p>
      );
    case "h": {
      const text = block.app ? <T>{block.text}</T> : <bdi>{block.text}</bdi>;
      return block.level === 3 ? <h3>{text}</h3> : <h4>{text}</h4>;
    }
    case "quote":
      return (
        <blockquote>
          <p>
            <Marked text={block.text} />
          </p>
          {block.by && (
            <cite>
              <bdi>{block.by}</bdi>
              {block.mode && (
                <>
                  {" · "}
                  <T>{MODE_LABEL[block.mode as keyof typeof MODE_LABEL] ?? MODE_LABEL.do}</T>
                </>
              )}
            </cite>
          )}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        // the items of a list never reorder
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <li key={i}>
          <Marked text={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "rule":
      return <hr />;
  }
}

/** The whole book as one flow of text; the pages are windows onto it. */
const Flow = memo(function Flow({ book }: { book: Book }) {
  const last = book.chapters.length - 1;
  return (
    <>
      <header className="cover">
        <p className="kicker">
          <T>{book.kicker}</T>
        </p>
        <h1>{book.title ? <bdi>{book.title}</bdi> : <T>Untitled</T>}</h1>
        {book.lede && <p className="lede">{book.lede}</p>}
        <hr className="ornament" />
        {book.tags.length > 0 && <p className="tags">{book.tags.join(" · ")}</p>}
      </header>
      {book.chapters.map((chapter, i) => (
        <section key={chapter.id} className="chapter" data-chapter={chapter.id}>
          {chapter.kicker && (
            <p className="kicker">
              <T>{chapter.kicker}</T>
            </p>
          )}
          {chapter.title && (
            <h2>{chapter.app ? <T>{chapter.title}</T> : <bdi>{chapter.title}</bdi>}</h2>
          )}
          {chapter.blocks.map((block, n) => (
            // a chapter's blocks never reorder
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <BlockView key={n} block={block} />
          ))}
          {i === last && (
            <p className="the-end">
              <T>The end</T>
            </p>
          )}
        </section>
      ))}
    </>
  );
});

// ---- the pages --------------------------------------------------------------------------------

interface PageProps {
  book: Book;
  /** The page this surface shows (a column of the flow); none leaves it blank paper. */
  col: number | null;
  side: "left" | "right" | "front" | "back";
  flowWidth: number;
  /** Anything that changes where a column starts, so the window is put back on its column. */
  layoutKey: string;
  /** The reading copy: the others repeat it and are hidden from screen readers. */
  main?: boolean;
  flowRef?: (el: HTMLElement | null) => void;
}

function Page({ book, col, side, flowWidth, layoutKey, main, flowRef }: PageProps) {
  const own = useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey stands for the layout
  useLayoutEffect(() => {
    if (own.current && col !== null) own.current.scrollLeft = col * flowWidth;
  }, [col, flowWidth, layoutKey]);
  return (
    <section className={`page page-${side}`} aria-hidden={main ? undefined : true}>
      {col !== null && (
        <article
          className="flow"
          ref={(el) => {
            own.current = el;
            flowRef?.(el);
          }}
        >
          <Flow book={book} />
        </article>
      )}
      {col !== null && col > 0 && (
        <footer className="folio">
          <data value={col + 1}>{col + 1}</data>
        </footer>
      )}
    </section>
  );
}

// ---- the air ----------------------------------------------------------------------------------

function Atmosphere({ mood }: { mood: Mood }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const kind = MOOD_WEATHER[mood];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let ps = seed(kind, 0, 0);
    let frame = 0;
    let last = performance.now();
    let time = 0;

    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      draw(ctx, kind, ps, time);
    };
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ps = seed(kind, w, h);
      paint();
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      step(kind, ps, w, h, dt, time);
      paint();
      frame = requestAnimationFrame(tick);
    };

    const watcher = new ResizeObserver(fit);
    watcher.observe(canvas);
    fit();
    if (!still && kind !== "none") frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
    };
  }, [mood]);
  // paint only: it takes no focus and says nothing
  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas that is never focused
  return <canvas ref={ref} className="atmosphere" aria-hidden="true" />;
}

// ---- the reader -------------------------------------------------------------------------------

function Chevron({ flip }: { flip?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLElement>(null);
  const measured = useRef<HTMLElement | null>(null);
  const sound = useRef<Ambience | null>(null);
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  const reduced = useRef(false);
  const counted = useRef(1);
  const next = useRef<number | null>(null);
  const turning = useRef<{ from: number; to: number } | null>(null);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [mood, setMood] = useState<Mood>(book.mood);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [starts, setStarts] = useState<number[]>([]);
  const [turn, setTurn] = useState<{ from: number; to: number } | null>(null);
  const [heard, setHeard] = useState(false);
  const [fontsAt, setFontsAt] = useState(0);

  // the room: how many pages at once, how big a page is, how much of it is text
  const perView: PerView = perViewFor(size.w);
  const room = Math.max(0, size.w - GUTTER * 2);
  const pageW = Math.floor(Math.min(room, perView === 2 ? 1180 : 600) / perView);
  const pageH = Math.floor(Math.min(Math.max(0, size.h - 12), Math.round(pageW * 1.5)));
  const padX = pageW < 420 ? 24 : 46;
  const flowW = Math.max(40, pageW - padX * 2);
  const flowH = Math.max(40, pageH - PAD_TOP - PAD_BOTTOM);
  const ready = size.w > 0 && size.h > 0;
  const layoutKey = `${flowW}x${flowH}@${prefs.scale}:${fontsAt}`;

  const views = viewCount(pages, perView);
  const view = clamp(viewOf(page, perView), 0, views - 1);
  const shown = surfaces(view, turn, perView, pages);

  // open as a dialog; Escape puts it away
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // measure the room it has
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setSize({ w: Math.floor(box.width), h: Math.floor(box.height) });
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // the type may arrive after the first layout, and moves every page break
  useEffect(() => {
    void document.fonts?.ready.then(() => setFontsAt((n) => n + 1));
  }, []);

  // how many pages the text makes, and where each chapter starts
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey stands for the layout
  useLayoutEffect(() => {
    const flow = measured.current;
    if (!flow || !ready) return;
    const total = Math.max(1, Math.ceil((flow.scrollWidth - 1) / flowW));
    const origin = flow.getBoundingClientRect().left;
    const offsets = [...flow.querySelectorAll<HTMLElement>("[data-chapter]")].map(
      (el) => el.getBoundingClientRect().left - origin + flow.scrollLeft,
    );
    const before = counted.current;
    setPage((p) => keepPlace(p, before, total));
    counted.current = total;
    setPages(total);
    setStarts(startPages(offsets, flowW));
  }, [layoutKey, ready, book, flowW]);

  // the paper swish and the room's sound follow the page and the mood
  useEffect(() => {
    sound.current?.setMood(mood);
  }, [mood]);
  // only on opening and closing: switching it on and off is the button's job
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (prefs.sound && !sound.current) {
      sound.current = openAmbience(mood);
      setHeard(sound.current !== null);
    }
    return () => {
      sound.current?.close();
      sound.current = null;
    };
  }, []);

  const toggleSound = () => {
    if (sound.current) {
      sound.current.close();
      sound.current = null;
      setHeard(false);
      const next = { ...prefs, sound: false };
      setPrefs(next);
      savePrefs(next);
      return;
    }
    sound.current = openAmbience(mood);
    const on = sound.current !== null;
    setHeard(on);
    const next = { ...prefs, sound: on };
    setPrefs(next);
    savePrefs(next);
  };

  const resize = (by: number) => {
    const next = { ...prefs, scale: clamp(prefs.scale + by, 0, SCALES.length - 1) };
    setPrefs(next);
    savePrefs(next);
  };

  // turning: the leaf in the air is also kept in a ref, so keys pressed in the same instant see it
  const begin = (t: { from: number; to: number } | null) => {
    turning.current = t;
    setTurn(t);
  };
  const finish = () => {
    const t = turning.current;
    if (!t) return;
    setPage(t.to * perView);
    // a page asked for while this one was turning goes on straight away
    const queued = next.current;
    next.current = null;
    if (queued !== null && queued !== t.to) {
      begin({ from: t.to, to: queued });
      sound.current?.flip();
    } else begin(null);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: finish reads the ref, not the state
  useEffect(() => {
    if (!turn) return;
    // the animation's own end is the usual way out; this is for a hidden tab that never fires it
    const timer = window.setTimeout(finish, TURN_MS + 500);
    return () => window.clearTimeout(timer);
  }, [turn]);

  const go = (to: number) => {
    const target = clamp(to, 0, views - 1);
    if (turning.current) {
      next.current = target;
      return;
    }
    if (target === view) return;
    if (reduced.current || !ready) {
      setPage(target * perView);
      return;
    }
    begin({ from: view, to: target });
    sound.current?.flip();
  };
  /** Pages on from where the reader is heading, which is further on while a leaf is turning. */
  const by = (n: number) => go((next.current ?? turning.current?.to ?? view) + n);
  const jump = (to: number) => {
    if (!turning.current) setPage(clamp(to, 0, views - 1) * perView);
  };

  const onKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("input") || e.altKey || e.ctrlKey || e.metaKey) return;
    const onButton = target.closest("button, summary") !== null;
    if (
      e.key === "ArrowRight" ||
      e.key === "PageDown" ||
      (e.key === " " && !e.shiftKey && !onButton)
    )
      by(1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) by(-1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(views - 1);
    else return;
    e.preventDefault();
  };

  const onDown = (e: PointerEvent<HTMLElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent<HTMLElement>) => {
    const from = swipe.current;
    swipe.current = undefined;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > 48 && Math.abs(dy) < 70) {
      by(dx < 0 ? 1 : -1);
      return;
    }
    // a tap near an edge turns the page; a tap among the words does not
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && !window.getSelection()?.toString()) {
      const box = e.currentTarget.getBoundingClientRect();
      const at = (e.clientX - box.left) / box.width;
      if (at < 0.22) by(-1);
      else if (at > 0.78) by(1);
    }
  };

  const here = starts.reduce((n, s, i) => (s <= page ? i : n), -1);
  const titled = book.chapters.flatMap((c, i) => (c.title ? [{ c, i }] : []));
  const closeMenu = (e: { currentTarget: HTMLElement }) => {
    const menu = e.currentTarget.closest("details");
    if (menu) menu.open = false;
  };

  const style = {
    "--pw": `${pageW}px`,
    "--ph": `${pageH}px`,
    "--bw": `${pageW * perView}px`,
    "--fw": `${flowW}px`,
    "--fh": `${flowH}px`,
    "--padx": `${padX}px`,
    "--padt": `${PAD_TOP}px`,
    "--padb": `${PAD_BOTTOM}px`,
    "--scale": SCALES[prefs.scale],
    "--turn": `${TURN_MS}ms`,
  } as CSSProperties;

  const pageProps = { book, flowWidth: flowW, layoutKey };

  return (
    <dialog
      ref={dialog}
      className="reader"
      data-mood={mood}
      aria-labelledby="reader-title"
      onClose={onClose}
      onKeyDown={onKey}
    >
      <Atmosphere mood={mood} />
      <QuillCursor />

      <header className="reader-bar">
        <button type="button" className="reader-close" onClick={onClose}>
          <Chevron flip />
          <T>Close</T>
        </button>
        <hgroup>
          <p className="kicker">
            <T>{book.kicker}</T>
          </p>
          <h2 id="reader-title">{book.title ? <bdi>{book.title}</bdi> : <T>Untitled</T>}</h2>
        </hgroup>
        <menu className="reader-tools">
          {titled.length > 0 && (
            <li>
              <details className="menu">
                <summary>
                  <T>Contents</T>
                </summary>
                <menu className="menu-body toc">
                  <li>
                    <button
                      type="button"
                      aria-current={here < 0 ? "true" : undefined}
                      onClick={(e) => {
                        closeMenu(e);
                        go(0);
                      }}
                    >
                      <T>Title page</T>
                    </button>
                  </li>
                  {titled.map(({ c, i }) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-current={here === i ? "true" : undefined}
                        onClick={(e) => {
                          closeMenu(e);
                          go(viewOf(starts[i] ?? 0, perView));
                        }}
                      >
                        {c.app ? <T>{c.title}</T> : <bdi>{c.title}</bdi>}
                      </button>
                    </li>
                  ))}
                </menu>
              </details>
            </li>
          )}
          <li>
            <details className="menu">
              <summary>
                <T>Mood</T>
              </summary>
              <menu className="menu-body moods">
                {MOODS.map((m) => (
                  <li key={m}>
                    <button
                      type="button"
                      className="mood-pick"
                      data-mood={m}
                      aria-pressed={mood === m}
                      onClick={(e) => {
                        closeMenu(e);
                        setMood(m);
                      }}
                    >
                      <T>{MOOD_LABEL[m]}</T>
                    </button>
                  </li>
                ))}
              </menu>
            </details>
          </li>
          <li>
            <button
              type="button"
              className="tool"
              aria-label="Smaller text"
              disabled={prefs.scale === 0}
              onClick={() => resize(-1)}
            >
              A−
            </button>
          </li>
          <li>
            <button
              type="button"
              className="tool"
              aria-label="Larger text"
              disabled={prefs.scale === SCALES.length - 1}
              onClick={() => resize(1)}
            >
              A+
            </button>
          </li>
          <li>
            <button type="button" className="tool" aria-pressed={heard} onClick={toggleSound}>
              <T>{heard ? "Sound on" : "Sound off"}</T>
            </button>
          </li>
        </menu>
      </header>

      <section ref={stage} className="stage" aria-label="Pages">
        {ready && (
          // the keyboard turns pages from the dialog; a tap or a swipe is the touch way
          <article
            className="book"
            style={style}
            data-per={perView}
            data-turning={turn ? (turn.to > turn.from ? "forward" : "back") : undefined}
            data-wide={pageW >= 420 ? "" : undefined}
            onPointerDown={onDown}
            onPointerUp={onUp}
          >
            {perView === 2 && (
              <Page
                {...pageProps}
                col={shown.left}
                side="left"
                main
                flowRef={(el) => {
                  measured.current = el;
                }}
              />
            )}
            <Page
              {...pageProps}
              col={shown.right}
              side="right"
              main={perView === 1}
              flowRef={
                perView === 1
                  ? (el) => {
                      measured.current = el;
                    }
                  : undefined
              }
            />
            {turn && (
              <figure
                key={`${turn.from}-${turn.to}`}
                className={`leaf leaf-${turn.to > turn.from ? "forward" : "back"}`}
                aria-hidden="true"
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) finish();
                }}
              >
                <Page {...pageProps} col={shown.front ?? null} side="front" />
                <Page {...pageProps} col={shown.back ?? null} side="back" />
              </figure>
            )}
          </article>
        )}
        <small className="reader-hint">
          <T>Turn the page with the arrow keys, or swipe</T>
        </small>
      </section>

      <footer className="reader-foot">
        <button
          type="button"
          className="turn"
          aria-label="Previous page"
          disabled={(turn?.to ?? view) === 0}
          onClick={() => by(-1)}
        >
          <Chevron flip />
        </button>
        <input
          type="range"
          aria-label="Page"
          min={0}
          max={Math.max(0, views - 1)}
          value={view}
          disabled={views < 2}
          onChange={(e) => jump(Number(e.target.value))}
        />
        <output className="reader-page">
          <T with={{ n: view * perView + 1, total: pages }}>{"Page {n} of {total}"}</T>
        </output>
        <button
          type="button"
          className="turn"
          aria-label="Next page"
          disabled={(turn?.to ?? view) >= views - 1}
          onClick={() => by(1)}
        >
          <Chevron />
        </button>
      </footer>
    </dialog>
  );
}
