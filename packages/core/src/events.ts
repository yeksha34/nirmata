import { z } from "zod";
import { formatIssues, type Memory, PlayerMode, type Turn } from "./schema";

/**
 * An adventure is an append-only log of events forming a tree.
 *
 * - Content events (`player`, `host`, `system`, `summary`, `plot`, `unplot`, `break`, `pin`,
 *   `unpin`) are tree nodes: each points at its `parentId`, and appending one makes it the new head.
 * - A `goto` event moves the head without adding a node (undo, branch navigation).
 * - The visible story is the path from a root to the head. Everything else a branch knows (memory,
 *   the context window, chapters, plot points) is derived from that same path, so undo, retry,
 *   edit and branching keep all of it consistent (ADR-0008).
 *
 * Nothing here reads a clock or generates ids: callers supply `id` and `t`, which keeps the whole
 * module pure and replayable.
 */
export const EVENT_KINDS = [
  "player",
  "host",
  "system",
  "summary",
  "plot",
  "unplot",
  "break",
  "pin",
  "unpin",
  "goto",
] as const;
export const EventKind = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof EventKind>;

/** One plot point as carried in a `plot` event: something that happened, attached to a card. */
export const PlotPointInput = z.object({
  card: z.string().min(1),
  text: z.string().trim().min(1),
});
export type PlotPointInput = z.output<typeof PlotPointInput>;

export const AdventureEvent = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    /** ISO-8601 timestamp supplied by the caller. */
    t: z.string().min(1),
    kind: EventKind,
    mode: PlayerMode.optional(),
    /** Turn text, summary, pinned fact, or (for `break`) the new chapter's title. */
    text: z.string().default(""),
    /** Card ids that were in the prompt that produced this host event. */
    cardsUsed: z.array(z.string()).default([]),
    model: z.string().optional(),
    /** Host events only: ids of rules the reply was judged to break (empty when it passed). */
    flags: z.array(z.string()).default([]),
    /**
     * Host events only: the newest turn that was already outside the context window when this
     * reply was written. Everything up to and including it is in the chapter, not the prompt.
     */
    shifted: z.string().min(1).optional(),
    /** `plot` only: the newest turn the extraction read (the extraction cursor). Absent when the points were added by hand. */
    covers: z.string().min(1).optional(),
    /** `plot` only: the points found. May be empty; the event still moves the cursor. */
    points: z.array(PlotPointInput).default([]),
    /** `unplot` only: ids (`<plot event id>:<index>`) of points to take back. */
    revokes: z.array(z.string().min(1)).default([]),
    /** Set when this event is an edited replacement for an earlier sibling. */
    editOf: z.string().optional(),
    /** `goto` only: the node to make the head, or null for "before everything". */
    target: z.string().nullable().optional(),
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (e.kind === "goto") {
      if (e.target === undefined) issue("target", "goto events need a target");
      if (e.parentId !== null) issue("parentId", "goto events have no parent");
    }
    if (e.kind === "player" && !e.mode) issue("mode", "player events need a mode");
    if (e.kind === "unplot" && !e.revokes.length) issue("revokes", "unplot events need revokes");
    if (e.parentId === e.id) issue("parentId", "an event cannot be its own parent");
  });
export type AdventureEvent = z.output<typeof AdventureEvent>;
export type AdventureEventInput = z.input<typeof AdventureEvent>;

export function newEvent(input: AdventureEventInput): AdventureEvent {
  return AdventureEvent.parse(input);
}

export interface AdventureState {
  readonly events: ReadonlyMap<string, AdventureEvent>;
  /** Every event id in log order, `goto`s included. */
  readonly log: readonly string[];
  /** Child node ids per parent (null = roots), in log order. `goto`s are never children. */
  readonly children: ReadonlyMap<string | null, readonly string[]>;
  readonly head: string | null;
}

export const emptyAdventure: AdventureState = {
  events: new Map(),
  log: [],
  children: new Map(),
  head: null,
};

interface Draft {
  events: Map<string, AdventureEvent>;
  log: string[];
  children: Map<string | null, string[]>;
  head: string | null;
}

function isNode(state: { events: ReadonlyMap<string, AdventureEvent> }, id: string): boolean {
  const ev = state.events.get(id);
  return ev !== undefined && ev.kind !== "goto";
}

function isAncestorOrSelf(
  state: { events: ReadonlyMap<string, AdventureEvent> },
  from: string | null,
  target: string | undefined,
): boolean {
  let cur = from;
  while (cur !== null) {
    if (cur === target) return true;
    cur = state.events.get(cur)?.parentId ?? null;
  }
  return false;
}

/** Plot point ids look like `<plot event id>:<index>`. */
export function plotPointId(eventId: string, index: number): string {
  return `${eventId}:${index}`;
}

function reduce(draft: Draft, ev: AdventureEvent): void {
  if (draft.events.has(ev.id)) throw new Error(`duplicate event id "${ev.id}"`);

  if (ev.kind === "goto") {
    if (ev.target !== null && ev.target !== undefined && !isNode(draft, ev.target)) {
      throw new Error(`goto ${ev.id}: unknown target "${ev.target}"`);
    }
    draft.head = ev.target ?? null;
  } else {
    if (ev.parentId !== null && !isNode(draft, ev.parentId)) {
      throw new Error(`event ${ev.id}: unknown parent "${ev.parentId}"`);
    }
    for (const [field, target] of [
      ["shifted", ev.shifted],
      ["covers", ev.covers],
    ] as const) {
      if (target !== undefined && !isAncestorOrSelf(draft, ev.parentId, target)) {
        throw new Error(`event ${ev.id}: ${field} "${target}" is not on its branch`);
      }
    }
    for (const id of ev.revokes) {
      const at = id.lastIndexOf(":");
      const plot = at === -1 ? undefined : draft.events.get(id.slice(0, at));
      const index = Number(id.slice(at + 1));
      if (
        plot?.kind !== "plot" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= plot.points.length ||
        !isAncestorOrSelf(draft, ev.parentId, plot.id)
      ) {
        throw new Error(`unplot ${ev.id}: "${id}" is not a plot point on its branch`);
      }
    }
    const siblings = draft.children.get(ev.parentId) ?? [];
    siblings.push(ev.id);
    draft.children.set(ev.parentId, siblings);
    draft.head = ev.id;
  }
  draft.events.set(ev.id, ev);
  draft.log.push(ev.id);
}

/** Applies one event, returning a new state. Throws on an invalid event. */
export function applyEvent(state: AdventureState, ev: AdventureEvent): AdventureState {
  const draft: Draft = {
    events: new Map(state.events),
    log: [...state.log],
    children: new Map([...state.children].map(([k, v]) => [k, [...v]])),
    head: state.head,
  };
  reduce(draft, ev);
  return draft;
}

/** Rebuilds state from a whole log in linear time. */
export function replay(events: readonly AdventureEvent[]): AdventureState {
  const draft: Draft = { events: new Map(), log: [], children: new Map(), head: null };
  for (const ev of events) reduce(draft, ev);
  return draft;
}

/** Nodes from the root down to `id` (default: the head). */
export function pathTo(state: AdventureState, id: string | null = state.head): AdventureEvent[] {
  const path: AdventureEvent[] = [];
  let cur = id;
  while (cur !== null) {
    const ev = state.events.get(cur);
    if (!ev) throw new Error(`unknown event "${cur}"`);
    path.push(ev);
    cur = ev.parentId;
  }
  return path.reverse();
}

export function turnOf(ev: AdventureEvent): Turn | undefined {
  if (ev.kind === "player") return { id: ev.id, role: "player", mode: ev.mode, text: ev.text };
  if (ev.kind === "host") return { id: ev.id, role: "host", text: ev.text };
  return undefined;
}

/** The conversation the player currently sees, oldest first (or as of node `at`). */
export function turnsOf(state: AdventureState, at: string | null = state.head): Turn[] {
  return pathTo(state, at).flatMap((ev) => turnOf(ev) ?? []);
}

/**
 * Memory as of the head (or node `at`): the last summary on the path, plus pins that were not
 * later unpinned. Asking "as of the parent" is how a retry avoids remembering the reply it
 * replaces.
 */
export function memoryOf(state: AdventureState, at: string | null = state.head): Memory {
  const memory: Memory = { summary: "", pinned: [] };
  for (const ev of pathTo(state, at)) {
    if (ev.kind === "summary") memory.summary = ev.text;
    else if (ev.kind === "pin") memory.pinned.push(ev.text);
    else if (ev.kind === "unpin") {
      const i = memory.pinned.indexOf(ev.text);
      if (i >= 0) memory.pinned.splice(i, 1);
    }
  }
  return memory;
}

/** Alternative replies/inputs at the same point, including `id` itself, in log order. */
export function siblingsOf(state: AdventureState, id: string): AdventureEvent[] {
  const ev = state.events.get(id);
  if (!ev || ev.kind === "goto") return [];
  return (state.children.get(ev.parentId) ?? []).map(
    (sid) => state.events.get(sid) as AdventureEvent,
  );
}

export function lastOnPath(
  state: AdventureState,
  kind: EventKind,
  at: string | null = state.head,
): AdventureEvent | undefined {
  const path = pathTo(state, at);
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i]?.kind === kind) return path[i];
  }
  return undefined;
}

/**
 * Undo = take back the most recent player action and everything after it, including any plot
 * points and window shifts that came with it.
 * Returns the `goto` event to append, or undefined when there is nothing to undo.
 */
export function undoEvent(
  state: AdventureState,
  id: string,
  t: string,
): AdventureEvent | undefined {
  const last = lastOnPath(state, "player");
  if (!last) return undefined;
  return newEvent({ id, parentId: null, t, kind: "goto", target: last.parentId });
}

/**
 * Retry = regenerate the latest host reply. The new host event must be appended with the
 * returned parent so it becomes a sibling of the reply it replaces (the old one stays reachable).
 * Returns undefined when there is no host reply yet.
 */
export function retryParent(state: AdventureState): { parentId: string | null } | undefined {
  const last = lastOnPath(state, "host");
  return last ? { parentId: last.parentId } : undefined;
}

/** Edit = a replacement sibling carrying the new text; the original stays reachable as a branch. */
export function editEvent(
  state: AdventureState,
  targetId: string,
  text: string,
  id: string,
  t: string,
): AdventureEvent {
  const target = state.events.get(targetId);
  if (!target || target.kind === "goto") throw new Error(`cannot edit unknown event "${targetId}"`);
  return newEvent({
    id,
    parentId: target.parentId,
    t,
    kind: target.kind,
    ...(target.mode ? { mode: target.mode } : {}),
    text,
    editOf: targetId,
  });
}

/** Move the head to any node: browsing branches, or forking from an earlier turn. */
export function gotoEvent(id: string, t: string, target: string | null): AdventureEvent {
  return newEvent({ id, parentId: null, t, kind: "goto", target });
}

/** Start a new chapter here. Where breaks happen is decided by the caller. */
export function breakEvent(
  state: AdventureState,
  id: string,
  t: string,
  title?: string,
): AdventureEvent {
  return newEvent({
    id,
    parentId: state.head,
    t,
    kind: "break",
    ...(title?.trim() ? { text: title.trim() } : {}),
  });
}

export function serializeEvent(ev: AdventureEvent): string {
  return JSON.stringify(ev);
}

/** Parses an `events.jsonl` body. Blank lines are ignored; bad lines report their line number. */
export function parseLog(text: string): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (e) {
      throw new Error(`events line ${i + 1}: not valid JSON (${(e as Error).message})`);
    }
    const parsed = AdventureEvent.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`events line ${i + 1}: ${formatIssues(parsed.error).join("; ")}`);
    }
    events.push(parsed.data);
  });
  return events;
}
