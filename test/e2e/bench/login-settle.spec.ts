import { expect, type Page, test } from "@playwright/test";
import { account, login } from "../helpers/login.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { sweepSizes, writeBenchDat } from "./benchSpec.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): time until the app has
 * SETTLED after login — what a returning user actually waits for. Substrate:
 * B has shared N buildings with A, A's inbox pre-drained (`/seed-shared`,
 * steady state — the first-visit drain cost is share-render's third column).
 *
 * Per size, a FRESH browser context logs in as A. The timer starts when the
 * OIDC redirect lands back on the APP origin (the IdP form-filling before that
 * is driver noise, not app cost), then two marks:
 *
 *   usable_ms  — the Explore map has painted all N shared markers (phase-1
 *                buildings done; the "I can start clicking" moment).
 *   settled_ms — the browser's network went idle after that (login drain,
 *                phase-2 energy, profile/logo resolutions quiesced — the
 *                period the header activity indicator spins). `networkidle`
 *                resolves after 500 ms of quiet, so settled_ms carries that
 *                constant; the usable→settled gap is the background-loading
 *                window.
 *
 * Measure-and-report into `test-results/bench/<run-id>/login-settle.dat`; no
 * time-based assertions. Local tier only; runs as the `bench` Playwright
 * project, gated by E2E_BENCH.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;

const ACC = account("A");

/**
 * Arm a main-frame navigation listener that captures the instant the OIDC
 * flow returns to the app origin: the first navigation defines the app origin,
 * leaving it marks the IdP round-trip, and the first navigation BACK starts
 * the clock.
 */
function armReturnTimer(page: Page): { t0: () => number } {
  let appOrigin = "";
  let leftApp = false;
  let returnedAt = 0;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!url.startsWith("http")) return;
    const origin = new URL(url).origin;
    if (!appOrigin) {
      appOrigin = origin;
    } else if (origin !== appOrigin) {
      leftApp = true;
    } else if (leftApp && returnedAt === 0) {
      returnedAt = Date.now();
    }
  });
  return { t0: () => returnedAt };
}

test.describe.configure({ mode: "serial" });

test.describe("login-settle benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local pod server (deno task bench:ui).");

  test("time from OIDC return to usable and to settled across shared-in sizes", async ({ browser }) => {
    const SIZES = sweepSizes("BENCH_SHARED_SIZES", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    // Per size: a seed, one full OIDC login on a fresh context, two waits.
    test.setTimeout(60_000 + SIZES.length * 150_000);
    const rows: number[][] = [];

    for (const n of SIZES) {
      const res = await fetch(`${CONTROL}/seed-shared?n=${n}&drained=1`, { method: "POST" });
      expect(res.ok, `seed-shared n=${n} (HTTP ${res.status})`).toBeTruthy();

      // A fresh context per size: a reused one would silently RESTORE the
      // session instead of logging in, skipping the very flow being timed.
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
      const page = await ctx.newPage();
      try {
        const timer = armReturnTimer(page);
        await login(page, ACC);
        const t0 = timer.t0();
        expect(t0, "the OIDC return navigation was observed").toBeGreaterThan(0);

        await expect(page.locator(".leaflet-marker-icon"))
          .toHaveCount(n, { timeout: 120_000 });
        const usableMs = Date.now() - t0;

        await page.waitForLoadState("networkidle", { timeout: 120_000 });
        const settledMs = Date.now() - t0;

        rows.push([n, usableMs, settledMs]);
        console.log(`  n=${n}  usable ${usableMs}  settled ${settledMs} ms`);
      } finally {
        await ctx.close();
      }
    }

    writeBenchDat(
      "login-settle",
      "n_shared  usable_ms  settled_ms",
      rows,
      { "login-settle sweep (shared-in buildings)": SIZES.join(" ") },
    );
  });
});
