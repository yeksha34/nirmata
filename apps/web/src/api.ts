import type {
  CardForm,
  CardTemplate,
  ComfyUiStatus,
  GenerateAssetInput,
  GenerationJob,
  Mode,
  Perspective,
  RecentStory,
  Snapshot,
  TableInfo,
  VnAssetDetail,
  VnAssetItem,
  VnDiagnostic,
  VnManifest,
  VnMode,
  VnSlideDeck,
  VnSummary,
  VnTier,
  VnWithAssetsSummary,
  WorldDetail,
  WorldInfo,
  WorldSummary,
  Writing,
  You,
  AssetKind,
  VnAssetLists,
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
const del = <T = { ok: true }>(path: string) => request<T>("DELETE", path);

export const api = {
  table: () => get<TableInfo>("/api/table"),
  state: () => get<Snapshot>("/api/state"),
  join: (args: { nick?: string; confirmedAdult?: boolean; hostKey?: string }) =>
    post<{ token: string; you: You }>("/api/join", args),
  leave: () => post("/api/leave"),
  /** Come in as the signed-in person; the host is whoever the account says. */
  joinSession: () => post<{ token: string; you: You }>("/api/join/session"),
  /** Who is signed in. Fails with 401 when nobody is, 404 when sign-in is not set up. */
  me: () =>
    get<{
      user: { id: string; email: string };
      profile: {
        displayName: string;
        canFoundWorlds: boolean;
        role: "admin" | "author" | "player";
        ageConfirmed: boolean;
      } | null;
    }>("/api/auth/me"),

  // sign-in: the server talks to Supabase; the browser only ever calls these
  invitation: (token: string) =>
    get<{ email: string }>(`/api/auth/invitation?token=${encodeURIComponent(token)}`),
  register: (token: string, password: string) =>
    post<{ user: { id: string; email: string } }>("/api/auth/register", { token, password }),
  login: (email: string, password: string) =>
    post<{ user: { id: string; email: string } }>("/api/auth/login", { email, password }),
  onboard: (args: { attestAdult?: boolean; token?: string }) => post("/api/auth/onboard", args),
  logout: () => post("/api/auth/logout"),

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
  closeStory: () => post("/api/story/close"),

  // the worlds page: every world, without opening any of them
  recent: () => get<{ stories: RecentStory[] }>("/api/recent").then((r) => r.stories),
  worldDetail: (name: string) => get<WorldDetail>(`/api/worlds/${encodeURIComponent(name)}`),
  writing: (name: string, path: string) =>
    get<Writing>(
      `/api/worlds/${encodeURIComponent(name)}/writing?path=${encodeURIComponent(path)}`,
    ),
  createWorld: (args: { title: string; tagline?: string; premise?: string }) =>
    post<{ world: WorldSummary }>("/api/worlds", args).then((r) => r.world),
  editWorld: (
    name: string,
    patch: {
      title?: string;
      tagline?: string;
      genre?: string[];
      tone?: string[];
      perspective?: Perspective;
    },
  ) =>
    request<{ world: WorldSummary }>(
      "PATCH",
      `/api/worlds/${encodeURIComponent(name)}`,
      patch,
    ).then((r) => r.world),
  archiveWorld: (name: string) => post(`/api/worlds/${encodeURIComponent(name)}/archive`),
  cardTemplates: () =>
    get<{ templates: CardTemplate[] }>("/api/card-templates").then((r) => r.templates),
  // the story manager: a world's cards, as the form's fields or as the file's own text
  saveCard: (
    name: string,
    input: { path?: string; form: CardForm } | { path: string; text: string },
  ) =>
    put<{ card: { path: string; id: string } }>(
      `/api/worlds/${encodeURIComponent(name)}/cards`,
      input,
    ).then((r) => r.card),
  removeCard: (name: string, path: string) =>
    request(
      "DELETE",
      `/api/worlds/${encodeURIComponent(name)}/cards?path=${encodeURIComponent(path)}`,
    ),
  startStoryIn: (name: string, arcId?: string) =>
    post<{ id: string }>(`/api/worlds/${encodeURIComponent(name)}/stories`, arcId ? { arcId } : {}),
  resumeStoryIn: (name: string, id: string) =>
    post(`/api/worlds/${encodeURIComponent(name)}/stories/${encodeURIComponent(id)}/resume`),

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

  // visual novel adaptations
  vns: (worldName: string) =>
    get<{ vns: VnSummary[] }>(`/api/worlds/${encodeURIComponent(worldName)}/vns`).then(
      (r) => r.vns,
    ),
  vn: (worldName: string, slug: string) =>
    get<{ manifest: VnManifest; adaptationMd: string; slides?: VnSlideDeck }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}`,
    ),
  scaffoldVn: (
    worldName: string,
    args: {
      slug: string;
      title: string;
      source: string;
      mode?: VnMode;
      mc?: string;
      tier?: VnTier;
    },
  ) =>
    post<{ vn: VnSummary }>(`/api/worlds/${encodeURIComponent(worldName)}/vns/scaffold`, args).then(
      (r) => r.vn,
    ),
  saveVn: (
    worldName: string,
    slug: string,
    data: { manifest?: VnManifest; adaptationMd?: string; slides?: VnSlideDeck },
  ) =>
    put<{ ok: boolean }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}`,
      data,
    ),
  compileVn: (worldName: string, slug: string) =>
    post<{ slides: VnSlideDeck; diagnostics: VnDiagnostic[] }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/compile`,
    ),
  comfyStatus: () => get<ComfyUiStatus>("/api/comfyui/status"),
  /** Delete one dataset run, given the address of its image (`…/image` is dropped). */
  deleteDatasetRun: (imageUrl: string) =>
    del<{ ok: true; database: boolean; files: boolean }>(imageUrl.replace(/\/image$/, "")),
  allVns: () => get<{ vns: VnWithAssetsSummary[] }>("/api/vns").then((r) => r.vns),
  vnAssets: (worldName: string, slug: string) =>
    get<VnAssetLists>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets`,
    ),
  vnAssetDetail: (worldName: string, slug: string, type: AssetKind, name: string) =>
    get<VnAssetDetail>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/asset-meta/${type}/${encodeURIComponent(name)}`,
    ),
  /** Remembers an asset prompt and sampler settings, so they are there when it is selected again. */
  saveAssetPrompt: (
    worldName: string,
    slug: string,
    type: AssetKind,
    name: string,
    body: {
      positivePrompt: string;
      negativePrompt?: string;
      steps?: number;
      cfg?: number;
      sampler?: string;
      scheduler?: string;
    },
  ) =>
    put(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/asset-meta/${type}/${encodeURIComponent(name)}/prompt`,
      body,
    ),
  /** Starts a generation and returns at once; follow it with `vnJob`. */
  generateVnAsset: (worldName: string, slug: string, body: GenerateAssetInput) =>
    post<GenerationJob>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets/generate`,
      body,
    ),
  vnJobs: () => get<{ jobs: GenerationJob[] }>("/api/vn-jobs").then((r) => r.jobs),
  vnJob: (id: string) => get<GenerationJob>(`/api/vn-jobs/${encodeURIComponent(id)}`),
  cancelVnJob: (id: string) => post<GenerationJob>(`/api/vn-jobs/${encodeURIComponent(id)}/cancel`),
  archiveAllVnAssets: (worldName: string, slug: string) =>
    post<{ ok: boolean; archivedCount: number }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets/archive-all`,
      {},
    ),
  deleteAllVnAssets: (worldName: string, slug: string) =>
    post<{ ok: boolean; deletedCount: number }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets/delete-all`,
      {},
    ),
  archiveOneVnAsset: (
    worldName: string,
    slug: string,
    type: AssetKind,
    name: string,
  ) =>
    post<{ ok: boolean; timestamp: string }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/asset-meta/${type}/${encodeURIComponent(name)}/archive`,
      {},
    ),
  deleteOneVnAsset: (worldName: string, slug: string, type: AssetKind, name: string) =>
    del<{ ok: boolean; name: string }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/asset-meta/${type}/${encodeURIComponent(name)}`,
    ),
  /** Plans a new asset in a visual novel; its image is made later. A sprite, clothes or adornment names its character as `owner`. */
  addVnAsset: (
    worldName: string,
    slug: string,
    body: { type: AssetKind; name: string; owner?: string },
  ) =>
    post<{ ok: boolean; name: string }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets`,
      body,
    ),
  /** Takes an asset out of the plan and deletes its image; its dataset runs stay. */
  removeVnAsset: (worldName: string, slug: string, type: AssetKind, name: string) =>
    del<{ ok: boolean; name: string }>(
      `/api/worlds/${encodeURIComponent(worldName)}/vns/${encodeURIComponent(slug)}/assets/${type}/${encodeURIComponent(name)}`,
    ),
};
