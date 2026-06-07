import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { verifyAndReset } from "../helpers/cleanSlate.ts";

/**
 * Energy-view smoke test (single account, a THROWAWAY Solid Pod). Proves the
 * unified `gran:EnergyDataset` model renders end-to-end in a real browser: a
 * building's energy detail (annual table + bar chart) is fetched from the
 * separate dataset resources and drawn. It self-seeds an empty Pod in beforeAll
 * (ensureDemoBuildings) — the demo carries one annual (investor) and one 15-min
 * series (user) building; this test renders the annual one (auto-loaded; the
 * series chart is lazy-loaded on click) — and so doesn't assume a pre-seeded Pod.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/view-data.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/view-data.spec.ts
 *
 * Runs against Alice (account A).
 * Skipped automatically when the account env vars are absent.
 */


const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("energy view smoke", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the energy smoke.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "view-data");
    await login(page, ACC);
    // Self-seed an empty Pod so the test doesn't assume a pre-seeded one (the
    // demo carries the annual + 15-min series buildings this test renders).
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "view-data");
    await page.close();
  });

  test("a building's Energy view renders from gran:EnergyDataset", async () => {
    test.setTimeout(180_000);

    // Target the annual demo building ("Nordostpark 84") specifically — it always
    // carries an annual aggregate, so its energy view renders the table + chart.
    // (`.first()` could land on a residual/empty building → "No energy data
    // available"; the annual one is the same building-details.spec.ts benchmarks.)
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", { hasText: "Nordostpark" }).first();
    await expect(row).toBeVisible({ timeout: 120_000 });
    const id = (await row.textContent())?.match(/Building (\S+)/)?.[1];
    expect(id, "the annual demo building's id on Manage").toBeTruthy();

    // The /energy/:id deep link renders the building's energy detail — proving
    // loadEnergy + the chart run on the new model (annual aggregate fetched from
    // its own `<year>-P1Y.ttl`, or the series listed from its `<year>-PT15M/`).
    await page.goto(`/#/energy/${id}`);
    await expect(
      page.getByRole("heading", {
        name: /Energy Need for Building|Electricity Consumption for Building/,
      }),
    ).toBeVisible({ timeout: 90_000 });

    // …and a chart is actually drawn. The charts are Recharts (SVG, not canvas),
    // so we can assert real chart DOM: the SVG surface plus at least one drawn
    // bar/line shape inside it.
    const surface = page.locator("svg.recharts-surface").first();
    await expect(surface).toBeVisible({ timeout: 90_000 });
    await expect(
      surface.locator(".recharts-bar-rectangle, .recharts-line").first(),
    ).toBeVisible({ timeout: 90_000 });
  });

  // Storage-redesign smokes (dissolved from the old storage-smoke spec): the
  // container-native Manage/Share panels render. Reuse the seeded, logged-in page.
  test("Manage lists own buildings + the Aggregated views section renders", async () => {
    // The previous test ended on the standalone /energy/:id route (no app shell, so
    // no tabs) — return to the shell before reaching for a tab.
    await page.goto("/#/");
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/^Building /).first())
      .toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("heading", { name: "Aggregated views" }))
      .toBeVisible({ timeout: 45_000 });
  });

  test("the Share tab renders (folds the shared-in/ log)", async () => {
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(page.getByRole("heading", { name: "Buildings shared with you" }))
      .toBeVisible({ timeout: 45_000 });
  });
});
