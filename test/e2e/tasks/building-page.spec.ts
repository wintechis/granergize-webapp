import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { buildingIds, buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Redesign e2e — the master-detail building page (the read-first `/building/:id`
 * page) and its reachability from the dashboard. Verifies, end-to-end in a real
 * browser, what the central build can't: that the building page renders its sections, that
 * inline master-data edit toggles, that it links to the full observation page,
 * and that the Manage list + Explore pane navigate into it.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/building-page.spec.ts
 *
 * Runs against Alice (account A); self-cleaning.
 */
const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("redesign: building page", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the building-page e2e.`,
  );

  let page: Page;
  let id: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "building-page");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    await ensureDemoBuildings(page);
    const ids = await buildingIds(page);
    id = ids[0] ?? "";
    expect(id, "a demo building exists after seeding").toBeTruthy();
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "building-page");
    await page.close();
  });

  test("the building page renders its read-first sections", async () => {
    await page.goto(buildingRoute("building", id));
    // Owned badge in the header, plus the section headings of the scrolling building page.
    await expect(page.getByText("Owned")).toBeVisible({ timeout: T.action });
    await expect(page.getByRole("heading", { name: "Energy" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sharing" })).toBeVisible();
  });

  test("master data edits inline on the page (no modal)", async () => {
    await page.goto(buildingRoute("building", id));
    await page.getByRole("button", { name: /^edit$/i }).first().click();
    // Inline edit: editable fields appear on the page; Save/Cancel present.
    await expect(page.locator("input, textarea").first()).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByRole("button", { name: /save/i }).first())
      .toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).first().click();
  });

  test("the building page links to the full observation (energy) page", async () => {
    await page.goto(buildingRoute("building", id));
    // The Energy section is minimal here and links to /observation/:id for full charts.
    await page.getByRole("link", { name: /energy|observation|details?/i })
      .first().click();
    await expect(page).toHaveURL(/#\/observation\//, { timeout: T.action });
    await expect(page.getByRole("button", { name: "Edit energy years" }))
      .toBeVisible();
  });

  test("clicking a building name in the Buildings list opens the building page", async () => {
    await page.goto("/#/?tab=buildings");
    // The Buildings tab lands on Map; switch to the List view to get the rows.
    await page.getByRole("button", { name: "List" }).click();
    const row = page.locator(`li[data-building-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: T.action });
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/#\/building\//, { timeout: T.action });
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  });

  test("the list row is a finder — navigate + Delete only (other actions on the page)", async () => {
    // /building/:id is a standalone route (no app-shell tabs) — return to the shell.
    await page.goto("/#/");
    await openBuildingsList(page);
    const row = page.locator(`li[data-building-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: T.action });
    // The one residual per-row action is Delete; per-object actions moved to the page.
    await expect(row.getByRole("button", { name: "Delete building" })).toBeVisible();
    for (
      const gone of ["Share building data", "Manage files", "Add or edit energy year"]
    ) {
      await expect(row.getByRole("button", { name: gone })).toHaveCount(0);
    }
  });

  test("the building page header offers the workbook download", async () => {
    await page.goto(buildingRoute("building", id));
    await expect(
      page.getByRole("button", { name: "Download building data (Excel)" }),
    ).toBeVisible({ timeout: T.action });
  });
});
