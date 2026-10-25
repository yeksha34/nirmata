import type { Card } from "./cards";
import {
  type AdventureEvent,
  type AdventureState,
  newEvent,
  type PlotPointInput,
  pathTo,
  plotPointId,
  turnOf,
} from "./events";
import type { Turn } from "./schema";

export interface PlotOptions {
  /** A host setting: revoked points stay revoked on every branch, not just where they were revoked. */
  revokesSurviveUndo?: boolean;
}

export interface PlotPoint {
  /** `<plot event id>:<index>`, the handle used to revoke it. */
  id: string;
  card: string;
  text: string;
  /** The `plot` event that recorded it. */
  eventId: string;
}

/**
 * Plot points in force on this branch, oldest first: every point from every `plot` event on the
 * path, minus the ones an `unplot` event on the same path took back. Because they live on the
 * branch, undoing or branching away from the turns that produced them removes them too.
 */
export function plotPointsOf(
  state: AdventureState,
  at: string | null = state.head,
  options: PlotOptions = {},
): PlotPoint[] {
  const path = pathTo(state, at);
  // By default a revoke counts only on the branch it was made on, so undoing a turn also undoes
  // a revoke made after it. With `revokesSurviveUndo` a point stays revoked on every branch.
  const revokers = options.revokesSurviveUndo ? [...state.events.values()] : path;
  const revoked = new Set(revokers.flatMap((ev) => (ev.kind === "unplot" ? ev.revokes : [])));
  return path.flatMap((ev) =>
    ev.kind === "plot"
      ? ev.points
          .map((p, i) => ({
            id: plotPointId(ev.id, i),
            card: p.card,
            text: p.text,
            eventId: ev.id,
          }))
          .filter((p) => !revoked.has(p.id))
      : [],
  );
}

/** The newest turn the plot extraction has already read on this branch, or null. */
export function plotCursor(state: AdventureState, at: string | null = state.head): string | null {
  const path = pathTo(state, at);
  for (let i = path.length - 1; i >= 0; i--) {
    const ev = path[i];
    if (ev?.kind === "plot" && ev.covers) return ev.covers;
  }
  return null;
}

/** Turns written since the extraction last ran, oldest first. */
export function turnsSincePlot(state: AdventureState, at: string | null = state.head): Turn[] {
  const path = pathTo(state, at);
  const cursor = plotCursor(state, at);
  const from = cursor === null ? 0 : path.findIndex((ev) => ev.id === cursor) + 1;
  return path.slice(from).flatMap((ev) => turnOf(ev) ?? []);
}

export const PLOT_HEADING = "**What has happened so far:**";

/**
 * Returns the cards with their plot points appended to the body, newest `maxPerCard` points each.
 * The inputs are not changed, and a card with no points is returned as is. Points for a card that
 * is not in `cards` are simply not shown.
 */
export function cardsWithPlot(
  cards: readonly Card[],
  points: readonly PlotPoint[],
  maxPerCard = 8,
): Card[] {
  if (!points.length) return [...cards];
  const byCard = new Map<string, string[]>();
  for (const p of points) byCard.set(p.card, [...(byCard.get(p.card) ?? []), p.text]);
  return cards.map((card) => {
    const texts = byCard.get(card.fm.id);
    if (!texts?.length) return card;
    // A card may ask to show fewer points, or a different heading (the current-situation card).
    const limit = typeof card.fm.plotMax === "number" ? card.fm.plotMax : maxPerCard;
    const heading = typeof card.fm.plotHeading === "string" ? card.fm.plotHeading : PLOT_HEADING;
    const list = texts
      .slice(-limit)
      .map((t) => `- ${t}`)
      .join("\n");
    return { ...card, body: `${card.body.trimEnd()}\n\n${heading}\n${list}\n` };
  });
}

/** A `plot` event holding the points found, whose `covers` becomes the new extraction cursor. */
export function plotEvent(
  state: AdventureState,
  args: {
    id: string;
    t: string;
    covers: string;
    points: readonly PlotPointInput[];
    model?: string;
  },
): AdventureEvent {
  return newEvent({
    id: args.id,
    parentId: state.head,
    t: args.t,
    kind: "plot",
    covers: args.covers,
    points: [...args.points],
    ...(args.model ? { model: args.model } : {}),
  });
}

/** Take back specific plot points. */
export function unplotEvent(
  state: AdventureState,
  args: { id: string; t: string; revokes: readonly string[] },
): AdventureEvent {
  return newEvent({
    id: args.id,
    parentId: state.head,
    t: args.t,
    kind: "unplot",
    revokes: [...args.revokes],
  });
}

/**
 * Undo the latest batch: revokes every point still in force from the newest `plot` event that has
 * any. Returns undefined when there is nothing to take back.
 */
export function undoLastPlotEvent(
  state: AdventureState,
  id: string,
  t: string,
  options: PlotOptions = {},
): AdventureEvent | undefined {
  const live = plotPointsOf(state, state.head, options);
  const newest = live[live.length - 1];
  if (!newest) return undefined;
  const batch = live.filter((p) => p.eventId === newest.eventId).map((p) => p.id);
  return unplotEvent(state, { id, t, revokes: batch });
}

/**
 * Add one point by hand. It has no `covers`, so it never moves the extraction cursor: the
 * automatic extraction still reads the same turns and will not skip anything.
 */
export function manualPlotEvent(
  state: AdventureState,
  args: { id: string; t: string; card: string; text: string },
): AdventureEvent {
  if (state.head === null) {
    throw new Error("There is nothing in the story yet to attach a plot point to.");
  }
  return newEvent({
    id: args.id,
    parentId: state.head,
    t: args.t,
    kind: "plot",
    points: [{ card: args.card, text: args.text }],
  });
}
