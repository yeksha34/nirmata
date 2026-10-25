import { useCallback, useEffect, useReducer, useState } from "react";
import { api, seat } from "./api";
import { AppProvider } from "./app-context";
import { useLive } from "./live";
import { Join } from "./screens/Join";
import { Library } from "./screens/Library";
import { TableScreen } from "./screens/Table";
import { Waiting } from "./screens/Waiting";
import { initialState, reducer, screenFor } from "./store";
import type { TableInfo } from "./types";
import { HeaderBar, Toasts } from "./ui";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [info, setInfo] = useState<TableInfo>();
  const [token, setToken] = useState<string>();
  const [booting, setBooting] = useState(true);
  const [joinError, setJoinError] = useState<string>();

  const leave = useCallback(() => {
    seat.save(undefined);
    setToken(undefined);
    dispatch({ type: "left" });
  }, []);

  // Come back to the seat this tab held, or take the host's seat from the link the server printed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setInfo(await api.table());
      } catch (e) {
        setJoinError((e as Error).message);
      }
      const hostKey = new URLSearchParams(window.location.hash.slice(1)).get("host");
      if (hostKey) {
        history.replaceState(null, "", window.location.pathname);
        try {
          const joined = await api.join({ hostKey });
          seat.save(joined.token);
          if (!cancelled) setToken(joined.token);
          return;
        } catch (e) {
          if (!cancelled) setJoinError((e as Error).message);
        }
      }
      const saved = seat.load();
      if (saved) {
        try {
          const snapshot = await api.state();
          if (cancelled) return;
          dispatch({ type: "snapshot", snapshot });
          setToken(saved);
        } catch {
          seat.save(undefined);
        }
      }
    })().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLive(token, dispatch, leave);

  const joined = (nextToken: string) => {
    seat.save(nextToken);
    setToken(nextToken);
    dispatch({ type: "notice", kind: "info", text: "You're in." });
  };

  if (booting)
    return (
      <div className="boot" role="status">
        Opening the table…
      </div>
    );

  const screen = state.you ? screenFor(state) : undefined;
  return (
    <AppProvider value={{ state, dispatch, leave }}>
      {!token || !state.you ? (
        <Join info={info} problem={joinError ?? (state.kicked || undefined)} onJoined={joined} />
      ) : (
        <div className="shell">
          <HeaderBar />
          <main>
            {screen === "library" && <Library />}
            {(screen === "waiting-world" || screen === "waiting-story") && <Waiting />}
            {screen === "table" && <TableScreen />}
          </main>
        </div>
      )}
      <Toasts />
    </AppProvider>
  );
}
