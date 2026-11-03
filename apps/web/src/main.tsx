import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
import { AcceptInvite, Login } from "./screens/Account";
import { makeJobsStore } from "./jobs/store";
import { applyTheme, storedTheme } from "./theme";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/noto-sans-devanagari";
import "@fontsource-variable/noto-serif-devanagari";
import "./styles.css";

// before anything is drawn, so the page never shows one theme and then the other
applyTheme(storedTheme());

const jobsStore = makeJobsStore();

// the sign-in pages are plain addresses the server hands out (an invitation link); everything else is the app
function Page() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/accept-invite") return <AcceptInvite />;
  if (path === "/login") return <Login />;
  return <App />;
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Provider store={jobsStore}>
        <Page />
      </Provider>
    </StrictMode>,
  );
}
