import { useSearchParams } from "react-router-dom";

export interface ListSearch {
  /** The live query string (the controlled search-field value). */
  query: string;
  /** Set the query; resets this list to page 1 and writes the URL. */
  setQuery: (q: string) => void;
}

/**
 * URL-backed keyword-search state for a finder, the search sibling of
 * {@link usePaging}: the term lives in the query string (`?q=`, or `{key}_q=`
 * when a page carries more than one list) so a reload / Back / shared link
 * restores it. Setting a new query **drops this list's paging offset** (the
 * `{key}_offset` written by `usePaging`), so a fresh search lands on page 1
 * rather than a now-out-of-range page. Writes replace (no per-keystroke history
 * entry). Pair the returned `query` with `filterByText(...)` before `usePaging`.
 */
export function useListSearch(key = ""): ListSearch {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = key ? `${key}_q` : "q";
  const offsetParam = key ? `${key}_offset` : "offset";
  const query = searchParams.get(queryParam) ?? "";

  const setQuery = (q: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (q.trim()) next.set(queryParam, q);
      else next.delete(queryParam);
      // A changed query resets the slice — page 1 of the filtered list.
      next.delete(offsetParam);
      return next;
    }, { replace: true });
  };

  return { query, setQuery };
}
