import { useSearchParams } from "react-router-dom";

export interface Paging<T> {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** The items to render for the current page. */
  pageItems: T[];
  /** Total item count (across all pages). */
  total: number;
  /** Go to a page (clamped to 1..pageCount); writes the offset to the URL. */
  setPage: (p: number) => void;
}

/** Default rows per page (the `limit`) for the app's resource lists. */
export const DEFAULT_PAGE_SIZE = 20;

export interface PagingOptions {
  /** Rows per page (the `limit`); default {@link DEFAULT_PAGE_SIZE}. */
  pageSize?: number;
  /**
   * Namespaces the URL params for a page that paginates MORE THAN ONE list (e.g.
   * the Sharing finder's "shared with you" + "received aggregations"). With a
   * key the params are `{key}_offset`/`{key}_limit`; without one they are the
   * bare `offset`/`limit`.
   */
  key?: string;
}

/**
 * Client-side pagination over an already-loaded in-memory list, with the slice
 * **driven by the URL** (`?offset=&limit=`) rather than local state — so a
 * back/forward, a reload, or a shared link restores the exact slice (e.g.
 * finder → detail → Back returns to the page you left, not page 1). The page is
 * clamped to the valid range, so a list that shrinks (after a delete) never
 * strands you on an empty page. `limit` defaults to `pageSize` and is read from
 * the URL when present (no page-size UI writes it today); `offset` is written on
 * navigation (pushing a history entry, so Back steps through pages).
 */
export function usePaging<T>(
  items: readonly T[],
  options: PagingOptions = {},
): Paging<T> {
  const { pageSize = DEFAULT_PAGE_SIZE, key = "" } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const offsetParam = key ? `${key}_offset` : "offset";
  const limitParam = key ? `${key}_limit` : "limit";

  const limit = Math.max(1, Number(searchParams.get(limitParam)) || pageSize);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const rawOffset = Math.max(0, Number(searchParams.get(offsetParam)) || 0);
  // Snap to a page boundary and clamp to the last valid page start, so a
  // hand-edited or now-out-of-range offset still lands on a real page.
  const maxOffset = (pageCount - 1) * limit;
  const offset = Math.min(rawOffset - (rawOffset % limit), maxOffset);
  const page = Math.floor(offset / limit) + 1;
  const pageItems = items.slice(offset, offset + limit) as T[];

  const setPage = (p: number) => {
    const clamped = Math.min(Math.max(1, p), pageCount);
    const newOffset = (clamped - 1) * limit;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Keep page-1 URLs clean (no `offset=0`); other params are preserved.
      if (newOffset === 0) next.delete(offsetParam);
      else next.set(offsetParam, String(newOffset));
      return next;
    });
  };

  return { page, pageCount, pageItems, total, setPage };
}
