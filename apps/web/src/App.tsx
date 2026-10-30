import { useCallback, useEffect, useReducer, useState } from "react";
import { api, seat } from "./api";
import { AppProvider } from "./app-context";
import { ClippedTips } from "./clipped-tips";
import { AskProvider } from "./controls";
import { HeaderBar } from "./header";
import { T, useTapToTranslate } from "./i18n";
import { useLive } from "./live";
import { NavProvider } from "./nav";
import { Join } from "./screens/Join";
import { TableScreen } from "./screens/Table";
import { Waiting } from "./screens/Waiting";
import { Worlds } from "./screens/Worlds";
import { initialState, reducer, screenFor } from "./store";
import { StoryWindow } from "./story-window";
import { ThemeToggle } from "./theme-toggle";
import type { TableInfo } from "./types";
import { Toasts } from "./ui";

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

  // Pasting the host link into a tab that is already open only changes the address's `#` part, so
  // the browser does not reload the page; reload it so the host key is picked up.
  useEffect(() => {
    const onHash = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has("host")) window.location.reload();
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useLive(token, dispatch, leave);
  useTapToTranslate();

  const joined = (nextToken: string) => {
    seat.save(nextToken);
    setToken(nextToken);
    dispatch({ type: "notice", kind: "info", text: "You're in." });
  };

  if (booting)
    return (
      <output className="boot">
        <T>Opening the table…</T>
      </output>
    );

  const screen = state.you ? screenFor(state) : undefined;
  return (
    <AppProvider value={{ state, dispatch, leave }}>
      <NavProvider>
        <AskProvider>
          {!token || !state.you ? (
            <Join
              info={info}
              problem={joinError ?? (state.kicked || undefined)}
              onJoined={joined}
            />
          ) : (
            <>
              <HeaderBar />
              <main>
                {screen === "worlds" && <Worlds />}
                {(screen === "waiting-world" || screen === "waiting-story") && <Waiting />}
              </main>
              {state.story && (
                <StoryWindow
                  title={state.world?.title ?? "Story"}
                  heading={state.world ? undefined : <T>Story</T>}
                  working={state.streaming !== null || state.story.busy}
                >
                  <TableScreen />
                </StoryWindow>
              )}
            </>
          )}
          <Toasts />
          <ClippedTips />
          <ThemeToggle />
        </AskProvider>
      </NavProvider>
    </AppProvider>
  );
}
