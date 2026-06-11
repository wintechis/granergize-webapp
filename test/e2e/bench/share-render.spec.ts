import { expect, type Page, test } from "@playwright/test";
import { account, login } from "../helpers/login.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { sweepSizes, writeBenchDat } from "./benchSpec.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): the PAIR
 * recipient-at-scale scenario — B has shared N buildings with A via a data room
 * (the Tier-2 D3 substrate, seeded by the control server's `POST /seed-shared`),
 * and A's browser is timed reflecting them. Three measurements per size:
 *
 *   share_list_ms — steady state (inbox pre-drained): cold load → Share tab
 *                   lists all N shared-in buildings.
 *   map_ms        — same state: cold load → the Explore map paints N shared
 *                   markers (phase-1 buildings; each shared source is its own
 *                   cross-Pod fetch).
 *   drain_ms      — first visit (inbox NOT drained): cold reload → the app's
 *                   login/reload inbox drain archives the N notifications →
 *                   Share tab lists all N. The drained/undrained delta is the
 *                   UI cost of the drain itself.
 *
 * The UI ("in practice") twin of the Tier-2 D3 share/drain/fold numbers.
 * Measure-and-report into `test-results/bench/<run-id>/share-render.dat`; no
 * time-based assertions. Local tier only (needs the control server); runs as
 * the `bench` Playwright project, gated by E2E_BENCH.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;
const PAGE_SIZE = 20; // DEFAULT_PAGE_SIZE in usePaging.ts

const ACC = account("A");

async function seedShared(n: number, drained: boolean): Promise<void> {
  const res = await fetch(
    `${CONTROL}/seed-shared?n=${n}&drained=${drained ? 1 : 0}`,
    { method: "POST" },
  );
  expect(res.ok, `seed-shared n=${n} (HTTP ${res.status})`).toBeTruthy();
}

/**
 * Resolve once the Share tab reflects all N shared-in buildings: the Pager's
 * "of N" summary when there is more than one page (confirms the whole fold, not
 * just the rendered page), else the row count inside the named shared list.
 */
async function awaitSharedList(page: Page, n: number): Promise<void> {
  await page.getByRole("tab", { name: "Share" }).click();
  if (n > PAGE_SIZE) {
    await expect(page.getByText(new RegExp(`\\bof ${n}\\b`)).first())
      .toBeVisible({ timeout: 120_000 });
  } else {
    const rows = page
      .getByRole("list", { name: /buildings shared with you/i })
      .getByText(/^Building bench-/);
    await expect(rows).toHaveCount(n, { timeout: 120_000 });
  }
}

test.describe.configure({ mode: "serial" });

test.describe("share-render benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local pod server (deno task bench:ui).");

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, ACC); // resets the pod server first (per spec file), then logs in
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("time-to-render N shared-in buildings (list, map, and first-visit drain)", async () => {
    const SIZES = sweepSizes("BENCH_SHARED_SIZES", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    // Two seeds + three timed cold loads per size; seeding shares serially.
    test.setTimeout(60_000 + SIZES.length * 200_000);
    const rows: number[][] = [];

    for (const n of SIZES) {
      // Steady state: everything already archived into A's shared-in/ log.
      await seedShared(n, true);

      let t0 = Date.now();
      await page.goto("/");
      await awaitSharedList(page, n);
      const listMs = Date.now() - t0;

      // Same state, map surface: "/" lands on Explore; phase 1 fetches each
      // shared source and paints one marker per building (inline coords).
      t0 = Date.now();
      await page.goto("/");
      await expect(page.locator(".leaflet-marker-icon"))
        .toHaveCount(n, { timeout: 120_000 });
      const mapMs = Date.now() - t0;

      // First visit: N notifications still in A's inbox; the reload's
      // login/sessionRestore drain archives them before the fold can see them.
      await seedShared(n, false);
      t0 = Date.now();
      await page.goto("/");
      await awaitSharedList(page, n);
      const drainMs = Date.now() - t0;

      rows.push([n, listMs, mapMs, drainMs]);
      console.log(`  n=${n}  list ${listMs}  map ${mapMs}  drain ${drainMs} ms`);
    }

    writeBenchDat(
      "share-render",
      "n_shared  list_ms  map_ms  drain_ms",
      rows,
      { "share-render sweep (shared-in buildings)": SIZES.join(" ") },
    );
  });
});
