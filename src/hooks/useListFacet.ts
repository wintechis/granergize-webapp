import { useSearchParams } from "react-router-dom";

export interface ListFacet {
  /** The currently-selected values (a subset of `allValues`, order preserved). */
  selected: string[];
  /** Is `value` currently selected? */
  isSelected: (value: string) => boolean;
  /** Replace the whole selection; an **empty** set is ignored (the last value can't
   * be unticked — a finder must always have at least one source). */
  replace: (values: string[]) => void;
}

/**
 * URL-backed **multi-select** facet for a finder — a *source/union* facet (tick the
 * sources to union; the collection = ⋃ selected), the set-valued sibling of
 * {@link useListSearch}. Distinct from a narrowing attribute facet: here selecting
 * more *widens* the result. The selection lives in the query string
 * (`?{param}=`, or `?{key}_{param}=` for a multi-list page) as a comma-separated
 * subset; **absent means all** (the default = every value selected), so the common
 * case keeps a clean URL. Changing it **resets the paging offset** (page 1). The
 * last value can't be unticked (an empty union is meaningless). Pair `isSelected`
 * with a per-item tier accessor to filter before `usePaging`.
 */
export function useListFacet(
  param: string,
  allValues: readonly string[],
  key = "",
): ListFacet {
  const [searchParams, setSearchParams] = useSearchParams();
  const facetParam = key ? `${key}_${param}` : param;
  const offsetParam = key ? `${key}_offset` : "offset";

  const raw = searchParams.get(facetParam);
  // Absent (or no recognised value) → all selected. Otherwise the stated subset,
  // intersected with the known values (a hand-edited junk value is dropped).
  const fromUrl = raw
    ? raw.split(",").filter((v) => allValues.includes(v))
    : [];
  const selected = fromUrl.length > 0 ? allValues.filter((v) => fromUrl.includes(v)) : [
    ...allValues,
  ];

  const replace = (values: string[]) => {
    const next = allValues.filter((v) => values.includes(v));
    if (next.length === 0) return; // guard: never empty the union
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      // Clean URL when everything is selected (the default); else the explicit subset.
      if (next.length === allValues.length) sp.delete(facetParam);
      else sp.set(facetParam, next.join(","));
      sp.delete(offsetParam); // a changed source set resets to page 1
      return sp;
    }, { replace: true });
  };

  return {
    selected,
    isSelected: (value: string) => selected.includes(value),
    replace,
  };
}
