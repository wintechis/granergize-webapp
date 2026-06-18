import { en } from "../helpers/i18n.ts";
import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import {
  buildingIdOf,
  buildingRoute,
  openBuildingsList,
} from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Building form + per-year energy entry (the fixes from `docs/heike-3.md`):
 *
 *   - One generic building form: every field offered when adding (here the heating
 *     type) is still editable afterwards — Add and Edit render the same set,
 *     independent of any role.
 *   - The per-year Energy dialog names the building it edits in its header.
 *   - Switching Actual→Planned for a year with no stored planned dataset clears the
 *     prefilled actual figures (no Soll-shows-Ist leak).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/building-form-and-energy.spec.ts
 *
 * Runs against Alice (account A). Skipped when account env vars are absent.
 */

const ACC = account("A");

const ADDR_FIELDS = "Form Fields E2E Strasse 1"; // one-generic-form test
const ADDR_HEADER = "Energy Header E2E Strasse 1"; // dialog-header test
const ADDR_PREFILL = "Energy Prefill E2E Strasse 1"; // prefill-leak test

test.describe.configure({ mode: "serial" });

test.describe("building form + energy entry", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the building-form e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "building-form-and-energy");
    // "Delete building" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    await closeAnyDialog();
    await verifyAndReset(page, "building-form-and-energy");
    await page.close();
  });

  test.afterEach(async () => {
    await closeAnyDialog();
  });

  /** Dismiss any open Modal (Escape; a dirty-guard confirm is auto-accepted). */
  async function closeAnyDialog(): Promise<void> {
    const dialog = page.getByRole("dialog");
    for (let i = 0; i < 3; i++) {
      if (!(await dialog.count())) return;
      await page.keyboard.press("Escape").catch(() => {});
      await expect(dialog).toBeHidden({ timeout: T.quick }).catch(() => {});
    }
  }

  /** Add a building via the single generic manual form (no role/template). */
  async function addBuilding(addr: string): Promise<void> {
    await page.goto("/"); // robust if a prior test ended on a standalone detail route
    await openBuildingsList(page);
    const addBtn = page.getByRole("button", { name: en("addBuildingBtn"), exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await expect(add.getByLabel(/street address/i)).toBeVisible({ timeout: T.visible });
    await add.getByLabel(/street address/i).fill(addr);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: T.action });
  }

  test("(1)(2)(3) a field shown when adding stays editable afterwards", async () => {
    test.setTimeout(T.testSolo);

    await openBuildingsList(page);
    const addBtn = page.getByRole("button", { name: en("addBuildingBtn"), exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await expect(add.getByLabel(/street address/i)).toBeVisible({ timeout: T.visible });

    // (1)(2) The one generic form always offers the full field set, including the
    // Heating systems section — no role/template gating.
    await expect(add.getByText(en("secHeatingSystems")))
      .toBeVisible({ timeout: T.visible });
    await expect(add.getByLabel(/heat pump/i)).toBeVisible();

    // Finish the add WITHOUT setting heating (the "forgotten field" scenario).
    await add.getByLabel(/street address/i).fill(ADDR_FIELDS);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: T.action });

    // (3) Re-open the building: the heating type offered at Add is still reachable
    // on the building page's inline editor (Add and Edit render the same generic
    // field set; editing is inline on /building/:id now, no per-row dialog).
    const row = page.locator("li[data-building-id]", { hasText: ADDR_FIELDS })
      .first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("building-form: missing building id");
    await page.goto(buildingRoute("building", id));
    await page.getByRole("button", { name: /^edit$/i }).first().click();
    await expect(page.getByLabel(/heat pump/i))
      .toBeVisible({ timeout: T.visible });
  });

  test("(4) the energy-year dialog names the building it edits", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(ADDR_HEADER);

    const row = page.locator("li[data-building-id]", { hasText: ADDR_HEADER })
      .first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("building-form: missing building id");
    // The energy-year dialog opens from the building's observation page now.
    await page.goto(buildingRoute("observation", id));
    await page.getByRole("button", { name: "Edit energy years" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.visible });

    // The header carries the building's address so the user knows which building
    // they're entering figures for (the dialog title is "Energy years — <name>").
    await expect(dialog.getByRole("heading", { level: 2 }))
      .toContainText(ADDR_HEADER, { timeout: T.visible });
  });

  test("(5) switching Actual→Planned clears the prefilled actual figures", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(ADDR_PREFILL);

    const row = page.locator("li[data-building-id]", { hasText: ADDR_PREFILL })
      .first();
    await expect(row).toBeVisible({ timeout: T.action });
    const id = await buildingIdOf(row);
    if (!id) throw new Error("building-form: missing building id");
    await page.goto(buildingRoute("observation", id));
    await page.getByRole("button", { name: "Edit energy years" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.visible });

    const year = page.getByRole("spinbutton", { name: en("lblYear"), exact: true });
    const electricity = page.getByRole("spinbutton", { name: "Electricity consumption (kWh)" });
    const scenario = page.getByLabel(en("lblScenario"), { exact: true });

    // Save an ACTUAL figure for the year (the dialog stays open, form resets).
    await year.fill("2099");
    await electricity.fill("88888");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Energy data saved").first())
      .toBeVisible({ timeout: T.action });

    // Re-type the same year: the stored actual dataset prefills the form (sanity).
    await year.fill("2099");
    await expect(electricity).toHaveValue("88888", { timeout: T.visible });

    // Switch to Planned (Soll) — no planned dataset exists for this year, so the
    // figures clear instead of leaking the actual value.
    await scenario.click();
    await page.getByRole("option", { name: /^Planned/ }).click();
    await expect(electricity).toHaveValue("");
  });
});
