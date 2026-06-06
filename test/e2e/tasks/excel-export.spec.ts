import { expect, type Page, test } from "@playwright/test";
import { hasAccount, login, SOLO_SLOT, soloAccount } from "../helpers/login.ts";
import { buildingIds, buildingRows } from "../helpers/manage.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";

/**
 * Excel-export e2e (PROBLEMS.md #8). Proves a workbook actually downloads in the
 * browser and re-imports to the same buildings (a full round-trip through the
 * UI — field-level fidelity is also unit-tested in buildingSerializer.test.ts).
 * The round-trip test MUTATES the Pod (re-imports the exported buildings, then
 * deletes the copies) and cleans up after itself. It self-seeds an empty Pod in
 * beforeAll (ensureDemoBuildings), so it doesn't assume a pre-seeded Pod.
 *
 *   source .env.e2e.local && deno task e2e:base excel-export --workers=1
 *
 * Runs against the solo Pod (E2E_SOLO; default C = solidweb). Skipped
 * without creds.
 */

const ACC = soloAccount();

async function openManage(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(buildingRows(page).first()).toBeVisible({ timeout: 120_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("excel export", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${SOLO_SLOT} / E2E_PASSWORD_${SOLO_SLOT} (a throwaway Solid Pod) to run the excel-export e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    // Self-seed an empty Pod so the export round-trip has buildings to export
    // (the test no longer assumes a pre-seeded Pod).
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("downloads fire with the expected filenames", async () => {
    test.setTimeout(120_000);
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
    test.setTimeout(180_000);
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
    await expect(loaded).toBeVisible({ timeout: 60_000 });
    // All N exported buildings re-parsed from the workbook.
    const loadedN = Number(
      (await loaded.textContent())?.match(/Loaded (\d+)/)?.[1],
    );
    expect(loadedN).toBe(before.size);

    // Add succeeds → the required master fields (incl. street address) survived
    // (an empty/garbled export would fail validation and disable the button).
    await dialog.getByRole("button", { name: /^Add (Building|\d+ Buildings)$/ })
      .click();
    await expect(page.getByText(/buildings? added/).first())
      .toBeVisible({ timeout: 120_000 });

    // Closing the dialog refetches the Manage list, so the re-imported rows appear
    // a moment later — poll the id diff rather than reading it once.
    await expect(buildingRows(page).first()).toBeVisible({ timeout: 60_000 });
    let added: string[] = [];
    await expect(async () => {
      added = (await buildingIds(page)).filter((id) => !before.has(id));
      expect(added.length, "the exported buildings re-imported").toBe(before.size);
    }).toPass({ timeout: 60_000 });
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
        .toBeVisible({ timeout: 90_000 });
    }
    expect(new Set(await buildingIds(page))).toEqual(before);
  });
});
