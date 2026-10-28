/**
 * Which page each surface of the open book shows. On a wide screen the book is a spread of two
 * pages and a turning leaf; on a narrow one it is a single page, which is the right-hand slot with
 * nothing on the left. A leaf has a front (the right-hand page it lifts off) and a back (the
 * left-hand page it lands on), and turning from one view to another is one leaf either way: a jump
 * to a chapter turns a single leaf, it does not flick through the pages between.
 */

export type PerView = 1 | 2;

/** Pages on screen at once. */
export const perViewFor = (width: number): PerView => (width >= 860 ? 2 : 1);

export const viewCount = (pages: number, perView: PerView): number =>
  Math.max(1, Math.ceil(pages / perView));

/** The view a page is in (a view is a spread, or the single page). */
export const viewOf = (page: number, perView: PerView): number => Math.floor(page / perView);

export const clamp = (n: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, n));

/** The page in one slot of a view, or null where the book has none (past its end, or no left side). */
export function pageAt(
  view: number,
  side: "left" | "right",
  perView: PerView,
  pages: number,
): number | null {
  const n = perView === 2 ? view * 2 + (side === "right" ? 1 : 0) : side === "right" ? view : -1;
  return n >= 0 && n < pages ? n : null;
}

export interface Surfaces {
  left: number | null;
  right: number | null;
  /** Only while a leaf is turning. */
  front?: number | null;
  back?: number | null;
}

/**
 * What every surface shows. At rest, the view's own two pages. While turning forward, the left
 * stays on the page being left behind and the right is already the next one, under the leaf;
 * turning back is the same picture the other way round.
 */
export function surfaces(
  view: number,
  turning: { from: number; to: number } | null,
  perView: PerView,
  pages: number,
): Surfaces {
  const at = (v: number, side: "left" | "right") => pageAt(v, side, perView, pages);
  if (!turning) return { left: at(view, "left"), right: at(view, "right") };
  const { from, to } = turning;
  return to > from
    ? {
        left: at(from, "left"),
        right: at(to, "right"),
        front: at(from, "right"),
        back: at(to, "left"),
      }
    : {
        left: at(to, "left"),
        right: at(from, "right"),
        front: at(to, "right"),
        back: at(from, "left"),
      };
}

/** Where in a book of `pages` pages the same place falls after the page count changes. */
export function keepPlace(page: number, before: number, after: number): number {
  if (before <= 1 || before === after) return clamp(page, 0, Math.max(0, after - 1));
  return clamp(Math.round((page / (before - 1)) * (after - 1)), 0, Math.max(0, after - 1));
}

/** The page each chapter starts on, from how far along the flow it was found. */
export const startPages = (offsets: readonly number[], step: number): number[] =>
  offsets.map((x) => Math.max(0, Math.floor((x + 1) / step)));
