import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { buildingIds, buildingRows, deleteBuildingRow } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Excel-export e2e (PROBLEMS.md #8). Proves a workbook actually downloads in the
 * browser and re-imports to the same buildings (a full round-trip through the
 * UI — field-level fidelity is also unit-tested in buildingSerializer.test.ts).
 * The round-trip test MUTATES the Pod (exports, deletes the originals, then
 * re-imports the workbook); afterAll wipes the collection. It self-seeds an empty
 * Pod in beforeAll (ensureDemoBuildings), so it doesn't assume a pre-seeded Pod.
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
    // Self-seed an empty Pod so the export round-trip has buildings to export (the
    // test no longer assumes a pre-seeded Pod). The `user` demo seeds a couple of
    // buildings, so this exercises the MULTI-building round-trip — incl. the cleanup
    // that deletes the re-imported copies and asserts the listing converges back.
    // That relies on `deleteBuilding`'s read-after-write (it waits until the
    // `buildings/` listing drops a deleted file before resolving), so the per-delete
    // refetch can't briefly surface a phantom row under CSS eventual consistency.
    // They round-trip through the generic "User" import template used below.
    await ensureDemoBuildings(page);
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

    // A single building's row download opens a layout menu (the building carries no
    // role, so the export style is chosen here); picking one → building-<id>.xlsx.
    const firstId = (await buildingRows(page).first().textContent())
      ?.match(/Building (\S+)/)?.[1];
    await buildingRows(page).first()
      .getByRole("button", { name: "Download building data" }).click();
    const dlOne = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /generic/i }).click();
    expect((await dlOne).suggestedFilename()).toBe(`building-${firstId}.xlsx`);
  });

  test("an exported workbook re-imports to the same buildings", async () => {
    // Bulk round-trip — deletes every seeded building (incl. the heavy 15-min user
    // series subtrees) then re-imports them, recreating the full series (dozens of
    // daily-file PUTs) plus a full reload. The heaviest single test by round-trip
    // count; `T.longOp` (and the inner `T.action`/`T.poll` waits) are backend-aware,
    // so JSS already gets the headroom this volume needs — no per-backend bump here.
    test.setTimeout(T.longOp);
    await openManage(page);

    const before = new Set(await buildingIds(page));
    expect(before.size, "a seeded building to export (reseed if 0)")
      .toBeGreaterThan(0);
    // Best-effort: the first building's street address (row reads
    // "Building <id> — <addr><uri>"), to assert it survives the round-trip.
    const addr = ((await buildingRows(page).first().textContent()) ?? "")
      .match(/Building \S+\s+—\s+(.+?)\s*https?:\/\//)?.[1]?.trim();

    // Export every building.
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download all (Excel)" }).click();
    const path = "test-results/roundtrip.xlsx";
    await (await dl).saveAs(path);

    // Delete the originals first: building codes must be unique, so re-importing on
    // top of the originals would (correctly) be blocked as duplicates. Deleting them
    // makes this a genuine export → re-import round-trip.
    for (const id of before) await deleteBuildingRow(page, id);
    await expect(async () => {
      expect((await buildingIds(page)).length).toBe(0);
    }).toPass({ timeout: T.poll });

    // Re-import the workbook through the file picker. buildingsToXlsx writes the
    // generic flat shape; uploading it lets the importer auto-detect the generic
    // format and re-parse every row.
    await page.getByRole("button", { name: "Add Building", exact: true }).first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles(path);

    const loaded = page.getByText(/Loaded \d+ building\(s\) from file/);
    await expect(loaded).toBeVisible({ timeout: T.action });
    // All N exported buildings re-parsed from the workbook.
    const loadedN = Number(
      (await loaded.textContent())?.match(/Loaded (\d+)/)?.[1],
    );
    expect(loadedN).toBe(before.size);

    // Add succeeds → the required master fields (incl. coordinates) survived the
    // export (an empty/garbled export would fail validation and disable the button).
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();
    await expect(page.getByText(/buildings? added/i).first())
      .toBeVisible({ timeout: T.action });

    // The same number of buildings are back, with the original address present.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });
    await expect(async () => {
      expect((await buildingIds(page)).length).toBe(before.size);
    }).toPass({ timeout: T.poll });
    if (addr) {
      expect(await page.getByText(addr, { exact: false }).count())
        .toBeGreaterThanOrEqual(1);
    }
  });
});
