import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config. Runs the Vite dev server itself (via Deno) and drives
 * Chromium. Kept separate from the offline `deno test` unit suite (which lives
 * in src/*_test.ts and needs no browser).
 *
 * - `smoke.spec.ts` runs without any login (login screen only) — CI-safe.
 * - `screenshots.spec.ts` needs a throwaway Solid Pod (env creds) and is
 *   skipped otherwise; it captures the in-app guide screenshots.
 */
const PORT = 4173;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker: run the whole suite serially (one spec at a time). The specs
  // drive a handful of shared throwaway Solid Pods, and fanning spec files out
  // across workers logs into and reads/writes the same Pod hosts concurrently —
  // which trips Cloudflare throttling on those Pods (429/503 surfacing as CORS
  // errors, mid-test OIDC re-auth redirects, and multi-minute timeouts). Serial
  // keeps each Pod under one client at a time. `fullyParallel: false` alone only
  // serializes *within* a file; it still distributes files across workers.
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `deno run -A npm:vite dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
