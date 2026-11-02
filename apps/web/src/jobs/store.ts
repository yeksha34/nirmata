import { type Action, applyMiddleware, legacy_createStore as createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import type { GenerateAssetInput, GenerationJob } from "../types";
import { rootSaga } from "./sagas";

/**
 * Generation status. The server keeps the truth (`/api/vn-jobs`); this store only mirrors it, so
 * a refreshed page rebuilds the same view with `hydrate` and carries on following running jobs.
 */
export interface JobsState {
  byId: Record<string, GenerationJob>;
  /** A start that never reached the server, shown instead of a job. */
  startError: string | undefined;
  starting: boolean;
  /** Jobs the person cleared from the queue panel; the server still lists them. */
  dismissed: Record<string, true>;
}

export const initialJobs: JobsState = {
  byId: {},
  startError: undefined,
  starting: false,
  dismissed: {},
};

const DISMISSED_KEY = "nirmata.dismissed-jobs";
const DISMISSED_KEEP = 200;

function loadDismissed(): Record<string, true> {
  try {
    const ids = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as unknown;
    return Array.isArray(ids)
      ? Object.fromEntries(ids.filter((i) => typeof i === "string").map((i) => [i, true as const]))
      : {};
  } catch {
    return {};
  }
}

function saveDismissed(ids: Record<string, true>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Object.keys(ids).slice(-DISMISSED_KEEP)));
  } catch {
    // private browsing: they come back after a reload
  }
}

export type JobsAction =
  | { type: "jobs/hydrate" }
  | { type: "jobs/start"; world: string; slug: string; input: GenerateAssetInput }
  | { type: "jobs/started" }
  | { type: "jobs/start-failed"; message: string }
  | { type: "jobs/upsert"; job: GenerationJob }
  | { type: "jobs/cancel"; id: string }
  | { type: "jobs/forget"; id: string };

export const jobsActions = {
  hydrate: (): JobsAction => ({ type: "jobs/hydrate" }),
  start: (world: string, slug: string, input: GenerateAssetInput): JobsAction => ({
    type: "jobs/start",
    world,
    slug,
    input,
  }),
  cancel: (id: string): JobsAction => ({ type: "jobs/cancel", id }),
  forget: (id: string): JobsAction => ({ type: "jobs/forget", id }),
};

export const isActive = (job: GenerationJob): boolean =>
  job.state === "queued" || job.state === "running" || job.state === "saving";

export function jobsReducer(state: JobsState = initialJobs, action: Action): JobsState {
  const a = action as JobsAction;
  switch (a.type) {
    case "jobs/start":
      return { ...state, starting: true, startError: undefined };
    case "jobs/started":
      return { ...state, starting: false };
    case "jobs/start-failed":
      return { ...state, starting: false, startError: a.message };
    case "jobs/upsert":
      return state.dismissed[a.job.id]
        ? state
        : { ...state, byId: { ...state.byId, [a.job.id]: a.job } };
    case "jobs/forget": {
      const { [a.id]: _gone, ...rest } = state.byId;
      return { ...state, byId: rest, dismissed: { ...state.dismissed, [a.id]: true } };
    }
    default:
      return state;
  }
}

/** The newest job for one asset, if any. */
export function jobForAsset(
  state: JobsState,
  world: string | undefined,
  type: string,
  name: string | undefined,
): GenerationJob | undefined {
  if (!world || !name) return undefined;
  let best: GenerationJob | undefined;
  for (const job of Object.values(state.byId)) {
    if (job.world !== world || job.type !== type || job.name !== name) continue;
    if (!best || job.startedAt > best.startedAt) best = job;
  }
  return best;
}

export function makeJobsStore() {
  const saga = createSagaMiddleware();
  const store = createStore(
    jobsReducer,
    { ...initialJobs, dismissed: loadDismissed() },
    applyMiddleware(saga),
  );
  let last = store.getState().dismissed;
  store.subscribe(() => {
    const now = store.getState().dismissed;
    if (now === last) return;
    last = now;
    saveDismissed(now);
  });
  saga.run(rootSaga);
  return store;
}

export type JobsStore = ReturnType<typeof makeJobsStore>;
export type RootState = JobsState;
