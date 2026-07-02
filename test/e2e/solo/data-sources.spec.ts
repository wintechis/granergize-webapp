import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { menuAction } from "../helpers/accountMenu.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * "Data sources & licences" credits page e2e. The page is the legally-robust
 * blanket attribution: reachable from the Account menu in BOTH modes (not
 * dev-gated), listing every external source with a link to its homepage and its
 * licence. It is pure registry (no Pod / wrapper calls), so this just logs in,
 * opens the page from the menu, and asserts a few representative sources +
 * licences render. Read-only; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/data-sources.spec.ts
 */

const ACC = account("A");

test.describe("data sources & licences (attribution)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the data-sources e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "data-sources");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("the Account menu opens the credits page listing sources + licences", async () => {
    test.setTimeout(T.testSolo);

    // Reachable from the Account menu (present in both modes — legal attribution
    // is user content, not a Developer-mode affordance).
    await menuAction(page, t("menuDataSources"));
    await expect(page).toHaveURL(/\/data-sources/);
    await expect(page.getByRole("heading", { name: t("menuDataSources") }))
      .toBeVisible({ timeout: T.action });

    // Representative sources link out to their homepages…
    await expect(page.getByRole("link", { name: "OpenStreetMap (via linked-osm)" }))
      .toBeVisible();
    await expect(page.getByRole("link", { name: /Marktstammdatenregister/ }))
      .toBeVisible();
    await expect(page.getByRole("link", { name: "Wikimedia Commons" }))
      .toBeVisible();

    // …each with its licence link (ODbL for OSM; dl-de/by for the gov data).
    await expect(page.getByRole("link", { name: "ODbL" })).toBeVisible();
    await expect(page.getByRole("link", { name: "dl-de/by-2.0" }).first())
      .toBeVisible();
  });
});
