import type {
  BoardMessage,
  HostStoryView,
  Snapshot,
  StoryEvent,
  StoryView,
  TurnView,
  WorldInfo,
  You,
} from "./types";

export type Connection = "connecting" | "live" | "lost";

export interface Notice {
  id: number;
  kind: "error" | "info";
  text: string;
}

/** Everything the screens show, folded from what the server sends. */
export interface State {
  you: You | undefined;
  world: WorldInfo | null;
  board: BoardMessage | undefined;
  story: StoryView | HostStoryView | null;
  connection: Connection;
  /** The reply being written right now. */
  streaming: string | null;
  /** Lines saved this round but not yet in the story's own list (it arrives when the turn ends). */
  pending: TurnView[];
  notices: Notice[];
  /** Host only: things worth a look that did not stop the story. */
  warnings: string[];
  /** Set when the host sent this person away. */
  kicked: string | undefined;
  nextNotice: number;
}

export const initialState: State = {
  you: undefined,
  world: null,
  board: undefined,
  story: null,
  connection: "connecting",
  streaming: null,
  pending: [],
  notices: [],
  warnings: [],
  kicked: undefined,
  nextNotice: 1,
};

export type Action =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "board"; board: BoardMessage }
  | { type: "world"; world: WorldInfo | null }
  | { type: "story-view"; story: StoryView | HostStoryView | null }
  | { type: "story"; event: StoryEvent }
  | { type: "you"; you: You }
  | { type: "connection"; connection: Connection }
  | { type: "left" }
  | { type: "kicked"; message: string }
  | { type: "notice"; kind: Notice["kind"]; text: string }
  | { type: "dismiss"; id: number };

const MAX_NOTICES = 4;

function notify(state: State, kind: Notice["kind"], text: string): State {
  // the same message twice in a row is one message
  if (state.notices.some((n) => n.text === text)) return state;
  const notices = [...state.notices, { id: state.nextNotice, kind, text }].slice(-MAX_NOTICES);
  return { ...state, notices, nextNotice: state.nextNotice + 1 };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        you: action.snapshot.you,
        world: action.snapshot.world,
        board: action.snapshot.board,
        story: action.snapshot.story,
        connection: "live",
        streaming: null,
        pending: [],
      };
    case "board": {
      const board = action.board;
      // keep what this person is told about themselves in step with the table
      const me = state.you
        ? board.participants.find((p) => p.nick.toLowerCase() === state.you?.nick.toLowerCase())
        : undefined;
      const you =
        state.you && me
          ? { ...state.you, nick: me.nick, seat: me.seat, muted: me.muted }
          : state.you;
      return { ...state, board, you };
    }
    case "world":
      return { ...state, world: action.world };
    case "story-view":
      // the turn is over (or the story changed): the story's own list is the truth again
      return { ...state, story: action.story, streaming: null, pending: [] };
    case "you":
      return { ...state, you: action.you };
    case "connection":
      return { ...state, connection: action.connection };
    case "left":
      return { ...initialState, notices: state.notices, nextNotice: state.nextNotice };
    case "kicked":
      return { ...state, kicked: action.message, you: undefined };
    case "notice":
      return notify(state, action.kind, action.text);
    case "dismiss":
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case "story":
      return storyEvent(state, action.event);
  }
}

function storyEvent(state: State, ev: StoryEvent): State {
  switch (ev.type) {
    case "begun":
      return { ...state, streaming: "" };
    case "player":
      return { ...state, pending: [...state.pending, ev.turn], streaming: state.streaming ?? "" };
    case "text":
      return { ...state, streaming: (state.streaming ?? "") + ev.text };
    case "attempt":
      return { ...state, streaming: "" };
    case "reply":
      return { ...state, streaming: null, pending: [...state.pending, ev.turn] };
    case "stopped":
      return { ...state, streaming: null };
    case "error": {
      const next = notify({ ...state, streaming: null }, "error", ev.message);
      return next;
    }
    case "warning":
      return state.warnings.includes(ev.message)
        ? state
        : { ...state, warnings: [...state.warnings, ev.message].slice(-5) };
    case "rule-violation": {
      const text = ev.violations.map((v) => `${v.name}: ${v.reason}`).join("; ");
      const warnings = [...state.warnings, `A reply broke a rule (${text}).`].slice(-5);
      return { ...state, warnings };
    }
    case "done":
    case "plotting":
    case "plot":
    case "context":
      return state;
  }
}

/** The turns to show: the story's own list, plus whatever has been saved since it was last sent. */
export function visibleTurns(state: State): TurnView[] {
  const saved = state.story?.turns ?? [];
  const seen = new Set(saved.map((t) => t.id));
  return [...saved, ...state.pending.filter((t) => !seen.has(t.id))];
}

/** Players who wrote a turn and have not marked it ready: what the round is waiting for. */
export function waitingFor(board: BoardMessage | undefined): string[] {
  return board ? board.drafts.filter((d) => !d.ready).map((d) => d.nick) : [];
}

/**
 * The page behind the story window, for someone who has joined. The story itself is not a page:
 * it floats over whichever page this is, whenever a story is open.
 */
export type Screen = "waiting-world" | "worlds" | "waiting-story";

export function screenFor(state: State): Screen {
  const host = state.you?.host === true;
  if (host) return "worlds";
  return state.world ? "waiting-story" : "waiting-world";
}
