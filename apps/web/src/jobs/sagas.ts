import { call, delay, put, select, spawn, takeEvery } from "redux-saga/effects";
import { ApiError, api } from "../api";
import type { GenerationJob } from "../types";
import { isActive, type JobsAction, type JobsState } from "./store";

const POLL_MS = 1000;
/** Failed polls in a row before a job is shown as lost. A restart of the table takes a few seconds. */
const MAX_BLIPS = 30;

/** Jobs already being followed, so a hydrate while one runs does not double the polling. */
const following = new Set<string>();

type Start = Extract<JobsAction, { type: "jobs/start" }>;
type Cancel = Extract<JobsAction, { type: "jobs/cancel" }>;

function* follow(id: string): Generator<unknown, void, never> {
  if (following.has(id)) return;
  following.add(id);
  try {
    let blips = 0;
    for (;;) {
      try {
        const job = (yield call(api.vnJob, id)) as GenerationJob;
        blips = 0;
        yield put({ type: "jobs/upsert", job } satisfies JobsAction);
        if (!isActive(job)) return;
      } catch (e) {
        // the table forgot this job (it restarted): stop following, and say so
        if (e instanceof ApiError && e.status === 404) {
          const known = (yield select((s: JobsState) => s.byId[id])) as GenerationJob | undefined;
          if (known && isActive(known)) {
            const lost: GenerationJob = {
              ...known,
              state: "error",
              error: "The table restarted while this was running. Start it again.",
            };
            yield put({ type: "jobs/upsert", job: lost } satisfies JobsAction);
          }
          return;
        }
        blips += 1;
        if (blips >= MAX_BLIPS) return;
      }
      yield delay(POLL_MS);
    }
  } finally {
    following.delete(id);
  }
}

function* hydrate(): Generator<unknown, void, never> {
  try {
    const jobs = (yield call(api.vnJobs)) as GenerationJob[];
    for (const job of jobs) {
      yield put({ type: "jobs/upsert", job } satisfies JobsAction);
      if (isActive(job)) yield call(spawnFollow, job.id);
    }
  } catch {
    // not signed in as the host yet, or the table is away; the studio asks again when it opens
  }
}

function* start(action: Start): Generator<unknown, void, never> {
  try {
    const job = (yield call(
      api.generateVnAsset,
      action.world,
      action.slug,
      action.input,
    )) as GenerationJob;
    yield put({ type: "jobs/upsert", job } satisfies JobsAction);
    yield put({ type: "jobs/started" } satisfies JobsAction);
    yield call(spawnFollow, job.id);
  } catch (e) {
    yield put({ type: "jobs/start-failed", message: (e as Error).message } satisfies JobsAction);
  }
}

function* cancel(action: Cancel): Generator<unknown, void, never> {
  try {
    const job = (yield call(api.cancelVnJob, action.id)) as GenerationJob;
    yield put({ type: "jobs/upsert", job } satisfies JobsAction);
  } catch {
    // the next poll shows what really happened
  }
}

function* spawnFollow(id: string): Generator<unknown, void, never> {
  yield spawn(follow, id);
}

export function* rootSaga(): Generator<unknown, void, never> {
  yield takeEvery("jobs/hydrate", hydrate);
  yield takeEvery("jobs/start", start);
  yield takeEvery("jobs/cancel", cancel);
}
