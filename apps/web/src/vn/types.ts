import type { VnSlide, VnVarOp } from "../types";

export interface VnPlayerState {
  currentSlideIndex: number;
  variables: Record<string, number | boolean | string>;
  history: Array<{
    slide: VnSlide;
    choiceMade?: string;
  }>;
  autoPlay: boolean;
  skip: boolean;
  backlogOpen: boolean;
  variablesOpen: boolean;
}

export interface VnStepResult {
  nextSlideIndex?: number;
  ended?: boolean;
  endingName?: string;
}

/** Executes a set of variable operations against the running state. */
export function applyVarOps(
  stateVars: Record<string, number | boolean | string>,
  ops?: VnVarOp[],
): Record<string, number | boolean | string> {
  if (!ops || ops.length === 0) return { ...stateVars };
  const next = { ...stateVars };

  for (const op of ops) {
    const current = next[op.variable];
    if (op.op === "=") {
      next[op.variable] = op.value;
    } else if (op.op === "+") {
      const curNum = typeof current === "number" ? current : 0;
      const addNum = typeof op.value === "number" ? op.value : 1;
      next[op.variable] = curNum + addNum;
    } else if (op.op === "-") {
      const curNum = typeof current === "number" ? current : 0;
      const subNum = typeof op.value === "number" ? op.value : 1;
      next[op.variable] = curNum - subNum;
    }
  }

  return next;
}
