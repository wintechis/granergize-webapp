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
 * Per-lane port offset. Each lane binds three Tier-3 ports — pod `3456+offset`,
 * control `3457+offset`, app `4183+offset` — so concurrent lanes only need
 * distinct offsets. ONE rule keeps them apart: a task sets a CSS BASE offset via
 * `LOCAL_PORT_OFFSET`, and the JSS twin of that task adds **+10 automatically**.
 * So every `:jss` task stays the trivial `LOCAL_POD_SERVER=jss deno task <css>`
 * with no offset duplicated, and a CSS lane never collides with its JSS sibling.
 *
 * Lane map — CSS = base, JSS = base + 10 (see deno.json):
 *   0 / 10   dev:local         (deno task dev:local[:jss])
 *   20 / 30  bench             (bench:css·bench:ui:css / bench·bench:ui)
 *   50       handbuch          (CSS only)
 *   60       videos            (CSS only)
 *   80 / 90  e2e + matrix      (e2e:local·reuse·it·stress, both matrix lanes)
 */
const LANE_BASE = Number(getEnv("LOCAL_PORT_OFFSET") ?? "0") || 0;
const PORT_OFFSET = LANE_BASE + (getEnv("LOCAL_POD_SERVER") === "jss" ? 10 : 0);

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

// Announce the resolved lane up-front (only in a local-tier context, so unrelated
// imports stay quiet) — the "which offset am I on" overview parallel lanes need.
if (getEnv("E2E_LOCAL") || getEnv("LOCAL_PORT_OFFSET") || getEnv("LOCAL_POD_SERVER")) {
  console.error(
    `[tier-3 ${getEnv("LOCAL_POD_SERVER") === "jss" ? "jss" : "css"}] ` +
      `pod=${LOCAL_CSS_PORT} control=${LOCAL_CSS_CONTROL_PORT} ` +
      `app=${LOCAL_APP_PORT} (offset ${PORT_OFFSET})`,
  );
}

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
