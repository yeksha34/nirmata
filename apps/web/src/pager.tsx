import { useEffect, useState } from "react";
import { Siblings } from "./breadcrumbs";

/**
 * One page of `items` and the Previous / Next pair that moves between pages (the design's
 * "Paging": two buttons, no page numbers). The page returns to the first when `resetKey` changes.
 */
export function usePaged<I>(items: I[], size: number, resetKey?: unknown) {
  const [page, setPage] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts again at the first page
  useEffect(() => setPage(0), [resetKey]);
  const last = Math.max(0, Math.ceil(items.length / size) - 1);
  const at = Math.min(page, last);
  return {
    items: items.slice(at * size, at * size + size),
    pager:
      last === 0 ? null : (
        <Siblings
          label="Pages"
          prev={at > 0 ? { label: String(at), onClick: () => setPage(at - 1) } : undefined}
          next={at < last ? { label: String(at + 2), onClick: () => setPage(at + 1) } : undefined}
        />
      ),
  };
}
