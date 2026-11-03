import { useEffect, useState } from "react";
import { T } from "./i18n";
import {
  applyTheme,
  otherTheme,
  parseTheme,
  saveTheme,
  storedTheme,
  THEME_KEY,
  type Theme,
} from "./theme";

/**
 * The light and dark switch, bottom right: a glass pill with a hairline icon and its label in Hindi,
 * the English on hover. It shows what pressing it would give (a moon in light, a sun in dark).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // a change made in another tab of this browser follows here
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setTheme(parseTheme(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dark = theme === "dark";
  const choose = () => {
    const next = otherTheme(theme);
    saveTheme(next);
    setTheme(next);
  };

  return (
    <p className="theme-corner">
      <button
        type="button"
        className="theme-toggle"
        aria-label="Dark mode"
        aria-pressed={dark}
        onClick={choose}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {dark ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </>
          ) : (
            <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
          )}
        </svg>
        <T>{dark ? "Light mode" : "Dark mode"}</T>
      </button>
    </p>
  );
}
