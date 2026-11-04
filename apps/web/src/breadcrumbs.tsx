import type { ReactNode } from "react";
import { T } from "./i18n";
import { type ChapterView, useNav } from "./nav";

export interface Crumb {
  label: ReactNode;
  onClick?: () => void;
  current?: boolean;
}

export interface Sibling {
  label: string;
  onClick: () => void;
}

/** Previous and Next at the same depth (the design's "siblings"): a dimmed button when there is no neighbour. */
export function Siblings({ prev, next, label }: { prev?: Sibling; next?: Sibling; label?: string }) {
  if (!prev && !next) return null;
  const chevron = (d: string) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  return (
    <menu className="sibs" aria-label={label}>
      <button type="button" className={prev ? undefined : "off"} disabled={!prev} onClick={prev?.onClick} title={prev?.label}>
        {chevron("M15 6l-6 6 6 6")}
        <T>Previous</T>
      </button>
      <button type="button" className={next ? "n" : "n off"} disabled={!next} onClick={next?.onClick} title={next?.label}>
        <T>Next</T>
        {chevron("M9 6l6 6-6 6")}
      </button>
    </menu>
  );
}

export function Breadcrumbs({
  worldTitle,
  chapterTitle,
  chapterSlug,
  cardName,
  vnTitle,
  sceneId,
  subView,
  prev,
  next,
}: {
  worldTitle?: string;
  chapterTitle?: string;
  chapterSlug?: string;
  cardName?: string;
  vnTitle?: string;
  sceneId?: string;
  subView?: ChapterView;
  prev?: Sibling;
  next?: Sibling;
}) {
  const nav = useNav();
  const crumbs: Crumb[] = [];

  if (nav.route === "worlds") {
    crumbs.push({
      label: <T>Worlds</T>,
      onClick: nav.world ? () => nav.home() : undefined,
      current: !nav.world,
    });

    if (nav.world) {
      crumbs.push({
        label: worldTitle || nav.world,
        onClick: chapterSlug || nav.card ? () => nav.open(nav.world!) : undefined,
        current: !chapterSlug && !nav.card,
      });

      if (chapterSlug) {
        crumbs.push({
          label: chapterTitle || chapterSlug,
          onClick: subView || sceneId ? () => nav.toChapter(nav.world!, chapterSlug) : undefined,
          current: !subView && !sceneId,
        });

        if (subView) {
          crumbs.push({
            label:
              subView === "matrix" ? (
                <T>Scene Matrix</T>
              ) : subView === "cards" ? (
                <T>Cards</T>
              ) : subView === "scenes" ? (
                <T>Scenes</T>
              ) : (
                <T>Overview</T>
              ),
            onClick: sceneId ? () => nav.toChapter(nav.world!, chapterSlug, subView) : undefined,
            current: !sceneId,
          });
        }

        if (sceneId) {
          crumbs.push({
            label: sceneId,
            current: true,
          });
        }
      } else if (nav.card) {
        crumbs.push({
          label: cardName || nav.card.split("/").pop()?.replace(/\.md$/, "") || <T>Card</T>,
          current: true,
        });
      }
    }
  } else if (nav.route === "vn") {
    crumbs.push({
      label: <T>Visual Novels</T>,
      onClick: nav.vnWorld ? () => nav.toVn() : undefined,
      current: !nav.vnWorld,
    });

    if (nav.vnWorld && nav.vnSlug) {
      crumbs.push({
        label: vnTitle || nav.vnSlug,
        onClick:
          nav.vnView === "matrix" || nav.vnAssetName
            ? () => nav.toVn(nav.vnWorld, nav.vnSlug)
            : undefined,
        current: !nav.vnView && !nav.vnAssetName,
      });

      if (nav.vnView === "matrix") {
        crumbs.push({
          label: <T>Scene Matrix</T>,
          current: true,
        });
      } else if (nav.vnAssetName) {
        crumbs.push({
          label: `${nav.vnAssetType ?? "asset"}: ${nav.vnAssetName}`,
          current: true,
        });
      }
    }
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={i} className={c.current ? "current" : undefined}>
            {c.current || !c.onClick ? (
              <strong aria-current={c.current ? "page" : undefined}>{c.label}</strong>
            ) : (
              <button type="button" className="crumb-link" onClick={c.onClick}>
                {c.label}
              </button>
            )}
          </li>
        ))}
      </ol>
      <Siblings label="Neighbours" prev={prev} next={next} />
    </nav>
  );
}
