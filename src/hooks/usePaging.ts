import { useState } from "react";

export interface Paging<T> {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages (>= 1). */
  pageCount: number;
  /** The items to render for the current page. */
  pageItems: T[];
  /** Total item count (across all pages). */
  total: number;
  /** Go to a page (clamped to 1..pageCount). */
  setPage: (p: number) => void;
}

/** Default rows per page for the app's resource lists. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Client-side pagination over an already-loaded in-memory list. Keeps the page
 * clamped to the valid range, so a list that shrinks (e.g. after a delete) never
 * leaves you stranded on a now-empty page.
 */
export function usePaging<T>(
  items: readonly T[],
  pageSize: number = DEFAULT_PAGE_SIZE,
): Paging<T> {
  const [page, setPageState] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Clamp on read so a shrunk list shows the last valid page without needing an
  // effect to correct stale state.
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize) as T[];
  const setPage = (p: number) =>
    setPageState(Math.min(Math.max(1, p), pageCount));
  return { page: current, pageCount, pageItems, total, setPage };
}
