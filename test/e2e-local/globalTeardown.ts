import { LOCAL_CSS_CONTROL_PORT } from "../config/localSeed.ts";

/**
 * Playwright globalTeardown for the Tier-3 local tier. Asks the throwaway Pod's
 * control server to stop itself at the end of the run (`POST /stop`), so the
 * server's shutdown is owned by Playwright's own lifecycle instead of leaking past
 * the run. The CSS/JSS is spawned under `setsid`, so a kill of the test process
 * tree wouldn't reap it — only this in-band stop does (see `test/e2e-local/css.ts`).
 *
 * Runs in the Node test runner, so it uses `fetch` (not Deno APIs). No-op for Tier
 * 4 (no local control server) and best-effort: if the server is already gone the
 * fetch just fails and we move on.
 */
export default async function globalTeardown(): Promise<void> {
  if (!process.env.E2E_LOCAL) return; // Tier 4 has no local Pod server to stop
  try {
    await fetch(`http://localhost:${LOCAL_CSS_CONTROL_PORT}/stop`, {
      method: "POST",
    });
  } catch {
    // Already stopped / never started — nothing to do.
  }
}
