/**
 * Fixtures shared by the browser "local" tier (E2E_LOCAL=1): the throwaway CSS
 * port and its two seeded password accounts. BOTH the CSS boot
 * (test/headless/localCss.ts) and the account registry (accounts.ts) read these,
 * so the credentials the browser logs in with can't drift from the ones the server
 * is seeded with. Runtime-agnostic (no Deno/Node APIs) so either side can import it.
 */
import { localProvider, type PodProvider } from "./providers.ts";
import { getEnv } from "./env.ts";

/**
 * Per-lane port offset, added to every Tier-3 port below. 0 (the default) is the
 * normal single-lane run. A second, concurrent lane sets `LOCAL_PORT_OFFSET` to a
 * value large enough to clear all three ports (e.g. 10) so the two lanes — e.g. a
 * CSS lane and a JSS lane run in parallel — bind disjoint pod/control/app ports and
 * never collide. Read once at module load; both processes a lane spawns (the
 * Playwright runner and the `webServer`-spawned pod/preview) inherit the same env,
 * so they compute the same ports. See the matrix launcher (test/e2e-local/matrix.ts).
 */
const PORT_OFFSET = Number(getEnv("LOCAL_PORT_OFFSET") ?? "0") || 0;

export const LOCAL_CSS_PORT = 3456 + PORT_OFFSET;
export const LOCAL_CSS_BASE = `http://localhost:${LOCAL_CSS_PORT}/`;
/** Side port for the Tier-3 control server: `POST /restart` (boot a fresh server)
 * or `POST /wipe` (in-place) gives each spec pristine pods — the caller picks (see
 * test/e2e-local/css.ts + helpers/login.ts). */
export const LOCAL_CSS_CONTROL_PORT = 3457 + PORT_OFFSET;

/**
 * App (Vite) port for Tier 3 specifically — DISTINCT from the Tier-4 port (4173)
 * so the local and real-Pod browser tiers can run at the same time without racing
 * to bind the app server. playwright.config.ts serves the app here (and points
 * baseURL here) only when E2E_LOCAL=1.
 */
export const LOCAL_APP_PORT = 4183 + PORT_OFFSET;

/** A seeded CSS account: email+password login + its pod name (→ derived WebID). */
export interface LocalSeedAccount {
  email: string;
  password: string;
  pod: string;
}

/**
 * The accounts startLocalPod() seeds, keyed to the spec slots. A = Alice, B = Bob,
 * C = Charlie (the benchmark service provider for the BSP round-trip). Solo specs
 * use A; sharing specs A + B; the benchmark spec adds C.
 */
export const LOCAL_SEED: Record<"A" | "B" | "C", LocalSeedAccount> = {
  A: { email: "a@test.local", password: "alice-pw-12345", pod: "alice" },
  B: { email: "b@test.local", password: "bob-pw-12345", pod: "bob" },
  C: { email: "c@test.local", password: "charlie-pw-12345", pod: "charlie" },
};

/** The browser-OIDC provider for the booted local Pod server. Backend-agnostic: the
 * login constructs no WebID — the app reads the authoritative one from the session's
 * `webid` claim after login (tests read it via `webIdOf`). */
export function localBrowserProvider(): PodProvider {
  return localProvider(LOCAL_CSS_BASE, "browser-oidc");
}
