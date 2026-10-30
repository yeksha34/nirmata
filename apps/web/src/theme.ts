/**
 * Light or dark. Light is the design (the "Nirmata" canvas) and is what everyone starts with;
 * dark is a choice made with the toggle in the bottom right corner, kept in this browser. The
 * system's own preference is deliberately not read: a computer set to dark does not turn the app
 * brown, as the design does not have a brown.
 */

export type Theme = "light" | "dark";

const KEY = "nirmata.theme";

/** Anything that is not "dark" is light, so a stored value that has gone bad costs nothing. */
export const parseTheme = (raw: string | null | undefined): Theme =>
  raw === "dark" ? "dark" : "light";

export const otherTheme = (theme: Theme): Theme => (theme === "dark" ? "light" : "dark");

/** The theme this browser chose, or light. Storage can be blocked or empty; neither is an error. */
export function storedTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return "light";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private window or blocked storage: the choice lasts until the page is closed
  }
}

/** Puts the theme on the page, where the stylesheet reads it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** The key the choice is stored under, so another tab's change can be noticed. */
export const THEME_KEY = KEY;
