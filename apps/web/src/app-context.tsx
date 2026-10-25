import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { ApiError } from "./api";
import type { Action, State } from "./store";

interface AppContext {
  state: State;
  dispatch: (action: Action) => void;
  /** Leave the table (this browser forgets its seat). */
  leave: () => void;
}

const Context = createContext<AppContext | undefined>(undefined);

export function AppProvider({ value, children }: { value: AppContext; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp(): AppContext {
  const value = useContext(Context);
  if (!value) throw new Error("useApp outside AppProvider");
  return value;
}

/**
 * Run something that talks to the server. While it runs `busy` is true, and a problem is shown to
 * the person in the server's own words instead of being thrown.
 */
export function useAct() {
  const { dispatch, leave } = useApp();
  const [busy, setBusy] = useState(0);
  const mounted = useRef(true);
  mounted.current = true;

  const act = useCallback(
    async <T,>(work: () => Promise<T>, done?: string): Promise<T | undefined> => {
      setBusy((n) => n + 1);
      try {
        const result = await work();
        if (done) dispatch({ type: "notice", kind: "info", text: done });
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          leave();
          return undefined;
        }
        dispatch({
          type: "notice",
          kind: "error",
          text: e instanceof Error ? e.message : "Something went wrong.",
        });
        return undefined;
      } finally {
        setBusy((n) => n - 1);
      }
    },
    [dispatch, leave],
  );
  return { act, busy: busy > 0 };
}
