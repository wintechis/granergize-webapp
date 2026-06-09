/**
 * Navigational UI state encoded in the home route's hash query params, so a
 * browser reload (or a bookmark/share) restores what you were looking at. See
 * `notes/ui-state.md` for the full scheme and the per-tab inventory.
 *
 * Pure (no React/DOM), so it can be unit-tested under `deno test` — the MUI pages
 * that consume it cannot render there. (`URLSearchParams` here is the platform
 * built-in; the address we encode into is a hash URI per RFC 3986.)
 */

/** The four home tabs, in render order. The `?tab=` slug is the index here. */
export const HOME_TABS = ["explore", "manage", "share", "connect"] as const;
export type HomeTabSlug = (typeof HOME_TABS)[number];

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

/** `?tab=` slug → home tab index (Explore=0…Connect=3); unknown → 0 (Explore). */
export function tabIndexFromSlug(slug: string | null | undefined): number {
  return indexFromSlug(HOME_TABS, slug);
}

/** Home tab index → `?tab=` slug; out-of-range → "explore". */
export function slugFromTabIndex(index: number): HomeTabSlug {
  return slugFromIndex(HOME_TABS, index);
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
 * `null` deletes it, other keys are left untouched. Lets the shell (`tab`) and
 * Explore (`b`/`dt`) update their own params without clobbering each other.
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
