import { defineConfig, devices } from "@playwright/test";
import { poolAccounts } from "./test/config/accounts.ts";

/**
 * Playwright config for the browser tiers: Tier 4 drives Chromium against real Pods
 * (`deno task e2e:base`); Tier 3 reuses the same specs against a throwaway local
 * CSS, credential-free (`deno task e2e`, the `local` project, E2E_LOCAL=1). Tiers 1
 * (deno test) and 2 (deno task it) are separate. `login.spec.ts` runs with no creds;
 * credentialed (Tier-4) specs self-skip.
 */
const PORT = 4173;
const CI = !!process.env.CI;
// Tier 3 (browser × local CSS): boot a throwaway CSS and run the specs against it,
// credential-free (E2E_LOCAL=1, via `deno task e2e`). Off for real-Pod runs.
const LOCAL = !!process.env.E2E_LOCAL;

const CHROME = { ...devices["Desktop Chrome"] };
const SOLO_SPECS = [
  "**/login.spec.ts",
  "**/organisation.spec.ts",
  "**/add-building.spec.ts",
  "**/excel-import.spec.ts",
  "**/excel-export.spec.ts",
  "**/energy-entry.spec.ts",
  "**/view-data.spec.ts",
  "**/data-room.spec.ts",
  "**/building-details.spec.ts",
];
const SHARING_SPECS = ["**/share-building.spec.ts", "**/share-view.spec.ts"];

/**
 * Worker count is a property of the configured PROVIDERS, not a blunt constant
 * (§4 of the test-foundation plan). Default 1 — fanning spec files across workers
 * logs into the SAME Pod host concurrently, which trips Cloudflare throttling
 * (429/503 as CORS, mid-test OIDC re-auth, multi-minute timeouts). Only when an
 * account POOL of DISTINCT, UNTHROTTLED hosts is configured (P0..Pn) do we fan out
 * — each worker then grabs a distinct account/host, so no stampede or collision.
 */
function computeWorkers(): number {
  const pool = poolAccounts();
  if (pool.length < 2) return 1;
  const distinctHosts = new Set(pool.map((a) => a.provider.issuer)).size;
  const allUnthrottled = pool.every((a) => !a.provider.throttled);
  return allUnthrottled && distinctHosts === pool.length ? pool.length : 1;
}

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: computeWorkers(),
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  /**
   * Specs split into functional projects. solo/sharing/support are the Tier-4
   * (real-Pod) groups, each targeting one account group:
   *  - `solo`    — single-account specs; the Pod is chosen by `E2E_SOLO` (slot id,
   *                default C = solidweb). Run twice (E2E_SOLO=C, then =D) to cover
   *                both solo Pods; the two hosts differ, so the runs go in parallel
   *                (test/run-e2e.sh).
   *  - `sharing` — cross-Pod specs; use the A+B pair (the solidcommunity Pods).
   *  - `support` — handbuch screenshots (account A, canonical solidcommunity URIs).
   *  - `local`   — TIER 3: solo + sharing specs against a throwaway local CSS, no
   *                creds (only present when E2E_LOCAL=1; the seeded A/B pods
   *                interoperate, so sharing runs in-browser too). `deno task e2e`.
   * `deno task e2e:base --project=solo` (etc.) selects one Tier-4 group.
   */
  projects: [
    { name: "solo", use: CHROME, testMatch: SOLO_SPECS },
    { name: "sharing", use: CHROME, testMatch: SHARING_SPECS },
    { name: "support", use: CHROME, testMatch: ["**/support/**/*.spec.ts"] },
    // Gated on E2E_LOCAL so the default/real-Pod runs don't re-run these specs
    // (they'd duplicate solo+sharing). Selected via `--project=local`.
    ...(LOCAL
      ? [{ name: "local", use: CHROME, testMatch: [...SOLO_SPECS, ...SHARING_SPECS] }]
      : []),
  ],
  // Always the Vite app; plus the throwaway CSS when running the local tier. Both
  // reuse an already-running instance locally so parallel invocations don't race.
  webServer: [
    {
      // E2E_PREVIEW serves the production build (`deno task build` first) instead
      // of the dev server — rules out Vite-dev/HMR artifacts (e.g. the local tier's
      // write-abort investigation) and is the more CI-correct substrate.
      command: process.env.E2E_PREVIEW
        ? `deno run -A npm:vite preview --port ${PORT} --strictPort`
        : `deno run -A npm:vite dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    ...(LOCAL
      ? [{
        command: "deno run -A test/e2e-local/css.ts",
        // Wait on a SEEDED resource (the alice pod's WebID doc), not just
        // `.well-known/openid-configuration` — the latter responds before the pods
        // are seeded, so the first spec's login would race seeding (a ~2-min
        // login-retry stall / failure). The card only 200s once alice exists.
        url: "http://localhost:3456/alice/profile/card",
        reuseExistingServer: !CI,
        timeout: 90_000,
      }]
      : []),
  ],
});
