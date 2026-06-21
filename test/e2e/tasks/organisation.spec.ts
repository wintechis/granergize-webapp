import { expect, type Locator, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { openBuildingsList, openBuildingsMap } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Organisation/profile e2e: uploading a company logo, and that a building produced
 * by an agent whose profile carries an org logo shows that logo in its map
 * marker's hover card (BuildingMarker → resolveAgentOrg; the marker itself is a
 * plain owned/shared pin). The org logo is keyed on the producing
 * agent (`prov:agent` / `attributedTo`), which survives the role removal.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/organisation.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/organisation.spec.ts
 *
 * MUTATES the Pod but reverses itself (adds+deletes its buildings). The uploaded
 * company logo persists (no remove-logo UI). Runs against Alice (account A).
 */

const LOGO_ADDR = "Logo Marker E2E Strasse 2"; // building used for the logo-marker check

/** Open the avatar-menu Organisation dialog. */
async function openOrgDialog(page: Page): Promise<Locator> {
  // Bounded clicks: Playwright's default action timeout is 0 (wait forever), so a
  // stuck click here would consume a whole hook budget uncatchably. 15 s is ample.
  await page.getByRole("button", { name: t("menuAccountAria") }).click({
    timeout: T.visible,
  });
  await page.getByRole("menuitem", { name: t("menuOrganisation") })
    .click({ timeout: T.visible });
  const org = page.getByRole("dialog");
  await expect(org).toBeVisible({ timeout: T.action });
  await page.waitForLoadState("networkidle").catch(() => {}); // fields load async
  return org;
}

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("organisation logo", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the organisation e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "organisation");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    await verifyAndReset(page, "organisation");
    await page.close();
  });

  // Upload a company logo in the Organisation dialog. Throwaway Pod: the logo
  // persists (no remove-logo UI to reverse it), which is fine.
  test("upload a company logo in the Organisation dialog", async () => {
    test.setTimeout(T.testSolo);
    // A minimal 1×1 PNG, inline — no fixture file needed.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const org = await openOrgDialog(page);
    await org.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: png,
    });
    // The avatar preview picks up the chosen image (the Avatar's <img alt>).
    await expect(org.getByAltText(t("orgLogoAlt")))
      .toBeVisible({ timeout: T.visible });
    await org.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("organisationSaved")))
      .toBeVisible({ timeout: T.action });

    // Reopen → the logo persisted (the dialog's avatar still shows an image).
    const reopened = await openOrgDialog(page);
    await expect(reopened.getByAltText(t("orgLogoAlt")))
      .toBeVisible({ timeout: T.action });
    await reopened.getByRole("button", { name: t("btnCancel"), exact: true }).click();
  });

  // heike-2 / Andreas: the top-right avatar is the USER's identity and must never
  // show the company logo. Runs right after the logo upload, so Alice's profile
  // now carries an org logo — yet the header avatar still falls back to the person
  // icon (this throwaway Pod's profile has no foaf:img), proving the org logo did
  // not leak into the header. (The logo's only home is the building marker, next.)
  test("the header avatar shows the person, never the company logo", async () => {
    test.setTimeout(T.testSolo);
    const accountBtn = page.getByRole("button", { name: t("menuAccountAria") });
    await expect(accountBtn).toBeVisible({ timeout: T.action });
    // The avatar renders an <img> only when it has an image source. The header is
    // the person's identity, and this throwaway Pod's profile carries no foaf:img,
    // so the Avatar falls back to its PersonIcon child — NO <img>. A leaked company
    // logo would render one, so asserting zero images is the regression guard.
    await expect(accountBtn.locator("img")).toHaveCount(0);
  });

  // A building produced by an agent whose profile carries an org logo shows that
  // logo in its marker's HOVER CARD (BuildingMarker → resolveAgentOrg → the
  // tooltip's <img alt="Building producer logo">; the marker itself is a plain
  // pin). Runs after the logo-upload test, so Alice's profile has a logo; her
  // own building's `attributedTo` is herself, so the lookup resolves over the
  // authed session (no public-ACL dependency).
  test("a building's company logo shows in its marker's hover card", async () => {
    test.setTimeout(T.testSolo);

    // Add an owned building via the single generic form (no role/template).
    await openBuildingsList(page);
    const addBtn = page.getByRole("button", {
      name: t("addBuildingBtn"),
      exact: true,
    })
      .first();
    await expect(addBtn).toBeVisible({ timeout: T.action });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await expect(add.getByLabel(t("lblStreetAddress"))).toBeVisible({
      timeout: T.visible,
    });
    await add.getByLabel(t("lblStreetAddress")).fill(LOGO_ADDR);
    await add.getByLabel(t("lblLocality")).fill("Nürnberg");
    await add.getByLabel(t("lblPostalCode")).fill("90451");
    await add.getByLabel(t("lblRegion")).fill("Bayern");
    await add.getByLabel(t("lblLatitude")).fill("49.46");
    await add.getByLabel(t("lblLongitude")).fill("11.09");
    await add.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(page.getByText(t("addBuildingAddedCount", { count: 1 })))
      .toBeVisible({ timeout: T.action });

    // Confirm it persisted (a row on Manage), then reload so the Explore map loads
    // fresh from the Pod — a tab switch alone can keep the map's prior empty state.
    await expect(page.locator("li", { hasText: LOGO_ADDR }).first())
      .toBeVisible({ timeout: T.action });
    await page.reload();
    await expect(page.getByRole("tab", { name: t("navBuildings") }))
      .toBeVisible({ timeout: T.action });

    // On the map (Buildings tab → Map view), hovering the building's pin opens the
    // hover card, which renders the producer's org logo image. (Several owned
    // buildings would all show Alice's logo, so hover the first owned pin.)
    // Scoped Map open — the cube's "Explore view" selector also carries a "Map"
    // button, so an unscoped getByRole matches two (see plans/stumble.md).
    await openBuildingsMap(page);
    const ownedPin = page.locator(".leaflet-marker-icon.pin-owned").first();
    await expect(ownedPin).toBeVisible({ timeout: T.action });
    await ownedPin.hover();
    await expect(page.getByAltText(t("markerProducerLogoAlt")).first())
      .toBeVisible({ timeout: T.action });

    // Clean up the building.
    await openBuildingsList(page);
    const row = page.locator("li", { hasText: LOGO_ADDR }).first();
    await expect(row).toBeVisible({ timeout: T.action });
    await row.getByRole("button", { name: t("buildingDeleteAria") }).click();
    await confirmDialog(page, "Delete");
    await expect(page.getByText(t("buildingDeleted")).first())
      .toBeVisible({ timeout: T.action });
  });
});
