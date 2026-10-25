/**
 * Where the story window sits. Pure functions, so how it moves, resizes and is remembered is
 * tested without a browser.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Open: floating where you put it. Minimized: a small chip. Maximized: fills the page. */
export type View = "open" | "minimized" | "maximized";

export interface Saved {
  box: Box;
  view: View;
}

export const MIN_W = 340;
export const MIN_H = 280;
/** Below this width the window is a sheet from the bottom of the screen: nothing to drag. */
export const NARROW = 640;
/** Space kept clear at the top for the page's own bar. */
const TOP = 56;
const GAP = 16;

export const isNarrow = (viewportW: number) => viewportW < NARROW;

/** Fits inside the viewport, never smaller than the minimum unless the viewport itself is. */
export function clampBox(box: Box, vw: number, vh: number): Box {
  const w = Math.round(Math.min(Math.max(box.w, Math.min(MIN_W, vw)), vw));
  const h = Math.round(Math.min(Math.max(box.h, Math.min(MIN_H, vh)), vh));
  const x = Math.round(Math.min(Math.max(box.x, 0), vw - w));
  const y = Math.round(Math.min(Math.max(box.y, 0), vh - h));
  return { x, y, w, h };
}

/** Docked to the right under the page's bar, so the page stays readable beside it. */
export function defaultBox(vw: number, vh: number): Box {
  const w = Math.min(560, vw - 2 * GAP);
  const h = Math.min(720, vh - TOP - GAP);
  return clampBox({ x: vw - w - GAP, y: TOP, w, h }, vw, vh);
}

export function moveBox(start: Box, dx: number, dy: number, vw: number, vh: number): Box {
  return clampBox({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh);
}

/** Grow or shrink from the bottom right corner; the top left stays put. */
export function resizeBox(start: Box, dw: number, dh: number, vw: number, vh: number): Box {
  return clampBox({ ...start, w: start.w + dw, h: start.h + dh }, vw, vh);
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** What was stored, or nothing if it is missing or not something this code wrote. */
export function parseSaved(text: string | null | undefined): Saved | undefined {
  if (!text) return undefined;
  try {
    const raw = JSON.parse(text) as { box?: Partial<Box>; view?: unknown };
    const b = raw.box;
    if (!b || !finite(b.x) || !finite(b.y) || !finite(b.w) || !finite(b.h)) return undefined;
    const view: View = raw.view === "minimized" || raw.view === "maximized" ? raw.view : "open";
    return { box: { x: b.x, y: b.y, w: b.w, h: b.h }, view };
  } catch {
    return undefined;
  }
}
