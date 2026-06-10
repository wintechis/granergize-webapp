import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { buildingIds, buildingRows, deleteBuildingRow } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Excel-import e2e (PROBLEMS.md #6). MUTATES the Pod: imports building(s) from an
 * XLSX template via Manage → "Add Building" → file picker, and exercises the
 * Cancel control on a long 15-min upload. Like the other smokes it expects a
 * freshly wiped + reseeded Pod. Adding a building no longer depends on a
 * data-room role — the Add dialog's selector is a plain import *template*.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/excel-import.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/excel-import.spec.ts
 *
 * Runs against Alice (account A). Skipped
 * without creds. The happy-path test cleans up the buildings it adds; the cancel
 * test aborts before the building file is written (so no Manage row is created),
 * leaving only orphaned partial energy files — tolerated by the reseed contract.
 */


/** Capture the id token of every owned building row currently on Manage. */
/** Open the Add-building dialog from the Manage tab (manual entry — no picker). */
async function openAddDialog(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  // Wait on the Add Building action itself, not a building row — the Pod may have
  // no buildings yet (so the test doesn't depend on demo seeding).
  const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
    .first();
  await expect(addBtn).toBeVisible({ timeout: T.action });
  await addBtn.click();
}

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("excel upload", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the excel-upload e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "excel-import");
    // The cleanup step deletes each imported building; "Delete building" confirms
    // via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept());
    // Import geocodes each building's address via Nominatim (lat/long are
    // required). e2e must not depend on a rate-limited third-party service — a
    // burst of real lookups intermittently throttles and leaves a building
    // uncoordinated, blocking submit. Stub it with deterministic coordinates so
    // the test exercises OUR import flow, not Nominatim's availability. (The
    // app's own throttle + coarsening fallback are covered by unit tests.)
    await page.route(/nominatim\.openstreetmap\.org/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ lat: "49.45", lon: "11.08" }]),
      }));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "excel-import");
    await page.close();
  });

  test("imports building(s) from an investor XLSX template", async () => {
    // The investor template imports ~a dozen buildings, and cleanup deletes each
    // one (confirm → DELETE → refetch → re-render) sequentially — heavy enough to
    // blow a tight budget on a slow/contended substrate or a real Pod. Give it
    // ample room (the import phases + the multi-delete cleanup below).
    test.setTimeout(T.longOp);

    await openAddDialog(page);
    // The importer auto-detects the spreadsheet layout on upload (no format choice).

    const before = new Set(await buildingIds(page));

    // The file input is hidden (display:none); set it directly rather than
    // driving the OS picker.
    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(
      "test/e2e/fixtures/investor-import.xlsx",
    );
    await expect(page.getByText(/Loaded \d+ building\(s\) from file/))
      .toBeVisible({ timeout: T.action });

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();

    await expect(page.getByText(/buildings? added/).first())
      .toBeVisible({ timeout: T.action });

    // Closing the dialog triggers a refetch of the Manage list (reloadData), so
    // the imported rows appear a moment later — poll the id diff rather than
    // reading it once before the refetch lands.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
    await expect(async () => {
      const added = (await buildingIds(page)).filter((id) => !before.has(id));
      expect(added.length, "imported buildings appear on Manage").toBeGreaterThan(0);
    }).toPass({ timeout: T.poll });

    // Clean up the way a user actually would — quick or not — and return the list to
    // `before`. The import PUTs buildings one at a time, so more rows keep landing
    // after the first appear (and after the "added" toast). Don't snapshot the
    // imported set once and race the still-arriving writes: re-derive "not in before"
    // each pass and delete what's there, until none remain. This still FAILS (times
    // out) if the app leaves residue or keeps spawning rows — it only tolerates the
    // import landing asynchronously, which a user copes with the same way.
    await expect(async () => {
      const extra = (await buildingIds(page)).filter((id) => !before.has(id));
      for (const id of extra) await deleteBuildingRow(page, id);
      // Late arrivals during the deletes above fail this check → toPass re-runs and
      // sweeps the stragglers, until the list is back to the original set.
      expect((await buildingIds(page)).filter((id) => !before.has(id)).length,
        "no imported buildings left to clean up").toBe(0);
    }).toPass({ timeout: T.longOp });
  });

  test("a long 15-min upload can be cancelled", async () => {
    test.setTimeout(T.testSolo);

    await openAddDialog(page);
    // The importer auto-detects the Lastgang layout on upload (no format choice).

    await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(
      "test/e2e/fixtures/lastgang-import.xlsx",
    );
    // The Lastgang parse reports the readings/days it's ready to upload.
    await expect(page.getByText(/readings.*days.*ready to upload/))
      .toBeVisible({ timeout: T.action });

    const dialog = page.getByRole("dialog");
    // The Lastgang file carries only a label + readings (no address), so it can't
    // be geocoded — fill the required location fields manually to enable submit.
    // (Coordinates are irrelevant to what this test checks: the cancel path.)
    await dialog.getByLabel(/street address/i).fill("Cancel E2E Strasse 1");
    await dialog.getByLabel(/locality/i).fill("Nürnberg");
    await dialog.getByLabel(/postal code/i).fill("90451");
    await dialog.getByLabel(/region/i).fill("Bayern");
    await dialog.getByLabel(/latitude/i).fill("49.45");
    await dialog.getByLabel(/longitude/i).fill("11.08");
    // Hold each daily energy-file PUT briefly so the upload stays observably
    // in-flight. A month of readings is 32 day-files, but on a fast local server
    // (JSS especially, ~7ms/req) the whole batch can finish in tens of
    // milliseconds — unmounting the busy overlay, and its Cancel control, before
    // the click lands (the cause of the original detached-element flake). The
    // delay only widens the cancel window; it changes nothing about the abort
    // path being asserted, and is independent of the real-Pod latency that makes
    // this a genuinely long upload in production (Tier 4).
    await page.route(/\/energy\/[^/]*PT15M\/\d{4}-\d{2}-\d{2}\.ttl$/, async (route) => {
      if (route.request().method() !== "PUT") return await route.continue();
      await new Promise((r) => setTimeout(r, 300));
      // Cancel aborts in-flight requests, so a parked one may already be gone by
      // the time we resume it — tolerate that.
      await route.continue().catch(() => {});
    });

    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();

    // The busy overlay surfaces the live requests and a Cancel control once the
    // per-day energy writes start (a month of readings → 32 day-files). Cancel
    // and assert the abort path.
    const cancel = page.getByRole("button", { name: "Cancel upload" });
    await expect(cancel).toBeVisible({ timeout: T.action });
    await cancel.click();

    await expect(page.getByText(/Import cancelled/).first())
      .toBeVisible({ timeout: T.action });
  });
});
