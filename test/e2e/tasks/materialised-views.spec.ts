import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { addBuilding, addEnergyYear } from "../helpers/manage.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Energy-view smoke test (single account, a THROWAWAY Solid Pod). Proves the
 * unified `cons:EnergyDataset` model renders end-to-end in a real browser: a
 * building's energy detail (annual table + bar chart) is fetched from the
 * separate dataset resources and drawn. It self-seeds an empty Pod in beforeAll
 * (ensureDemoBuildings with the `investor` kind) — the kind-specific demo seeds the
 * annual "Nordostpark" building this test renders (auto-loaded) — and so doesn't
 * assume a pre-seeded Pod.
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
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "view-data");
    await login(page, ACC);
    await assertCleanStart(page);
    // Self-seed an empty Pod so the test doesn't assume a pre-seeded one (the
    // investor demo is the annual "Nordostpark" building this test renders).
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "view-data");
    await page.close();
  });

  test("a building's Energy view renders from cons:EnergyDataset", async () => {
    test.setTimeout(T.testSolo);

    // Target the annual demo building ("Nordostpark 84") specifically — it always
    // carries an annual aggregate, so its energy view renders the table + chart.
    // (`.first()` could land on a residual/empty building → "No energy data
    // available"; the annual one is the same building-details.spec.ts benchmarks.)
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", { hasText: "Nordostpark" }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await row.getAttribute("data-building-id");
    expect(id, "the annual demo building's id on Manage").toBeTruthy();

    // The /energy/:id deep link renders the building's energy detail — proving
    // loadEnergy + the chart run on the new model (annual aggregate fetched from
    // its own `<year>-P1Y.ttl`, or the series listed from its `<year>-PT15M/`).
    await page.goto(`/#/energy/${id}`);
    await expect(
      page.getByRole("heading", {
        name: /Energy Need for |Electricity Consumption for /,
      }),
    ).toBeVisible({ timeout: T.action });

    // …and a chart is actually drawn. The charts are Recharts (SVG, not canvas),
    // so we can assert real chart DOM: the SVG surface plus at least one drawn
    // bar/line shape inside it.
    const surface = page.locator("svg.recharts-surface").first();
    await expect(surface).toBeVisible({ timeout: T.action });
    await expect(
      surface.locator(".recharts-bar-rectangle, .recharts-line").first(),
    ).toBeVisible({ timeout: T.action });
  });

  // Storage-redesign smokes (dissolved from the old storage-smoke spec): the
  // container-native Manage/Share panels render. Reuse the seeded, logged-in page.
  test("Manage lists own buildings + the Aggregated views section renders", async () => {
    // The previous test ended on the standalone /energy/:id route (no app shell, so
    // no tabs) — return to the shell before reaching for a tab.
    await page.goto("/#/");
    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: T.action });
    await expect(page.locator("li[data-building-id]").first())
      .toBeVisible({ timeout: T.action });
    await expect(page.getByRole("heading", { name: "Aggregated views" }))
      .toBeVisible({ timeout: T.action });
  });

  test("the Share tab renders (folds the shared-in/ log)", async () => {
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(page.getByRole("heading", { name: "Buildings shared with you" }))
      .toBeVisible({ timeout: T.action });
  });

  // Heike-4 (operator benchmark): a building is benchmarked against the mean
  // consumption of all buildings of the SAME operator (operatedBy) — the
  // "Betreiber-Durchschnitt". Crucially the benchmark keys on operatedBy, NOT on
  // matching area/construction year. Mirror Heike's two-building case: two own
  // buildings sharing ONE operator WebID, 1000 and 3000 kWh → the operator average
  // is their mean (2000), shown in each building's Energy tab.
  test("the energy view shows the operator-average (Betreiber) benchmark", async () => {
    test.setTimeout(T.testSolo);
    const OP = "https://operator.example/profile/card#me";
    const A = "Betreiber Strasse 1";
    const B = "Betreiber Strasse 2";

    await page.goto("/#/");
    await addBuilding(page, A, { operatedBy: OP });
    await addEnergyYear(page, A, "2022", "1000");
    await addBuilding(page, B, { operatedBy: OP });
    await addEnergyYear(page, B, "2022", "3000");

    // Walk the surface Heike actually uses: the Explore detail pane's
    // "Energy data" tab → AnnualEnergy (annual data dispatches there, never
    // to the standalone /energy route). Earlier tests in this spec seeded demo
    // buildings, so a blind marker click could land on any of them — select
    // building A deterministically via the URI-state deep link instead
    // (?b=<id>&dt=energy, the same selection a marker click produces). The
    // operator mean (2000 → "2.000") differs from A's own 1000, proving it
    // aggregates across the operator's buildings.
    await page.getByRole("tab", { name: "Manage" }).click();
    const rowA = page.locator("li", { hasText: A }).first();
    await expect(rowA).toBeVisible({ timeout: T.action });
    const id = await rowA.getAttribute("data-building-id");
    expect(id, "building A's id").toBeTruthy();
    await page.goto(`/#/?tab=explore&b=${id}&dt=energy`);
    const avgRow = page.getByRole("row")
      .filter({ hasText: "Operator average" }).first();
    await expect(avgRow).toBeVisible({ timeout: T.action });
    // Columns derive from the data present (schema order, electricity first);
    // this seed carries electricity only → [label, Electricity] → electricity = 1.
    await expect(avgRow.getByRole("cell").nth(1)).toHaveText("2.000");

    // The standalone /energy/:id view (latest annual year) carries the same
    // benchmark as its "Operator average" column.
    await page.goto(`/#/energy/${id}`);
    await expect(
      page.getByRole("heading", { name: /Energy Need for / }),
    ).toBeVisible({ timeout: T.action });
    await expect(
      page.locator("th", { hasText: "Operator average kWh / a" }).first(),
    ).toBeVisible({ timeout: T.action });
    // Shows the OPERATOR MEAN (2000 → "2.000,00"), not A's own 1000. The row's
    // first column is a <th scope="row">, so the four <td> cells are
    // [own kWh/a, Portfolio avg, Operator avg, Benchmark] → operator = index 2.
    const elecRow = page.getByRole("row").filter({ hasText: "Electricity" })
      .first();
    await expect(elecRow.getByRole("cell").nth(2)).toHaveText("2.000,00");
  });

  // Heike-4 (aggregated views), end-to-end repro of exactly what she did: enter an
  // electricity figure for a building via the form, then create an annual view that
  // selects ONLY electricity over that building, and open the summary. Heike saw an
  // EMPTY diagram; this asserts the summary actually plots her entered data — i.e.
  // the metric she ticked resolved to the figure she entered.
  test("a view selecting electricity over a building with entered data is not empty", async () => {
    test.setTimeout(T.testSolo);
    const ADDR = "Heike View Repro Strasse 1";
    const VIEW = "Heike Electricity View";

    // 1) Enter electricity data for a fresh building, the way Heike did.
    await page.goto("/#/");
    await addBuilding(page, ADDR);
    await addEnergyYear(page, ADDR, "2022", "12345"); // Actual electricity, kWh

    // 2) Create an annual view selecting ONLY electricity over THAT building.
    await page.getByRole("button", { name: /create view/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.visible });
    await dialog.getByLabel("View Name").fill(VIEW);
    await dialog.getByLabel("Select Buildings").click();
    await page.getByRole("option").filter({ hasText: ADDR }).first().click();
    await page.keyboard.press("Escape");
    // Default-checked are electricity+heat+water; narrow to just electricity to
    // mirror "ich electricity auswähle" and isolate her metric. The checkboxes
    // carry the human labels from the shared annual-metric schema (with units),
    // not raw camelCase keys; exact: true keeps "Water (m³)" from also matching
    // "Wastewater (m³)".
    await dialog.getByRole("checkbox", { name: "Heat (kWh)", exact: true })
      .uncheck();
    await dialog.getByRole("checkbox", { name: "Water (m³)", exact: true })
      .uncheck();
    await dialog.getByRole("checkbox", { name: "Electricity (kWh)", exact: true })
      .check();
    await dialog.getByRole("button", { name: /create view/i }).click();
    // Assert the durable outcome — the view row appears (step 3) — NOT the
    // transient "view created successfully" toast. The single FIFO snackbar may
    // be mid-showing an earlier notice (here the first-time "Set up the views
    // folder" provisioning info), which delays/buries the success toast even
    // though the view itself was created.

    // 3) Open the view (the "View details" action). The summary auto-computes its
    // snapshot on first open, so the chart must plot a bar straight away — WITHOUT
    // a manual "Refresh Snapshot" (the empty diagram Heike saw). A drawn
    // .recharts-bar-rectangle proves the ticked metric resolved to her entered
    // figure end-to-end.
    const viewRow = page.locator("li").filter({ hasText: VIEW }).first();
    await expect(viewRow).toBeVisible({ timeout: T.action });
    await viewRow.getByRole("button", { name: "View details" }).click();
    const surface = page.locator("svg.recharts-surface").first();
    await expect(surface).toBeVisible({ timeout: T.action });
    await expect(surface.locator(".recharts-bar-rectangle").first())
      .toBeVisible({ timeout: T.action });
  });
});
