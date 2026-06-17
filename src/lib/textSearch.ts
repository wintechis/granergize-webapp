/**
 * Shared keyword matching for the app's list/collection finders. One matcher so
 * every finder searches the same way (case-insensitive, all-terms-must-match
 * substring) — the search analogue of the shared `usePaging`/`Pager` primitives.
 */

/**
 * Case-insensitive AND-substring match: every whitespace-separated term in
 * `query` must appear somewhere in `text`. An empty/whitespace query matches
 * everything (the no-filter case).
 */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = text.toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/**
 * Filter `items` by matching `query` against each item's searchable text (the
 * caller supplies the per-type accessor — the only bespoke bit per finder).
 * Returns the input unchanged when the query is empty.
 */
export function filterByText<T>(
  items: readonly T[],
  query: string,
  searchText: (item: T) => string,
): T[] {
  if (!query.trim()) return items as T[];
  return items.filter((item) => matchesQuery(searchText(item), query));
}
