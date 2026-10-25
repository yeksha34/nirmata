import { useEffect } from "react";
import { api, seat } from "./api";
import type { Action } from "./store";

/**
 * One live connection to the table. The first message is the whole current state, so when the
 * browser reconnects after a dropped connection it simply receives that again.
 */
export function useLive(
  token: string | undefined,
  dispatch: (action: Action) => void,
  onGone: () => void,
): void {
  useEffect(() => {
    if (!token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    const on = (name: string, handler: (data: never) => void) =>
      source.addEventListener(name, (e) => {
        try {
          handler(JSON.parse((e as MessageEvent<string>).data) as never);
        } catch {
          // a message that is not for us; ignore it
        }
      });

    on("snapshot", (snapshot) => dispatch({ type: "snapshot", snapshot }));
    on("board", (board) => dispatch({ type: "board", board }));
    on("world", ({ world }: { world: never }) => dispatch({ type: "world", world }));
    on("story-view", (story) => dispatch({ type: "story-view", story }));
    on("story", (event) => dispatch({ type: "story", event }));
    on("kicked", ({ message }: { message: string }) => {
      source.close();
      seat.save(undefined);
      dispatch({ type: "kicked", message });
    });

    source.onerror = () => {
      dispatch({ type: "connection", connection: "lost" });
      // the browser retries by itself; if our seat is gone there is nothing to retry
      api.state().catch((e: { status?: number }) => {
        if (e.status === 401) {
          source.close();
          onGone();
        }
      });
    };
    return () => source.close();
  }, [token, dispatch, onGone]);
}
