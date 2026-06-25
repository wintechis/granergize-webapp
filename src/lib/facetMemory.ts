/**
 * Session-scoped memory of a finder's source-tier facet selection (the mine / shared /
 * open buttons), so re-entering a finder through its nav tab restores the buttons you
 * last activated instead of snapping back to the hardcoded default. Backed by
 * `sessionStorage`: it survives reloads and in-app navigation but is **per browsing
 * context** — wiped when the tab/window closes, not shared across tabs, not synced
 * across devices. Deliberately not `localStorage` (which would persist forever) nor
 * `prefs.ttl` (account state) — a tier choice is a convenience for *this* session. The
 * URL still wins when it carries an explicit selection (a deep link / Back), so sharing
 * a tier view is unaffected; this only changes what the *default* is when the URL says
 * nothing. See `useListFacet`.
 */

const keyFor = (facetParam: string) => `granergize.facet.${facetParam}`;

/** The remembered selection for a facet, or null when nothing is stored / storage is
 * unavailable (private mode, disabled). The caller intersects it with the known values. */
export function rememberedFacet(facetParam: string): string[] | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(keyFor(facetParam));
    if (!raw) return null;
    const vals = raw.split(",").filter(Boolean);
    return vals.length > 0 ? vals : null;
  } catch {
    return null;
  }
}

/** Remember a facet's activated set for the rest of this session. A no-op when storage
 * is unavailable — the finder simply falls back to the hardcoded per-visit default. */
export function rememberFacet(facetParam: string, values: string[]): void {
  try {
    globalThis.sessionStorage?.setItem(keyFor(facetParam), values.join(","));
  } catch {
    // storage unavailable — silently keep per-visit defaults
  }
}

/**
 * The single-value sibling of {@link rememberedFacet} for a finder's view axis (the
 * map/list/… toggle: `view`/`space`/`guise`), so it sticks across a nav-tab re-entry
 * like the tier facet. Returns the remembered value, or null when nothing is stored /
 * storage is unavailable. The caller validates it against the axis's known values.
 */
export function rememberedValue(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(keyFor(key)) ?? null;
  } catch {
    return null;
  }
}

/** Remember a single-value view axis for the rest of this session ({@link rememberedValue}). */
export function rememberValue(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(keyFor(key), value);
  } catch {
    // storage unavailable
  }
}

/**
 * The default selection to apply when the URL carries no facet param: the remembered
 * subset (intersected with `allValues`, ordered by it) when non-empty, else the
 * hardcoded `baseDefault`. Pure — the `localStorage` read is the caller's, so this is
 * offline-testable. A stale/junk remembered value (no longer a known tier) drops out
 * and the base default stands.
 */
export function effectiveFacetDefault(
  remembered: string[] | null,
  baseDefault: readonly string[],
  allValues: readonly string[],
): string[] {
  const valid = remembered ? allValues.filter((v) => remembered.includes(v)) : [];
  return valid.length > 0 ? valid : [...baseDefault];
}
