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
import { Field } from "./controls";
import { T } from "./i18n";
import type { AssetKind, CardKind, WorldSummary } from "./types";
import { Modal } from "./ui";

/** A card the jump box can offer: only what it shows and searches. */
export interface CardRef {
  path: string;
  name: string;
  kind: CardKind;
  summary: string;
  keywords: string[];
}

export type TopRoute = "worlds" | "vn" | "dataset";

export type ChapterView = "overview" | "cards" | "scenes" | "matrix";
export type VnView = "overview" | "slides" | "assets" | "matrix";

export interface NavState {
  route: TopRoute;
  world?: string;
  card?: string;
  chapter?: string;
  chapterView?: ChapterView;
  sceneId?: string;
  vnWorld?: string;
  vnSlug?: string;
  vnAssetType?: AssetKind;
  vnAssetName?: string;
  vnView?: VnView;
}

function parseLocation(): NavState {
  if (typeof window === "undefined") return { route: "worlds" };
  const pathname = window.location.pathname;
  if (pathname.startsWith("/vn") || pathname.startsWith("/dataset")) {
    const parts = pathname.slice(1).split("/").filter(Boolean);
    const vnWorld = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    const vnSlug = parts[2] ? decodeURIComponent(parts[2]) : undefined;
    if (parts[3] === "matrix") {
      return {
        route: "vn",
        vnWorld,
        vnSlug,
        vnView: "matrix",
      };
    }
    const rawType = parts[3]?.toLowerCase();
    const vnAssetType =
      rawType === "sprite" || rawType === "cg" || rawType === "bg" ? rawType : undefined;
    const vnAssetName = parts[4] ? decodeURIComponent(parts[4]) : undefined;

    return {
      route: parts[0] === "dataset" ? "dataset" : "vn",
      vnWorld,
      vnSlug,
      vnAssetType,
      vnAssetName,
    };
  }

  const parts = pathname.slice(1).split("/").filter(Boolean);
  const world = parts[0] === "worlds" && parts[1] ? decodeURIComponent(parts[1]) : undefined;

  if (world && parts[2] === "chapters" && parts[3]) {
    const chapter = decodeURIComponent(parts[3]);
    const sub = parts[4]?.toLowerCase();
    const chapterView: ChapterView =
      sub === "matrix" || sub === "cards" || sub === "scenes" ? sub : "overview";
    const sceneId = sub === "scenes" && parts[5] ? decodeURIComponent(parts[5]) : undefined;
    return {
      route: "worlds",
      world,
      chapter,
      chapterView,
      sceneId,
    };
  }

  return {
    route: "worlds",
    world,
  };
}

export interface Nav {
  route: TopRoute;
  /** The world whose page is showing, or none for the front page. */
  world: string | undefined;
  /** The card chosen on that page. */
  card: string | undefined;
  chapter?: string;
  chapterView?: ChapterView;
  sceneId?: string;
  open: (world: string, card?: string) => void;
  home: () => void;
  selectCard: (path: string | undefined) => void;
  /** The cards of the world on show, so the jump box can find them. */
  cards: CardRef[];
  setCards: (cards: CardRef[]) => void;

  // VN Studio route parameters and navigators
  vnWorld?: string;
  vnSlug?: string;
  vnAssetType?: AssetKind;
  vnAssetName?: string;
  vnView?: VnView;
  toVn: (
    world?: string,
    slug?: string,
    type?: AssetKind,
    name?: string,
    view?: VnView,
  ) => void;
  toVnMatrix: (world: string, slug: string) => void;
  toChapter: (world: string, chapter: string, view?: ChapterView, sceneId?: string) => void;
  /** The dataset gallery: every archived render of a visual novel, or of one asset in it. */
  toDataset: (world?: string, slug?: string, type?: AssetKind, name?: string) => void;
  toWorlds: (world?: string, card?: string) => void;
}

const Context = createContext<Nav | undefined>(undefined);

export function NavProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<NavState>(parseLocation);
  const [cards, setCards] = useState<CardRef[]>([]);

  useEffect(() => {
    const onPop = () => setPlace(parseLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toVn = useCallback(
    (
      world?: string,
      slug?: string,
      type?: AssetKind,
      name?: string,
      view?: VnView,
    ) => {
      let path = "/vn";
      if (world && slug) {
        path += `/${encodeURIComponent(world)}/${encodeURIComponent(slug)}`;
        if (view === "matrix") {
          path += "/matrix";
        } else if (type && name) {
          path += `/${type}/${encodeURIComponent(name)}`;
        }
      }
      history.pushState(null, "", path);
      setPlace({
        route: "vn",
        vnWorld: world,
        vnSlug: slug,
        vnAssetType: type,
        vnAssetName: name,
        vnView: view,
      });
    },
    [],
  );

  const toVnMatrix = useCallback((world: string, slug: string) => {
    const path = `/vn/${encodeURIComponent(world)}/${encodeURIComponent(slug)}/matrix`;
    history.pushState(null, "", path);
    setPlace({
      route: "vn",
      vnWorld: world,
      vnSlug: slug,
      vnView: "matrix",
    });
  }, []);

  const toChapter = useCallback(
    (world: string, chapter: string, view?: ChapterView, sceneId?: string) => {
      let path = `/worlds/${encodeURIComponent(world)}/chapters/${encodeURIComponent(chapter)}`;
      if (view && view !== "overview") {
        path += `/${view}`;
        if (view === "scenes" && sceneId) {
          path += `/${encodeURIComponent(sceneId)}`;
        }
      }
      history.pushState(null, "", path);
      setPlace({
        route: "worlds",
        world,
        chapter,
        chapterView: view || "overview",
        sceneId,
      });
    },
    [],
  );

  const toDataset = useCallback(
    (world?: string, slug?: string, type?: AssetKind, name?: string) => {
      let path = "/dataset";
      if (world && slug) {
        path += `/${encodeURIComponent(world)}/${encodeURIComponent(slug)}`;
        if (type && name) path += `/${type}/${encodeURIComponent(name)}`;
      }
      history.pushState(null, "", path);
      setPlace({
        route: "dataset",
        vnWorld: world,
        vnSlug: slug,
        vnAssetType: type,
        vnAssetName: name,
      });
    },
    [],
  );

  const toWorlds = useCallback((world?: string, card?: string) => {
    const path = world ? `/worlds/${encodeURIComponent(world)}` : "/worlds";
    history.pushState(null, "", path);
    setPlace({
      route: "worlds",
      world,
      card,
    });
  }, []);

  const value = useMemo<Nav>(
    () => ({
      route: place.route,
      world: place.world,
      card: place.card,
      chapter: place.chapter,
      chapterView: place.chapterView,
      sceneId: place.sceneId,
      open: (world, card) => {
        toWorlds(world, card);
      },
      home: () => {
        toWorlds();
        setCards([]);
      },
      selectCard: (card) => {
        setPlace((p) => ({
          ...(p.world ? { world: p.world } : {}),
          ...(card ? { card } : {}),
          route: "worlds",
        }));
      },
      cards,
      setCards,
      vnWorld: place.vnWorld,
      vnSlug: place.vnSlug,
      vnAssetType: place.vnAssetType,
      vnAssetName: place.vnAssetName,
      vnView: place.vnView,
      toVn,
      toVnMatrix,
      toChapter,
      toDataset,
      toWorlds,
    }),
    [place, cards, toVn, toVnMatrix, toChapter, toDataset, toWorlds],
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
      <Field placeholder="Jump to a world or card" empty={!query}>
        <input
          // biome-ignore lint/a11y/noAutofocus: the box exists only to be typed in
          autoFocus
          type="text"
          aria-controls="jump-list"
          aria-label="Jump to a world or card"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={onKey}
        />
      </Field>
      <ul id="jump-list" className="jump-list" aria-label="Matches">
        {hits.length === 0 && (
          <li className="empty">
            <T>Nothing matches.</T>
          </li>
        )}
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
              <small className="muted">
                <T>{h.note}</T>
              </small>
            </button>
          </li>
        ))}
      </ul>
      {!nav.world && (
        <p className="hint">
          <T>Open a world to jump to its cards as well.</T>
        </p>
      )}
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
