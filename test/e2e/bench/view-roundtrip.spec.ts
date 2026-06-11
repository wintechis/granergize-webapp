import { expect, type Page, test } from "@playwright/test";
import { account, login } from "../helpers/login.ts";
import { receivedViews } from "../helpers/manage.ts";
import { freshPage } from "../helpers/twoPod.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { sweepSizes, writeBenchDat } from "./benchSpec.ts";

/**
 * Tier-3 scalability BENCHMARK (`deno task bench:ui`): the TRIO
 * benchmark-roundtrip scenario — B and C each contribute N buildings (with an
 * annual energy dataset, energy included in the share) to A via a pair room
 * each (`POST /seed-contrib`, A's inbox pre-drained), and the browser times the
 * roundtrip A drives in the UI:
 *
 *   create_ms    — A: CreateViewDialog confirm ("Compare shared buildings" over
 *                  all 2N contributed buildings) → "view created successfully"
 *                  (compute + persist the snapshot). The roster selection
 *                  clicks happen BEFORE the timer — they're Playwright cost,
 *                  not app cost.
 *   share_ms     — A: ShareViewDialog "Add all contributors" (resolves B + C
 *                  from the snapshot) → review → confirm → success toast.
 *   recipient_ms — B: fresh login (drains the view grant), then Share tab →
 *                  the received view's row is visible (fold + snapshot load).
 *
 * The UI ("in practice") side of the BSP roundtrip that peer-benchmark.spec.ts
 * proves functionally — here swept for scale. Measure-and-report into
 * `test-results/bench/<run-id>/view-roundtrip.dat`; no time-based assertions.
 * Local tier only; runs as the `bench` Playwright project, gated by E2E_BENCH.
 */
const LOCAL = !!process.env.E2E_LOCAL;
const CONTROL = `http://localhost:${LOCAL_CSS_CONTROL_PORT}`;
const VIEW = "Bench Roundtrip";

const A = account("A");
const B = account("B");

/**
 * Cold-load the app, tolerating a failed silent session restore: JSS's IdP
 * occasionally rejects the restore's token exchange (`invalid_grant` on a
 * replayed authorization code) and the app lands on the Login screen — re-login
 * and continue. Untimed: every timed phase starts after this returns.
 */
async function gotoLoggedIn(page: Page): Promise<void> {
  await page.goto("/");
  try {
    await expect(page.getByRole("tab", { name: "Manage" }))
      .toBeVisible({ timeout: 15_000 });
  } catch {
    await login(page, A);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("view-roundtrip benchmark", () => {
  test.skip(!LOCAL, "Tier-3 render bench runs only on the local pod server (deno task bench:ui).");

  let page: Page; // A's page, logged in once on the warm server

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, A);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("benchmark-view roundtrip across contribution sizes", async ({ browser }) => {
    const SIZES = sweepSizes("BENCH_CONTRIB_SIZES", [5, 10, 20, 30, 40, 50]);
    // Per size: seeding (2N buildings + energy + 2N serial shares), three timed
    // phases, and one fresh recipient login.
    test.setTimeout(60_000 + SIZES.length * 300_000);
    const rows: number[][] = [];

    for (const n of SIZES) {
      const res = await fetch(`${CONTROL}/seed-contrib?n=${n}`, { method: "POST" });
      expect(res.ok, `seed-contrib n=${n} (HTTP ${res.status})`).toBeTruthy();

      // ── A: build the benchmark view over the 2N contributed buildings ──
      await gotoLoggedIn(page); // cold load; seed wiped A's app data (views included)
      await page.getByRole("tab", { name: "Manage" }).click();
      await page.getByRole("button", { name: /create view/i }).click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible({ timeout: 30_000 });

      // The "Compare shared buildings" type appears once the dialog has folded
      // the shared-with-me roster (async); re-open the select until offered.
      const modeSel = dlg.getByLabel("View type");
      await expect(async () => {
        await modeSel.click();
        const opt = page.getByRole("option", { name: /compare shared buildings/i });
        try {
          await expect(opt).toBeVisible({ timeout: 2_000 });
          await opt.click();
        } catch (e) {
          await page.keyboard.press("Escape").catch(() => {});
          throw e;
        }
      }).toPass({ timeout: 120_000 });

      await dlg.getByLabel("View Name").fill(VIEW);

      // Select ALL 2N contributed buildings. Untimed: per-option clicks are
      // Playwright interaction cost, not the app's compute path.
      await dlg.getByLabel("Select Buildings").click();
      const options = page.getByRole("option");
      await expect(options).toHaveCount(2 * n, { timeout: 120_000 });
      for (let i = 0; i < 2 * n; i++) await options.nth(i).click();
      await page.keyboard.press("Escape");

      let t0 = Date.now();
      await dlg.getByRole("button", { name: /create view/i }).click();
      await expect(page.getByText(/view created successfully/i))
        .toBeVisible({ timeout: 120_000 });
      const createMs = Date.now() - t0;

      // ── A: share the snapshot back to its contributors (B + C) ──
      const viewRow = page.locator("li").filter({ hasText: VIEW }).first();
      await viewRow.getByRole("button", { name: "Share view" }).click();
      const shareDlg = page.getByRole("dialog");
      const addAll = shareDlg.getByRole("button", { name: /add all .* contributors/i });
      await expect(addAll).toBeVisible({ timeout: 30_000 });
      await addAll.click();
      t0 = Date.now();
      const confirm = shareDlg.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      await confirm.click();
      await expect(shareDlg.getByText(/shared successfully/i))
        .toBeVisible({ timeout: 120_000 });
      const shareMs = Date.now() - t0;
      await shareDlg.getByRole("button", { name: /close/i }).click();

      // ── B: fresh login (drains the view grant), see the received view ──
      const b = await freshPage(browser, B);
      try {
        const t1 = Date.now();
        await b.page.getByRole("tab", { name: "Share" }).click();
        await expect(receivedViews(b.page).getByText(VIEW))
          .toBeVisible({ timeout: 120_000 });
        rows.push([n, createMs, shareMs, Date.now() - t1]);
      } finally {
        await b.ctx.close();
      }
      const last = rows[rows.length - 1];
      console.log(
        `  n=${n} (×2 contributors)  create ${last[1]}  share ${last[2]}  recipient ${last[3]} ms`,
      );
    }

    writeBenchDat(
      "view-roundtrip",
      "n_per_contributor  create_ms  share_ms  recipient_ms",
      rows,
      { "view-roundtrip sweep (buildings per contributor)": SIZES.join(" ") },
    );
  });
});
