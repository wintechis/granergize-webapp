import { defineConfig, devices } from "@playwright/test";
import { LOCAL_APP_PORT } from "./test/config/localSeed.ts";

/**
 * Playwright config for the browser tiers: Tier 4 drives Chromium against real Pods
 * (`deno task e2e:remote`, or `e2e:remote:spec` for one spec); Tier 3 reuses the same
 * specs against a throwaway local CSS, credential-free (`deno task e2e:local`, the
 * `local` project, E2E_LOCAL=1). Tiers 1
 * (deno test) and 2 (deno task it) are separate. `login.spec.ts` runs with no creds;
 * credentialed (Tier-4) specs self-skip.
 */
const CI = !!process.env.CI;
// Tier 3 (browser × local CSS): boot a throwaway CSS and run the specs against it,
// credential-free (E2E_LOCAL=1, via `deno task e2e:local`). Off for real-Pod runs.
const LOCAL = !!process.env.E2E_LOCAL;
// Tier 3 serves the app on its OWN port (LOCAL_APP_PORT) so it can run concurrently
// with a Tier-4 real-Pod run (which uses 4173) without a port clash.
// `E2E_PORT` overrides either. Both webServer and baseURL key off this single value.
const PORT = Number(process.env.E2E_PORT) || (LOCAL ? LOCAL_APP_PORT : 4173);

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

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  // Serial. Fanning spec files across workers logs into the SAME Pod host
  // concurrently, which trips Cloudflare throttling (429/503 as CORS, mid-test OIDC
  // re-auth, multi-minute timeouts). The two roles (A/B) run their specs in sequence.
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // `list` for output; `cf1015Reporter` aborts the whole run the instant a Pod host
  // behind Cloudflare answers Error 1015 (rate limited), so we don't grind through
  // every remaining spec's retries/timeouts against a tripped limiter.
  reporter: [["list"], ["./test/e2e/cf1015Reporter.ts"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  /**
   * Specs split into functional projects. The two roles are A = Alice and B = Bob;
   * configure their Pods/WebIDs per run by `source`-ing an env file (see test/README.md):
   *  - `solo`    — single-account specs; run against Alice (account A).
   *  - `sharing` — cross-Pod specs; use the A+B pair (Alice + Bob).
   *  - `support` — handbuch screenshots (account A / Alice).
   *  - `local`   — TIER 3: solo + sharing specs against a throwaway local CSS, no
   *                creds (only present when E2E_LOCAL=1; the seeded A/B pods
   *                interoperate, so sharing runs in-browser too). `deno task e2e:local`.
   * `deno task e2e:remote` runs solo + sharing; `e2e:remote:spec --project=<name>`
   * (or a spec path) selects one. `support`/`reset` are excluded from the full run.
   */
  projects: [
    { name: "solo", use: CHROME, testMatch: SOLO_SPECS },
    { name: "sharing", use: CHROME, testMatch: SHARING_SPECS },
    { name: "support", use: CHROME, testMatch: ["**/support/**/*.spec.ts"] },
    // Maintenance: wipe the e2e app collection for both roles. DESTRUCTIVE, so it
    // exists ONLY when E2E_RESET is set (which `deno task e2e:remote:reset` does) —
    // otherwise a no-project run could pick it up and wipe data. `--project=reset`.
    ...(process.env.E2E_RESET
      ? [{ name: "reset", use: CHROME, testMatch: ["**/maintenance/reset.spec.ts"] }]
      : []),
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
        // Wait on the control server's health (port 3457): it starts listening only
        // AFTER startLocalCss() resolves (CSS booted + SEEDED), so this one wait
        // guarantees CSS is ready AND the per-spec `/reset` endpoint is up (no
        // first-spec race against seeding or against the control server).
        url: "http://localhost:3457/",
        reuseExistingServer: !CI,
        timeout: 90_000,
      }]
      : []),
  ],
});
