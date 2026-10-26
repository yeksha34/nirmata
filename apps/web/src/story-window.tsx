import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Tip } from "./controls";
import { T } from "./i18n";
import {
  type Box,
  clampBox,
  defaultBox,
  isNarrow,
  moveBox,
  parseSaved,
  resizeBox,
  type View,
} from "./window-geometry";

const KEY = "nirmata.window";

function useViewport() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

function load() {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return undefined; // storage blocked: the window still works, it just forgets
  }
}

type Drag = { kind: "move" | "size"; id: number; x: number; y: number; start: Box };

/**
 * A window that floats above the page, mounted on `<body>` through a portal so nothing behind it
 * clips or stacks over it. Drag it by its title bar, resize it from the corner, shrink it to a
 * chip, or fill the page; it remembers where you left it. On a phone it is a sheet from the
 * bottom instead. The page behind stays usable, and the story inside keeps running whatever the
 * window is doing, because the story lives in the app and not in the window.
 */
export function StoryWindow({
  title,
  heading,
  working,
  children,
}: {
  title: string;
  /** What the title bar shows, when it is words of the app's own rather than a world's name. */
  heading?: ReactNode;
  /** The story is being written right now: shown on the chip when the window is minimized. */
  working: boolean;
  children: ReactNode;
}) {
  const vp = useViewport();
  const narrow = isNarrow(vp.w);
  const [box, setBox] = useState<Box>(() =>
    clampBox(load()?.box ?? defaultBox(vp.w, vp.h), vp.w, vp.h),
  );
  const [view, setView] = useState<View>(() => load()?.view ?? "open");
  const drag = useRef<Drag | undefined>(undefined);
  const chip = useRef<HTMLButtonElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const changed = useRef(false);

  // keep it on the screen when the screen shrinks
  useEffect(() => {
    setBox((b) => clampBox(b, vp.w, vp.h));
  }, [vp.w, vp.h]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ box, view }));
    } catch {
      // private browsing: it lasts until the page is closed
    }
  }, [box, view]);

  // after minimizing or restoring, keep keyboard focus on the thing that is now there
  useEffect(() => {
    if (!changed.current) return;
    (view === "minimized" ? chip.current : grip.current)?.focus();
  }, [view]);

  const show = (next: View) => {
    changed.current = true;
    setView(next);
  };

  const begin = (kind: Drag["kind"]) => (e: PointerEvent<HTMLElement>) => {
    if (narrow || view !== "open") return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, start: box };
  };
  const track = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setBox(
      d.kind === "move"
        ? moveBox(d.start, dx, dy, vp.w, vp.h)
        : resizeBox(d.start, dx, dy, vp.w, vp.h),
    );
  };
  const end = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = undefined;
  };

  // arrow keys do what dragging does; Shift takes bigger steps
  const nudge = (kind: Drag["kind"]) => (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = by[e.key];
    if (!delta) return;
    e.preventDefault();
    setBox((b) =>
      kind === "move"
        ? moveBox(b, delta[0], delta[1], vp.w, vp.h)
        : resizeBox(b, delta[0], delta[1], vp.w, vp.h),
    );
  };

  if (view === "minimized") {
    return createPortal(
      <button
        ref={chip}
        type="button"
        className="win-chip"
        onClick={() => show("open")}
        aria-label={`Open the story: ${title}`}
      >
        <span className={`dot ${working ? "dot-live" : ""}`} aria-hidden="true" />
        <span className="win-chip-title">{heading ?? title}</span>
        <span className="muted">
          <T>{working ? "writing…" : "story"}</T>
        </span>
      </button>,
      document.body,
    );
  }

  const maximized = view === "maximized";
  const style =
    narrow || maximized ? undefined : { left: box.x, top: box.y, width: box.w, height: box.h };

  return createPortal(
    <section
      className={`win${maximized ? " is-maximized" : ""}${narrow ? " is-sheet" : ""}`}
      style={style}
      aria-label={`Story: ${title}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging and double-click are mouse shortcuts; the grip button (arrow keys) and the maximize button do the same by keyboard */}
      <header
        className="win-bar"
        onPointerDown={begin("move")}
        onPointerMove={track}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!narrow && !(e.target as HTMLElement).closest("[data-no-drag]")) {
            show(maximized ? "open" : "maximized");
          }
        }}
      >
        {!narrow && !maximized ? (
          <button
            ref={grip}
            type="button"
            className="win-grip plain"
            aria-label="Move the story window. Use the arrow keys, or drag the title bar."
            onKeyDown={nudge("move")}
          >
            ⠿
          </button>
        ) : (
          <span className="win-grip" aria-hidden="true" />
        )}
        <span className="win-title">{heading ?? title}</span>
        <div className="win-buttons" data-no-drag>
          <Tip below text="Minimize">
            <button
              type="button"
              className="plain"
              aria-label="Minimize the story"
              onClick={() => show("minimized")}
            >
              –
            </button>
          </Tip>
          {!narrow && (
            <Tip below text={maximized ? "Restore" : "Fill the page"}>
              <button
                type="button"
                className="plain"
                aria-label={maximized ? "Restore the story window" : "Fill the page"}
                onClick={() => show(maximized ? "open" : "maximized")}
              >
                {maximized ? "❐" : "□"}
              </button>
            </Tip>
          )}
        </div>
      </header>
      <div className="win-body">{children}</div>
      {!narrow && !maximized && (
        <button
          type="button"
          className="win-resize"
          aria-label="Resize the story window. Use the arrow keys, or drag this corner."
          onPointerDown={begin("size")}
          onPointerMove={track}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={nudge("size")}
        />
      )}
    </section>,
    document.body,
  );
}
