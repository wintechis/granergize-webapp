import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { t } from "../helpers/i18n.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Building-details e2e (single account, a throwaway solo Pod). Covers two user
 * tasks on a building's detail views:
 *   1. Viewing a building shows its linked operator as a resolvable WebID link —
 *      the detail panel renders IRIs as clickable links that open the WebID
 *      itself (the education-mandate "IRIs are dereferenceable" behaviour).
 *   2. The energy view benchmarks a building's consumption — the single annual
 *      table shows the building's own per-year figures plus a "Portfolio
 *      average" comparison row (the mean over the user's own buildings; a
 *      separate "Benchmark" row carries any received service-provider benchmark).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/building-details.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/building-details.spec.ts
 *
 * Runs against Alice (account A). Self-cleaning: deletes the
 * building it adds. Skipped automatically when account env vars are absent.
 */

const OP_STREET = "Building Details E2E Strasse 1"; // unique throwaway address
const OP_WEBID = "https://e2e.example.org/profile/card#me"; // a WebID (with #fragment)
const OP_HASH = "me"; // the detail link shows the IRI's #fragment as its text

const ACC = account("A"); // Alice -- solo specs use one account

/** Escape a string for safe interpolation into a RegExp (the encoded WebID
 * carries `.`/`%` etc.). */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe.configure({ mode: "serial" });

test.describe("building details", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the building-details e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "building-details");
    page.on("dialog", (d) => d.accept().catch(() => {})); // "Delete building" confirm
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page); // Nordostpark annual, for the energy-benchmark task
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "building-details");
    await page.close();
  });

  test("a building's operator shows as a link to its WebID", async () => {
    test.setTimeout(T.testSolo);

    // --- add a building whose operator is a WebID (User template) ---
    await openBuildingsList(page);
    const addBtn = page.getByRole("button", { name: t("addBuildingBtn"), exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel(t("lblStreetAddress")).fill(OP_STREET);
    await add.getByLabel(t("lblLocality")).fill("Nürnberg");
    await add.getByLabel(t("lblPostalCode")).fill("90451");
    await add.getByLabel(t("lblRegion")).fill("Bayern");
    await add.getByLabel(t("lblLatitude")).fill("49.45");
    await add.getByLabel(t("lblLongitude")).fill("11.08");
    await add.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(page.getByText(t("addBuildingAddedCount", { count: 1 }))).toBeVisible({
      timeout: T.action,
    });

    // --- resolve its id from the Manage row's data attribute ---
    const row = page.locator("li", { hasText: OP_STREET }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await row.getAttribute("data-building-id");
    expect(id, "the new building's id on Manage").toBeTruthy();

    // --- view the building: the operator renders as a link to its in-app agent
    // detail view (/agent?uri=<webid>), labelled by the agent's name — the WebID's
    // #fragment until a profile name resolves (AgentLabel → RefLink) ---
    await page.goto(buildingRoute("building", id));
    // The operator is master data now (not a create-form basic) — set it INLINE via the
    // master-data editor (the create modal minted only address + coordinates).
    await page.getByRole("heading", { name: t("secMasterData"), exact: true })
      .locator("xpath=..")
      .getByRole("button")
      .click();
    await page.getByLabel(t("lblOperatedBy")).fill(OP_WEBID);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("buildingUpdated")))
      .toBeVisible({ timeout: T.action });

    const opLink = page.locator(`a[href$="${encodeURIComponent(OP_WEBID)}"]`);
    await expect(opLink).toBeVisible({ timeout: T.action });
    await expect(opLink).toHaveText(OP_HASH); // shows the agent name (the IRI's #fragment)
    // The agent route stays inside the app (real-path BrowserRouter route, under
    // the app base), not an external WebID link — assert by suffix so a non-root
    // deploy base doesn't break it.
    await expect(opLink).toHaveAttribute(
      "href",
      new RegExp(`/agent\\?uri=${escapeRegExp(encodeURIComponent(OP_WEBID))}$`),
    );

    // --- self-clean: delete the throwaway building ---
    await page.goto("/");
    await openBuildingsList(page);
    const back = page.locator("li", { hasText: OP_STREET }).first();
    await expect(back).toBeVisible({ timeout: T.action });
    await back.getByRole("button", { name: t("buildingDeleteAria") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText(t("buildingDeleted")).first()).toBeVisible({
      timeout: T.action,
    });

    // NOTE: customer/investor render through the same link path but have no UI
    // input; cover them by importing a generic CSV that carries those columns
    // (parseCsvToFields in buildingSerializer.ts) and repeating the assertion.
  });

  test("the energy view benchmarks consumption against the portfolio average", async () => {
    test.setTimeout(T.testSolo);

    // The demo investor building ("Nordostpark 84") carries an annual aggregate, so
    // its energy view renders the single annual table (with the comparison rows)
    // rather than the 15-min series chart.
    await openBuildingsList(page);
    const annual = page.locator("li", { hasText: "Nordostpark" }).first();
    await expect(annual).toBeVisible({ timeout: T.action });
    const id = await annual.getAttribute("data-building-id");
    expect(id, "the annual demo building's id").toBeTruthy();

    await page.goto(buildingRoute("observation", id));
    // (The observation page titles by the building name now — the shared
    // detail-page header — not the old "Energy Need for …" card title; the
    // comparison-column assertion below is the load gate.)

    // The single annual table carries per-metric columns (e.g. "Electricity
    // (kWh)") with one row per year, plus a "Portfolio average" comparison row
    // (the mean over the user's own buildings).
    await expect(
      page.locator("th", { hasText: t("metricShortElectricity") + " (kWh)" }).first(),
    ).toBeVisible({ timeout: T.action });
    await expect(
      page.getByRole("row").filter({ hasText: t("aePortfolioAvg") }).first(),
    ).toBeVisible({ timeout: T.action });
    // …and the table has at least one per-year data row.
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: T.action,
    });
  });
});
