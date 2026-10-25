import type {
  Card,
  Mode,
  Snapshot,
  StorySummary,
  TableInfo,
  WorldInfo,
  WorldSummary,
  You,
} from "./types";

/** A problem the server explained in plain words (or a lost connection). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const KEY = "nirmata.seat";

/** The seat this browser tab holds. Kept per tab, so two tabs can be two people. */
export const seat = {
  token: undefined as string | undefined,
  load(): string | undefined {
    try {
      seat.token = sessionStorage.getItem(KEY) ?? undefined;
    } catch {
      seat.token = undefined;
    }
    return seat.token;
  },
  save(token: string | undefined): void {
    seat.token = token;
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      // private browsing: the seat lasts until the page is closed
    }
  },
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(seat.token ? { authorization: `Bearer ${seat.token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("Can't reach the table. Check your connection.", "unreachable", 0);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(
      err?.message ?? `Something went wrong (${res.status}).`,
      err?.code ?? "unexpected",
      res.status,
    );
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T = { ok: true }>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const put = <T = { ok: true }>(path: string, body: unknown) => request<T>("PUT", path, body);

export const api = {
  table: () => get<TableInfo>("/api/table"),
  state: () => get<Snapshot>("/api/state"),
  join: (args: { nick?: string; confirmedAdult?: boolean; hostKey?: string }) =>
    post<{ token: string; you: You }>("/api/join", args),
  leave: () => post("/api/leave"),
  play: () => post<{ you: You }>("/api/play"),
  watch: () => post<{ you: You }>("/api/watch"),

  setDraft: (mode: Mode, text: string) => put("/api/board/draft", { mode, text }),
  ready: () => post("/api/board/ready"),
  unready: () => post("/api/board/unready"),
  remark: (text: string) => post("/api/board/remark", { text }),
  object: (about: string, text: string) => post("/api/board/object", { about, text }),
  withdraw: (id: string) => request("DELETE", `/api/board/remarks/${encodeURIComponent(id)}`),
  closeRound: () => post("/api/board/close"),
  moderate: (
    args:
      | { action: "kick" | "mute" | "unmute"; nick: string }
      | { action: "rename"; nick: string; newNick: string },
  ) => post("/api/board/moderate", args),

  worlds: () => get<{ worlds: WorldSummary[] }>("/api/worlds").then((r) => r.worlds),
  openWorld: (name: string) =>
    post<{ world: WorldInfo }>("/api/worlds/open", { name }).then((r) => r.world),
  stories: () => get<{ stories: StorySummary[] }>("/api/stories").then((r) => r.stories),
  startStory: (arcId?: string) => post<{ id: string }>("/api/stories", arcId ? { arcId } : {}),
  resumeStory: (id: string) => post(`/api/stories/${encodeURIComponent(id)}/resume`),
  closeStory: () => post("/api/story/close"),
  sourceCards: () => get<{ cards: Card[] }>("/api/source/cards").then((r) => r.cards),

  retry: () => post("/api/story/retry"),
  continueStory: () => post("/api/story/continue"),
  stop: () => post("/api/story/stop"),
  undo: () => post<{ undone: boolean }>("/api/story/undo"),
  breakChapter: (title?: string) => post("/api/story/break", title ? { title } : {}),
  extractPlot: () => post("/api/story/plot"),
  saveAsWorld: (args: { name: string; title?: string }) =>
    post<{ world: { name: string; cards: number; chapters: number } }>(
      "/api/story/save-as-world",
      args,
    ).then((r) => r.world),
};
