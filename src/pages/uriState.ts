/**
 * Navigational UI state encoded in the Buildings finder's query params, so a
 * browser reload (or a bookmark/share) restores what you were looking at. The
 * active *finder* is the route now (`/buildings`, `/sharing`, …) — there is no
 * `?tab=`; what remains here is the Buildings-map sub-state (`?b=` selected
 * building, `?dt=` detail sub-tab), owned by ExplorePage. See `notes/ui-state.md`.
 *
 * Pure (no React/DOM), so it can be unit-tested under `deno test` — the MUI pages
 * that consume it cannot render there. (`URLSearchParams` here is the platform
 * built-in; the address we encode into is a URI per RFC 3986.)
 */

/** The Explore detail sub-tabs, in render order. The `?dt=` slug indexes here. */
export const DETAIL_TABS = ["building", "energy", "weather"] as const;
export type DetailTabSlug = (typeof DETAIL_TABS)[number];

function indexFromSlug(
  slugs: readonly string[],
  slug: string | null | undefined,
): number {
  const i = slug ? slugs.indexOf(slug) : -1;
  return i >= 0 ? i : 0; // unknown / missing → the first tab
}

function slugFromIndex<T extends string>(slugs: readonly T[], index: number): T {
  return slugs[index] ?? slugs[0];
}

/** `?dt=` slug → detail sub-tab index (building=0/energy=1/weather=2); unknown → 0. */
export function detailIndexFromSlug(slug: string | null | undefined): number {
  return indexFromSlug(DETAIL_TABS, slug);
}

/** Detail sub-tab index → `?dt=` slug; out-of-range → "building". */
export function slugFromDetailIndex(index: number): DetailTabSlug {
  return slugFromIndex(DETAIL_TABS, index);
}

/**
 * Return a copy of `prev` with `changes` applied: a string value sets the key, a
 * `null` deletes it, other keys are left untouched. Lets ExplorePage update one
 * of its own params (`b`/`dt`) without clobbering the other.
 */
export function mergeParams(
  prev: URLSearchParams,
  changes: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return next;
}
