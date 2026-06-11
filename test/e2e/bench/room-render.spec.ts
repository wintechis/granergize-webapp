import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { account, login } from "../helpers/login.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { benchRunId } from "../../bench/runId.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): end-to-end browser
 * time-to-render of a data room's MEMBER LIST as its membership grows. Companion
 * to manage-render.spec.ts — same measure-and-report shape, writing timings to
 * `test-results/bench/<run-id>/room-render.dat` (the Deno `plots.ts` step then draws the
 * PNG); no time-based assertions.
 *
 * Seeding goes through the local-CSS control server (`POST /seed-room?n=`), which
 * runs in DENO and uses the real data layer (createRoom + N synthetic as:Join
 * events) — the spec can't seed itself because the data layer needs Deno-only deps
 * (npm:jose) that don't load under Playwright's Node loader. The seeded room is
 * A's active room, so the Connect tab auto-expands it. Per size we COLD-load the
 * app (full navigation clears the in-memory React Query cache) and time until the
 * member list reflects all N seeded members — the cost is dominated by folding the
 * room's append-only event log (one read per event).
 *
 * Local tier only (needs the control server). Runs as the `bench` Playwright
 * project, gated by E2E_BENCH so the normal e2e runs don't pick it up.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;
// Same dated run directory as the Deno side (test-results/bench/<run-id>/), so
// the follow-up plots.ts step picks this .dat up with the rest of the run.
const RESULTS_DIR = fileURLToPath(
  new URL(`../../../test-results/bench/${benchRunId()}`, import.meta.url),
);

function sizes(): number[] {
  const raw = process.env.BENCH_ROOM_SIZES;
  const def = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  if (!raw) return def;
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

const ACC = account("A");

/**
 * The seeded synthetic member rows in the active room's expanded box. A member row
 * renders as an AgentLabel — the WebID is the contact-detail link's HREF, while the
 * visible text is the resolved name (for these unresolvable synthetic WebIDs, the
 * `#me` fragment fallback) — so the bench marker is matched in the href, not the
 * text. Counts exactly the N seeded members; A's own (auto-joined) row doesn't
 * match. `:not(:has(ul))` keeps it to the leaf member `<li>`s: the active room's
 * OUTER row is also an `<li>` and wraps the members `<ul>`, so it contains the
 * same links and would otherwise be miscounted.
 */
const memberRows = (page: Page) =>
  page.locator('li:not(:has(ul)):has(a[href*="bench.example"])');

test.describe.configure({ mode: "serial" });

test.describe("room-render benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local pod server (deno task bench:ui).");

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, ACC); // bench skips the CSS reset; logs into the warm CSS
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("time-to-render the room member list across membership counts", async () => {
    const SIZES = sizes();
    test.setTimeout(60_000 + SIZES.length * 130_000);
    const rows: Array<[number, number, number]> = [];

    for (const n of SIZES) {
      // Host a fresh room with exactly N seeded members in A's pod (Deno side; no
      // browser cost).
      const res = await fetch(`${CONTROL}/seed-room?n=${n}`, { method: "POST" });
      expect(res.ok, `seed-room n=${n} (HTTP ${res.status})`).toBeTruthy();

      // Cold load: a full navigation drops the in-memory query cache, so the app
      // refetches + folds the room log + re-renders from scratch. Time from
      // navigation to the member list reflecting all N seeded members.
      const t0 = Date.now();
      await page.goto("/");
      await page.getByRole("tab", { name: "Connect" }).click();
      await expect(memberRows(page)).toHaveCount(n, { timeout: 120_000 });
      const ms = Date.now() - t0;

      rows.push([n, ms, n > 0 ? ms / n : 0]);
      console.log(`  n=${n}  ${ms} ms`);
    }

    // Write the gnuplot data file; the `bench:ui` task then runs the Deno plot
    // step (plots.ts) which renders room-render.png alongside the other graphs.
    mkdirSync(RESULTS_DIR, { recursive: true });
    const header = "# n_members  total_ms  ms_per_member";
    const body = rows
      .map(([n, ms, per]) => `${n}  ${ms}  ${per.toFixed(3)}`)
      .join("\n");
    writeFileSync(`${RESULTS_DIR}/room-render.dat`, `${header}\n${body}\n`);
    console.log(`wrote ${RESULTS_DIR}/room-render.dat`);
  });
});
