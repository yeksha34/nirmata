import { type Action, type Actor, assertCan, PermissionError } from "@nirmata/core";
import { HostError } from "./types";

/** The caller when none is given: someone running their own story. */
export const SOLO_HOST: Actor = { id: "host", role: "host" };

/** Like core's `assertCan`, but throws a HostError so every failure looks the same to callers. */
export function requireCan(actor: Actor, action: Action): void {
  try {
    assertCan(actor, action);
  } catch (e) {
    if (e instanceof PermissionError) throw new HostError("forbidden", e.message);
    throw e;
  }
}
