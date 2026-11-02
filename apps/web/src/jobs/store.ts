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
}

export const initialJobs: JobsState = { byId: {}, startError: undefined, starting: false };

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
      return { ...state, byId: { ...state.byId, [a.job.id]: a.job } };
    case "jobs/forget": {
      const { [a.id]: _gone, ...rest } = state.byId;
      return { ...state, byId: rest };
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
  const store = createStore(jobsReducer, applyMiddleware(saga));
  saga.run(rootSaga);
  return store;
}

export type JobsStore = ReturnType<typeof makeJobsStore>;
export type RootState = JobsState;
