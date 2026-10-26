import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "./api";
import { T } from "./i18n";
import type { CardKind, WorldSummary } from "./types";
import { Modal } from "./ui";

/** A card the jump box can offer: only what it shows and searches. */
export interface CardRef {
  path: string;
  name: string;
  kind: CardKind;
  summary: string;
  keywords: string[];
}

interface Nav {
  /** The world whose page is showing, or none for the front page. */
  world: string | undefined;
  /** The card chosen on that page. */
  card: string | undefined;
  open: (world: string, card?: string) => void;
  home: () => void;
  selectCard: (path: string | undefined) => void;
  /** The cards of the world on show, so the jump box can find them. */
  cards: CardRef[];
  setCards: (cards: CardRef[]) => void;
}

const Context = createContext<Nav | undefined>(undefined);

export function NavProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<{ world?: string; card?: string }>({});
  const [cards, setCards] = useState<CardRef[]>([]);
  const value = useMemo<Nav>(
    () => ({
      world: place.world,
      card: place.card,
      open: (world, card) => setPlace({ world, ...(card ? { card } : {}) }),
      home: () => {
        setPlace({});
        setCards([]);
      },
      selectCard: (card) =>
        setPlace((p) => ({ ...(p.world ? { world: p.world } : {}), ...(card ? { card } : {}) })),
      cards,
      setCards,
    }),
    [place, cards],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNav(): Nav {
  const value = useContext(Context);
  if (!value) throw new Error("useNav outside NavProvider");
  return value;
}

const KIND_WORD: Record<CardKind, string> = {
  lore: "Lore",
  character: "Character",
  place: "Place",
  arc: "Story arc",
  rule: "Rule",
  scene: "Scene",
};

/** The little label shown in the header: "Ctrl K" or "⌘ K" for the platform. */
export const SHORTCUT = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "")
  ? "⌘ K"
  : "Ctrl K";

/** Ctrl or Cmd + K, wherever focus is. */
export function useJumpShortcut(onJump: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onJump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onJump]);
}

interface Hit {
  key: string;
  title: string;
  note: string;
  go: () => void;
}

/** Jump to a world, or to a card in the world on show: type, arrow keys, Enter. */
export function JumpBox({ onClose }: { onClose: () => void }) {
  const nav = useNav();
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);

  useEffect(() => {
    api
      .worlds()
      .then(setWorlds)
      .catch(() => setWorlds([]));
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
    const go = (fn: () => void) => () => {
      fn();
      onClose();
    };
    const out: Hit[] = [];
    for (const w of worlds) {
      if (w.problem || !matches(w.title, w.tagline, w.name)) continue;
      out.push({
        key: `w:${w.name}`,
        title: w.title,
        note: "World",
        go: go(() => nav.open(w.name)),
      });
    }
    for (const c of nav.cards) {
      if (!nav.world || !matches(c.name, c.summary, ...c.keywords)) continue;
      const world = nav.world;
      out.push({
        key: `c:${c.path}`,
        title: c.name,
        note: KIND_WORD[c.kind],
        go: go(() => nav.open(world, c.path)),
      });
    }
    return out.slice(0, 30);
  }, [worlds, query, nav, onClose]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((n) => Math.min(hits.length - 1, n + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((n) => Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      hits[at]?.go();
    }
  };

  return (
    <Modal titleId="jump-title" onClose={onClose}>
      <h2 id="jump-title" className="sr-only">
        <T>Jump to a world or card</T>
      </h2>
      <input
        // biome-ignore lint/a11y/noAutofocus: the box exists only to be typed in
        autoFocus
        type="text"
        aria-controls="jump-list"
        aria-label="Jump to a world or card"
        placeholder="Jump to a world or card"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={onKey}
      />
      <ul id="jump-list" className="jump-list" aria-label="Matches">
        {hits.length === 0 && <li className="empty">Nothing matches.</li>}
        {hits.map((h, i) => (
          <li key={h.key}>
            <button
              type="button"
              tabIndex={-1}
              className={i === at ? "is-at" : undefined}
              aria-current={i === at ? "true" : undefined}
              onMouseEnter={() => setAt(i)}
              onClick={h.go}
            >
              <strong>{h.title}</strong>
              <span className="muted">{h.note}</span>
            </button>
          </li>
        ))}
      </ul>
      {!nav.world && <p className="hint">Open a world to jump to its cards as well.</p>}
    </Modal>
  );
}

/** The header's jump control, and the shortcut that opens it. */
export function useJump() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useJumpShortcut(show);
  return { open, show, hide: useCallback(() => setOpen(false), []) };
}
