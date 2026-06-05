import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";
import { ensureDemoBuildings } from "./helpers/seed.ts";

/**
 * Energy-view smoke test (single account, a THROWAWAY Solid Pod). Proves the
 * unified `gran:EnergyDataset` model renders end-to-end in a real browser: a
 * building's energy detail (annual table + bar chart, or the 15-min series
 * chart) is fetched from the separate dataset resources and drawn. It self-seeds
 * an empty Pod in beforeAll (ensureDemoBuildings) — the demo carries one annual
 * (investor) and one 15-min series (user) building, so whichever id we pick
 * exercises the new loader + chart — and so doesn't assume a pre-seeded Pod.
 *
 *   source .env.e2e.local && deno task e2e e2e/energy-smoke.spec.ts
 *
 * Defaults to account B (solidweb.org); override with E2E_SMOKE_ACCOUNT=A.
 * Skipped automatically when the account env vars are absent.
 */

const WHICH = (process.env.E2E_SMOKE_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);

test.describe.configure({ mode: "serial" });

test.describe("energy view smoke", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the energy smoke.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    await login(page, ACC);
    // Self-seed an empty Pod so the test doesn't assume a pre-seeded one (the
    // demo carries the annual + 15-min series buildings this test renders).
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("a building's Energy view renders from gran:EnergyDataset", async () => {
    test.setTimeout(180_000);

    // Find a seeded building's numeric id on Manage ("Building <id> — …").
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.getByText(/^Building \d+/).first();
    await expect(row).toBeVisible({ timeout: 120_000 });
    const id = (await row.textContent())?.match(/Building (\d+)/)?.[1];
    expect(id, "a seeded building id on Manage").toBeTruthy();

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
});
