import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { App } from "./App";
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
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Provider store={jobsStore}>
        <App />
      </Provider>
    </StrictMode>,
  );
}
