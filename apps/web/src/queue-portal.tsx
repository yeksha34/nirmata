import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { bilingual, T } from "./i18n";
import { isActive, type JobsState, jobsActions } from "./jobs/store";
import { useNav } from "./nav";
import type { GenerationJob } from "./types";

const KEY = "nirmata.queue-portal";
const MARGIN = 16;
const STEP = 16;
/** A press that moves less than this is a click (it folds or unfolds), not a drag. */
const DRAG_AFTER = 4;
const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Saved {
  pos: { x: number; y: number } | null;
  open: boolean;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    const p = raw?.pos;
    return {
      pos: p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null,
      open: raw?.open ?? true,
    };
  } catch {
    return { pos: null, open: true };
  }
}

function save(value: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // private browsing: the place lasts until the page is closed
  }
}

const keepOnScreen = (x: number, y: number, w: number, h: number) => ({
  x: Math.round(Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - w))),
  y: Math.round(Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - h))),
});

function percent(job: GenerationJob): number | undefined {
  const counted = job.nodes.filter((n) => n.state !== "cached");
  if (counted.length === 0) return undefined;
  const done = counted.filter((n) => n.state === "done").length;
  const inner = job.progress && job.progress.max > 0 ? job.progress.value / job.progress.max : 0;
  return Math.min(
    1,
    (done + (counted.some((n) => n.state === "active") ? inner : 0)) / counted.length,
  );
}

function where(job: GenerationJob): string {
  if (job.state === "done") return bilingual("Done");
  if (job.state === "error") return bilingual("Failed");
  if (job.state === "cancelled") return bilingual("Cancelled");
  if (job.state === "saving") return bilingual("Download and save");
  if (job.state === "queued") {
    return job.queuePosition
      ? `${bilingual("Wait in ComfyUI queue")} #${job.queuePosition}`
      : bilingual("Prepare prompt and archive previous");
  }
  const node = job.nodes.find((n) => n.state === "active");
  const step = job.progress ? ` ${job.progress.value}/${job.progress.max}` : "";
  return `${node?.title ?? bilingual("Render")}${step}`;
}

/**
 * Every generation request, newest first, in a small panel that floats over any screen. It sits in
 * the bottom left corner until moved, folds to its title bar, and remembers both. It is a native
 * popover (top layer, no portal code) holding a native <details>.
 */
export function QueuePortal() {
  const dispatch = useDispatch();
  const byId = useSelector((s: JobsState) => s.byId);
  const nav = useNav();
  const jobs = useMemo(() => Object.values(byId).sort((a, b) => b.startedAt - a.startedAt), [byId]);
  const live = jobs.filter(isActive).length;

  const saved = useRef<Saved>(load());
  const [pos, setPos] = useState(saved.current.pos);
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );

  // pick the queue up wherever the page opens, and again when the tab comes back
  useEffect(() => {
    dispatch(jobsActions.hydrate());
    const again = () => document.visibilityState === "visible" && dispatch(jobsActions.hydrate());
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [dispatch]);

  const visible = jobs.length > 0;
  useEffect(() => {
    const el = root.current;
    if (!visible || !el) return;
    try {
      el.showPopover();
    } catch {
      // no popover support, or already showing: it is fixed-position either way
    }
  }, [visible]);

  // a smaller window must not strand the panel off screen
  useEffect(() => {
    const fit = () => {
      const el = root.current;
      if (!el || !pos) return;
      const next = keepOnScreen(pos.x, pos.y, el.offsetWidth, el.offsetHeight);
      if (next.x !== pos.x || next.y !== pos.y) setPos(next);
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [pos]);

  const place = useCallback((next: { x: number; y: number } | null) => {
    setPos(next);
    saved.current = { ...saved.current, pos: next };
    save(saved.current);
  }, []);

  const onDown = (e: PointerEvent<HTMLElement>) => {
    const box = root.current?.getBoundingClientRect();
    if (!box || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = root.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_AFTER) return;
    d.moved = true;
    setPos(keepOnScreen(d.left + dx, d.top + dy, el.offsetWidth, el.offsetHeight));
  };
  const onUp = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.current.moved) {
      const el = root.current;
      if (el) place(keepOnScreen(el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight));
    }
  };
  // a drag ends in a click on the title bar; that must not fold the panel
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (drag.current?.moved) e.preventDefault();
    drag.current = null;
  };
  // arrow keys move it too, for anyone without a pointer
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const el = root.current;
    const dir = ARROWS[e.key];
    if (!el || !dir || !e.altKey) return;
    e.preventDefault();
    const box = el.getBoundingClientRect();
    place(
      keepOnScreen(
        box.left + dir[0] * STEP,
        box.top + dir[1] * STEP,
        el.offsetWidth,
        el.offsetHeight,
      ),
    );
  };

  if (!visible) return null;

  const finished = jobs.length - live;
  return (
    <aside
      ref={root}
      popover="manual"
      className="queue-portal"
      aria-label={bilingual("Generation queue")}
      style={pos ? { left: pos.x, top: pos.y, bottom: "auto" } : { left: MARGIN, bottom: MARGIN }}
    >
      <details
        open={saved.current.open}
        onToggle={(e) => {
          saved.current = { ...saved.current, open: e.currentTarget.open };
          save(saved.current);
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the title bar is the drag handle; folding stays native and Alt+arrows move it from the keyboard */}
        <summary
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onClick={onClick}
          onKeyDown={onKey}
          title={bilingual("Drag to move. Alt + arrows moves it too.")}
        >
          <strong>
            <T>Generation queue</T>
          </strong>
          {live > 0 && <small className="vs-count">{live}</small>}
          {finished > 0 && live === 0 && <small className="vs-muted">{finished}</small>}
        </summary>

        <ol className="queue-list">
          {jobs.map((job) => {
            const done = percent(job);
            return (
              <li key={job.id} data-state={job.state}>
                <button
                  type="button"
                  className="queue-open"
                  title={`${job.name} — ${job.error ? bilingual(job.error) : where(job)}`}
                  onClick={() => nav.toVn(job.world, job.slug, job.type, job.name)}
                >
                  <strong>{job.name}</strong>
                  <small>{where(job)}</small>
                </button>
                {isActive(job) ? (
                  <>
                    <progress aria-label={job.name} max={1} value={done ?? undefined} />
                    <button
                      type="button"
                      className="vs-btn vs-btn-quiet"
                      onClick={() => dispatch(jobsActions.cancel(job.id))}
                    >
                      <T>Cancel</T>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="vs-btn vs-btn-quiet"
                    aria-label={bilingual("Dismiss")}
                    onClick={() => dispatch(jobsActions.forget(job.id))}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {finished > 0 && (
          <button
            type="button"
            className="vs-btn queue-clear"
            onClick={() => {
              for (const job of jobs) if (!isActive(job)) dispatch(jobsActions.forget(job.id));
            }}
          >
            <T>Clear finished</T>
          </button>
        )}
      </details>
    </aside>
  );
}
