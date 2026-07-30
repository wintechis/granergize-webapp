import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";
import { addBuildingSubmitRe, buildingsAddedRe, E2E_LANG, t, tPattern } from "./i18n.ts";
import { openBuildingsList } from "./manage.ts";
import type { Lang } from "../../../src/lib/language.ts";

/**
 * The language the driven UI renders in. Defaults to the suite's `E2E_LANG`; the
 * video/handbuch specs render in their own locale and pass it explicitly, so one
 * helper drives every lane.
 */
export interface SeedOpts {
  lang?: Lang;
}

/** The core example fixture (6 L.Immo buildings) — emitted by
 *  `deno task gen:examples` alongside the app's bundled example files, so the
 *  specs import exactly the data a user gets from "Try an example file". */
export const CORE_FIXTURE = "test/e2e/fixtures/limmo-core.xlsx";
/** The bundled 15-minute load-profile example (served from `public/examples/`). */
export const LASTGANG_FIXTURE = "public/examples/lastgang-am-tower-10.xlsx";

/**
 * Stub the external lookups the import path makes, so the seeding helpers stay
 * hermetic in the local lane: the address register (buildings without
 * coordinates) and linked-lau `/contains` (the Gemeinde-AGS enrichment the
 * import runs even for coordinate-carrying rows). 404 on `/contains` is the
 * definitive "outside coverage" answer — fast, and it doesn't latch the
 * lookup off.
 */
export async function stubGeoLookups(page: Page): Promise<void> {
  await page.route(/\/addressapi\/search/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 1, results: [{ lat: 49.45, lon: 11.08 }] }),
    }));
  await page.route(/\/lau\/.*contains/, (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "no cover" }));
}

/**
 * Ensure the logged-in account has the example buildings on Manage, importing
 * them into an empty Pod through the in-app file-import flow so specs never
 * assume a pre-seeded Pod (a freshly-wiped Pod re-imports on the next run).
 *
 * There is no programmatic demo seed any more: the example data is a bundled
 * XLSX offered in the Add-building "Autofill from file" sub-flow, and this
 * helper drives that same import with the CORE fixture — the curated
 * 6-building subset of the L.Immo set ({@link CORE_FIXTURE}), which spans the
 * shapes the specs assert on: annual aggregates on every row (incl. the
 * "Thomas-Dachser-Str. 4" flagship with the full investor block), a
 * generation/PV building, and a locality spread. It's the file, not a build
 * flag, that keeps the import small — the full 37-building example would take
 * minutes per spec on a throttled remote Pod.
 *
 * The 15-minute series is NOT part of it: a Lastgang file always creates its
 * own building, so a series building is seeded separately by
 * {@link importSeriesBuilding}.
 *
 * Idempotent: a Pod that already lists buildings (incl. residue left by an
 * earlier spec whose cleanup was slow) returns quickly — which also avoids the
 * duplicate-building-code guard a second import of the same file would trip.
 *
 * After importing it waits for the listing to *stabilise* — same count across a
 * short interval — rather than for a fixed number, so a caller that snapshots the
 * building count (e.g. the excel-export round-trip) doesn't read a moving baseline.
 */
export async function importExampleBuildings(
  page: Page,
  { lang = E2E_LANG }: SeedOpts = {},
): Promise<void> {
  await openBuildingsList(page);
  const rows = page.locator("li[data-building-id]");

  // Already populated (used Pod, or residue from an earlier spec) — nothing to do.
  if (await rows.first().isVisible({ timeout: T.visible }).catch(() => false)) {
    return;
  }

  await stubGeoLookups(page);
  await page.getByRole("button", { name: t("bldgsAutofillFromFile", undefined, lang) })
    .click();
  const dialog = page.getByRole("dialog");
  // The hidden file input is set directly rather than driving the OS picker
  // (the dialog auto-opens it on mount, which a test can't answer).
  await dialog.locator('input[type="file"]').setInputFiles(CORE_FIXTURE);
  await expect(page.getByText(tPattern("loadedBuildings", lang)))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: addBuildingSubmitRe(lang) }).click();

  // Primary end signal: the import's completion toast. On a slow Pod the gap
  // between two building writes can exceed the stability interval below, so the
  // count check alone could read a still-growing listing. Best-effort — the
  // toast auto-hides, so a missed window just falls through.
  await page.getByText(buildingsAddedRe(lang)).first().waitFor({ timeout: T.poll })
    .catch(() => {});

  // Then wait for the import to fully settle: at least one building, and the count stable
  // across a 1s interval — so the listing has stopped growing before the caller
  // reads it (no magic number, tolerant of pre-existing residue).
  await expect(async () => {
    const a = await rows.count();
    expect(a).toBeGreaterThan(0);
    await page.waitForTimeout(1000);
    expect(await rows.count()).toBe(a);
  }).toPass({ timeout: T.poll });
}

/**
 * Import the bundled 15-minute load-profile (Lastgang) example as a building at
 * `street` — the specs' route to a series-carrying building.
 *
 * A Lastgang file carries readings + a label but no address, and the importer
 * always mints a NEW building per parsed row (there is no merge-onto-existing
 * path), so a series can't ride along with the annual example file: the caller
 * gets a series-only building here, and adds annual years on top with
 * `addEnergyYear` when it needs the both-shapes toggle. `street` must not
 * collide with a row from {@link CORE_FIXTURE}.
 */
export async function importSeriesBuilding(
  page: Page,
  street: string,
  { lang = E2E_LANG }: SeedOpts = {},
): Promise<void> {
  await openBuildingsList(page);
  await stubGeoLookups(page);
  await page.getByRole("button", { name: t("bldgsAutofillFromFile", undefined, lang) })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles(LASTGANG_FIXTURE);
  await expect(page.getByText(tPattern("addReadingsReady", lang)))
    .toBeVisible({ timeout: T.action });
  // The file's own building is nameless — give it the caller's address (the
  // location fields are what makes the building saveable).
  await dialog.getByLabel(t("lblStreetAddress", undefined, lang)).fill(street);
  await dialog.getByLabel(t("lblLocality", undefined, lang)).fill("Nürnberg");
  await dialog.getByLabel(t("lblPostalCode", undefined, lang)).fill("90475");
  await dialog.getByLabel(t("lblRegion", undefined, lang)).fill("Bayern");
  await dialog.getByLabel(t("lblLatitude", undefined, lang)).fill("49.4569");
  await dialog.getByLabel(t("lblLongitude", undefined, lang)).fill("11.0958");
  await dialog.getByRole("button", { name: addBuildingSubmitRe(lang) }).click();
  await expect(page.getByText(buildingsAddedRe(lang)).first())
    .toBeVisible({ timeout: T.longOp });
  await expect(dialog).toBeHidden({ timeout: T.action });
}
