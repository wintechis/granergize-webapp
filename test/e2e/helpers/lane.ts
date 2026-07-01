import type { Page, Route } from "@playwright/test";

/**
 * The e2e **backend** axis for a running spec (see test/README): `local` boots a
 * throwaway CSS and the open-data wrappers are STUBBED per-spec (deterministic,
 * hermetic); `remote` runs the same specs against real Pods AND the LIVE external
 * wrappers, so the real wrapper contract is exercised end-to-end.
 *
 * `E2E_LOCAL` is the switch Playwright's config keys off (set by `deno task e2e:local`).
 * Read it the same way the other helpers do — the config runs under Node, so the flag
 * lives on `process.env`.
 */
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
export const E2E_LOCAL = !!ENV?.E2E_LOCAL;

/**
 * Register a `page.route` stub ONLY in the local lane. In the remote lane this is a
 * no-op, so the request falls through to the live wrapper host — the point of
 * `e2e:remote` for the open-data specs (the stub can silently drift from the real
 * wrapper's shape; only a live hit catches a rename like `point → nearby`).
 *
 * Remote assertions must therefore tolerate nondeterministic live data (assert
 * "populates / > 0", not an exact count); gate any exact-count check on `E2E_LOCAL`.
 */
export async function stubWhenLocal(
  page: Page,
  url: string | RegExp,
  handler: (route: Route) => unknown,
): Promise<void> {
  if (E2E_LOCAL) await page.route(url, handler);
}
