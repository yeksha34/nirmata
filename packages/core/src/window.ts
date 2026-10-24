import { type AdventureState, pathTo, turnOf } from "./events";
import type { Turn } from "./schema";

/**
 * The context window is whatever recent turns fit the prompt budget. Each host reply records, in
 * `shifted`, the newest turn that was already outside it. The cursor only ever moves forward on a
 * branch, so a turn that has left the window never comes back, even if the budget later grows.
 */
export function windowCursor(state: AdventureState, at: string | null = state.head): string | null {
  const path = pathTo(state, at);
  for (let i = path.length - 1; i >= 0; i--) {
    const ev = path[i];
    if (ev?.kind === "host" && ev.shifted) return ev.shifted;
  }
  return null;
}

/** The turns still eligible for the prompt: everything after the window cursor. */
export function contextTurnsOf(state: AdventureState, at: string | null = state.head): Turn[] {
  const path = pathTo(state, at);
  const cursor = windowCursor(state, at);
  const from = cursor === null ? 0 : path.findIndex((ev) => ev.id === cursor) + 1;
  return path.slice(from).flatMap((ev) => turnOf(ev) ?? []);
}

/** How a turn reads in a chapter: the host's prose as written, the player's input as a quote. */
export function renderTurn(turn: Turn): string {
  if (turn.role === "host") return turn.text;
  const label = { do: "Do", say: "Say", story: "Story" }[turn.mode ?? "do"];
  return `> **${label}:** ${turn.text.replace(/\s*\n+\s*/g, " ")}`;
}

export interface Chapter {
  number: number;
  title: string;
  /** The turns written to this chapter so far, oldest first. */
  turns: Turn[];
  /** The turns rendered as chapter text. */
  text: string;
  /** True for the last chapter, which is still growing as the window shifts. */
  open: boolean;
  /** The newest turn in it. */
  through: string;
}

/**
 * The chapters of this branch: every turn at or before the window cursor, verbatim and in order,
 * split at `break` events. With no break there is one chapter. Text still inside the window is not
 * in any chapter yet; it joins as the window shifts. Where breaks happen is decided elsewhere.
 */
export function chaptersOf(state: AdventureState, at: string | null = state.head): Chapter[] {
  const cursor = windowCursor(state, at);
  if (cursor === null) return [];
  const path = pathTo(state, at);
  const last = path.findIndex((ev) => ev.id === cursor);

  const groups: Array<{ title: string; turns: Turn[] }> = [{ title: "", turns: [] }];
  for (const ev of path.slice(0, last + 1)) {
    const current = groups[groups.length - 1] as { title: string; turns: Turn[] };
    if (ev.kind === "break") {
      if (current.turns.length) groups.push({ title: ev.text, turns: [] });
      else if (ev.text) current.title = ev.text;
      continue;
    }
    const turn = turnOf(ev);
    if (turn) current.turns.push(turn);
  }

  return groups
    .filter((g) => g.turns.length)
    .map((g, i, all) => ({
      number: i + 1,
      title: g.title || `Chapter ${i + 1}`,
      turns: g.turns,
      text: g.turns.map(renderTurn).join("\n\n"),
      open: i === all.length - 1,
      through: (g.turns[g.turns.length - 1] as Turn).id,
    }));
}
