import { expect, type Page, test } from "@playwright/test";
import { en } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import {
  addBuilding,
  buildingIdOf,
  deleteBuildingRow,
  openBuildingsList,
  openBuildingsMap,
} from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Redesign e2e — the shared finder **keyword search** (`SearchField` +
 * `useListSearch`, wired into every top-level finder). One finder (Buildings)
 * proves the cross-cutting contract, since every finder routes through the same
 * seam: typing filters the list, the term is URL-backed (`?q=`) so it survives a
 * reload, a non-matching term shows the "no matches" state, and Clear restores
 * the full list and drops the param. Seeds two buildings whose street addresses
 * carry distinct keywords; self-cleaning.
 *
 *   deno task e2e:local test/e2e/tasks/search-finder.spec.ts
 *
 * Runs against Alice (account A); skipped when account env vars are absent.
 */
const ACC = account("A");
const ALPHA = "Alpha Search Strasse 1";
const BETA = "Beta Search Strasse 2";

test.describe.configure({ mode: "serial" });

test.describe("redesign: finder keyword search", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the search-finder e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "search-finder");
    page.on("dialog", (d) => d.accept().catch(() => {})); // delete-building confirm
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    try {
      if (!page.isClosed()) {
        await page.goto("/");
        await openBuildingsList(page);
        for (const addr of [ALPHA, BETA]) {
          const row = page.locator("li[data-building-id]", { hasText: addr })
            .first();
          if (await row.count()) {
            const id = await buildingIdOf(row);
            if (id) await deleteBuildingRow(page, id);
          }
        }
      }
    } catch {
      // best-effort cleanup; never fail teardown
    } finally {
      await verifyAndReset(page, "search-finder");
      await page.close();
    }
  });

  test("filters the list, is URL-backed across reload, and clears", async () => {
    test.setTimeout(T.testSolo);

    await addBuilding(page, ALPHA);
    await addBuilding(page, BETA);
    await openBuildingsList(page);

    const alphaRow = page.locator("li[data-building-id]", { hasText: ALPHA });
    const betaRow = page.locator("li[data-building-id]", { hasText: BETA });
    await expect(alphaRow).toHaveCount(1, { timeout: T.action });
    await expect(betaRow).toHaveCount(1);

    // Typing a term filters to the matching row and writes `?q=` to the URL.
    const search = page.getByPlaceholder(en("searchPlaceholder"));
    await search.fill("Alpha");
    await expect(alphaRow).toHaveCount(1, { timeout: T.action });
    await expect(betaRow).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]q=Alpha/i, { timeout: T.action });

    // The term is URL-backed, so a genuine reload restores both the field value
    // and the filtered view (the silent-restore must preserve the query string).
    await page.reload();
    await expect(page.getByPlaceholder(en("searchPlaceholder")))
      .toHaveValue("Alpha", { timeout: T.action });
    await expect(alphaRow).toHaveCount(1, { timeout: T.action });
    await expect(betaRow).toHaveCount(0);

    // A non-matching term shows the "no matches" state (no rows).
    await page.getByPlaceholder(en("searchPlaceholder")).fill("zzqqxx");
    await expect(page.getByText(/no matches/i)).toBeVisible({ timeout: T.action });
    await expect(alphaRow).toHaveCount(0);
    await expect(betaRow).toHaveCount(0);

    // Clear (the ✕ button) restores the full list and drops the `?q=` param.
    await page.getByRole("button", { name: en("searchClear") }).click();
    await expect(alphaRow).toHaveCount(1, { timeout: T.action });
    await expect(betaRow).toHaveCount(1);
    await expect(page).not.toHaveURL(/[?&]q=/);
  });

  test("the same search filters the Map markers (one collection-level control)", async () => {
    test.setTimeout(T.testSolo);
    // Alpha + Beta (from the previous test, serial) are both located, so the Map
    // shows two markers. The search box is rendered ONCE in the finder's shared
    // chrome (not per guise), so the SAME control filters the markers.
    await page.goto("/");
    await openBuildingsMap(page);
    const markers = page.locator(".leaflet-marker-icon");
    await expect(markers).toHaveCount(2, { timeout: T.action });

    await page.getByPlaceholder(en("searchPlaceholder")).fill("Alpha");
    await expect(markers).toHaveCount(1, { timeout: T.action });
    await expect(page).toHaveURL(/[?&]q=Alpha/i);

    await page.getByRole("button", { name: en("searchClear") }).click();
    await expect(markers).toHaveCount(2, { timeout: T.action });
  });
});
