import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { buildingIds, buildingRows } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Excel-export e2e (PROBLEMS.md #8). Proves a workbook actually downloads in the
 * browser and re-imports to the same buildings (a full round-trip through the
 * UI — field-level fidelity is also unit-tested in buildingSerializer.test.ts).
 * The round-trip test MUTATES the Pod (re-imports the exported buildings, then
 * deletes the copies) and cleans up after itself. It self-seeds an empty Pod in
 * beforeAll (ensureDemoBuildings), so it doesn't assume a pre-seeded Pod.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/excel-export.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/excel-export.spec.ts
 *
 * Runs against Alice (account A). Skipped
 * without creds.
 */


async function openManage(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
}

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("excel export", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the excel-export e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "excel-export");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    // Self-seed an empty Pod so the export round-trip has buildings to export
    // (the test no longer assumes a pre-seeded Pod). The `user` demo building
    // round-trips through the generic "User" import template used below.
    await ensureDemoBuildings(page, "user");
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "excel-export");
    await page.close();
  });

  test("downloads fire with the expected filenames", async () => {
    test.setTimeout(T.testSolo);
    await openManage(page);

    // "Download all (Excel)" → one workbook for all owned buildings.
    const dlAll = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download all (Excel)" }).click();
    expect((await dlAll).suggestedFilename()).toBe("buildings-mine.xlsx");

    // A single building's row download → building-<id>.xlsx.
    const firstId = (await buildingRows(page).first().textContent())
      ?.match(/Building (\S+)/)?.[1];
    const dlOne = page.waitForEvent("download");
    await buildingRows(page).first()
      .getByRole("button", { name: "Download building data" }).click();
    expect((await dlOne).suggestedFilename()).toBe(`building-${firstId}.xlsx`);
  });

  test("an exported workbook re-imports to the same buildings", async () => {
    test.setTimeout(T.testSolo);
    await openManage(page);

    const before = new Set(await buildingIds(page));
    expect(before.size, "a seeded building to export (reseed if 0)")
      .toBeGreaterThan(0);
    // Best-effort: the first building's street address (row reads
    // "Building <id> — <addr><uri>"), to assert it survives the round-trip.
    const addr = ((await buildingRows(page).first().textContent()) ?? "")
      .match(/Building \S+\s+—\s+(.+?)\s*https?:\/\//)?.[1]?.trim();

    // Export every building, then re-import the workbook through the file picker.
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download all (Excel)" }).click();
    const path = "test-results/roundtrip.xlsx";
    await (await dl).saveAs(path);

    await page.getByRole("button", { name: "Add Building", exact: true }).first()
      .click();
    // The generic ("User") template is the shape buildingsToXlsx round-trips
    // through; it also allows duplicate buildingCodes (investor template doesn't).
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Template").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await dialog.locator('input[type="file"]').setInputFiles(path);

    const loaded = page.getByText(/Loaded \d+ building\(s\) from file/);
    await expect(loaded).toBeVisible({ timeout: T.action });
    // All N exported buildings re-parsed from the workbook.
    const loadedN = Number(
      (await loaded.textContent())?.match(/Loaded (\d+)/)?.[1],
    );
    expect(loadedN).toBe(before.size);

    // Add succeeds → the required master fields (incl. street address) survived
    // (an empty/garbled export would fail validation and disable the button).
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();
    // Case-insensitive: a single re-imported building toasts "Building added"
    // (capital B), the plural case "N buildings added" — the kind-specific demo
    // seeds one building, so the singular path is the common one here.
    await expect(page.getByText(/buildings? added/i).first())
      .toBeVisible({ timeout: T.action });

    // Closing the dialog refetches the Manage list, so the re-imported rows appear
    // a moment later — poll the id diff rather than reading it once.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
    let added: string[] = [];
    await expect(async () => {
      added = (await buildingIds(page)).filter((id) => !before.has(id));
      expect(added.length, "the exported buildings re-imported").toBe(before.size);
    }).toPass({ timeout: T.poll });
    if (addr) {
      // Original + re-imported copy → the address appears at least twice.
      expect(await page.getByText(addr, { exact: false }).count())
        .toBeGreaterThanOrEqual(2);
    }

    // Clean up the re-imported copies so the test repeats.
    for (const id of added) {
      const row = page.locator("li", { hasText: `Building ${id}` }).first();
      await row.getByRole("button", { name: "Delete building" }).click();
      await expect(page.getByText("Building deleted").first())
        .toBeVisible({ timeout: T.action });
    }
    // The "Building deleted" toast fires on the mutation; the Manage list refetch
    // (invalidate buildings) lands a beat later, so the last-deleted row can still
    // linger for a moment. Poll until the listing is back to exactly `before`
    // (eventually-consistent, mirroring the re-import assertion above).
    await expect(async () => {
      expect(new Set(await buildingIds(page))).toEqual(before);
    }).toPass({ timeout: T.poll });
  });
});
