import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { t, tPattern } from "../helpers/i18n.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { allowLiveWrappers } from "../helpers/stubBasemap.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { T } from "../helpers/timeouts.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readZip } from "../../../src/lib/zip.ts";

/**
 * Real archive × LIVE open-data enrichment × several buildings — the piece
 * `archive-full-load` (baked data, wrappers stubbed) and `logistics-visible` (one
 * synthetic building) don't cover. It uploads the REAL generator archive to the
 * throwaway CSS Pod, then for a selection of its buildings asserts the data the app
 * fetches ON DEMAND from the wrappers renders on the observation page:
 *  - the nearby renewable installations (linked-mastr, by coordinate)
 *  - the Standort energy profile (linked-energieatlas, by the building's Gemeinde)
 *
 * The lane split that makes this possible: the **Pod is local** (a throwaway CSS — fast,
 * no rate limit, so the FULL archive uploads), while the **wrappers are live**
 * ({@link allowLiveWrappers} lifts the local wrapper stub). It is the pattern until a
 * scalable online Pod server exists. Hence **Tier 3 only** — gated to E2E_LOCAL (a real
 * Pod would be throttled by the ~1.3k-PUT import). Shape-tolerant: it asserts the
 * enrichment SECTIONS appear, never specific figures (they're live). Self-cleaning; Alice
 * (account A); skipped when the archive is absent.
 *
 *   deno task e2e:local test/e2e/solo/archive-live-enrichment.spec.ts
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const ACC = account("A");
// The imported building's app id is its subject IRI shortened to a storage-root-relative
// reference — the app-collection segment (baked into the build) + the manifest path.
const APP_DIR = ENV?.VITE_POD_APP_DIR ?? "granergize";
// How many of the uploaded buildings to check the live enrichment for — a selection (each
// building's enrichment is several live wrapper fetches, so keep it small).
const SELECTION = 3;
// The full-archive import drives ~1.3k sequential PUTs to the local CSS.
const IMPORT_TIMEOUT = 8 * 60_000;

/** The committed dated snapshot under `test/e2e/fixtures/`, or an explicit
 *  `LOGISTICS_ARCHIVE` override, or the newest sibling-repo archive; `null` → self-skip.
 *  (Mirrors `archive-full-load.spec.ts`; kept local to keep the specs independent.) */
function locateArchive(): string | null {
  const explicit = ENV?.LOGISTICS_ARCHIVE;
  if (explicit) {
    try {
      statSync(explicit);
      return explicit;
    } catch {
      return null;
    }
  }
  const newestIn = (dir: string): string | null => {
    try {
      const zips = readdirSync(dir)
        .filter((n) => /^logistik-.*archive-.*\.zip$/.test(n))
        .sort(); // ISO-dated filenames → lexicographic = chronological
      const newest = zips.at(-1);
      return newest ? `${dir}/${newest}` : null;
    } catch {
      return null;
    }
  };
  return newestIn("test/e2e/fixtures") ?? newestIn("../logistikimmobilien");
}

const ARCHIVE = locateArchive();

/** The app ids of the first {@link SELECTION} located building files in the archive — the
 *  enrichment is keyed on the building's coordinate, so pick ones that carry a point.
 *  Deterministic (sorted) so a re-run checks the same buildings. */
function selectionIds(path: string): string[] {
  const dec = new TextDecoder();
  return readZip(new Uint8Array(readFileSync(path)))
    .filter((e) => /^buildings\/[^/]+\.ttl$/.test(e.path))
    .filter((e) => dec.decode(e.data).includes("wgs84_pos#lat"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, SELECTION)
    .map((e) => `${APP_DIR}/${e.path}#it`);
}

test.describe("live open-data enrichment over an uploaded real archive", () => {
  test.skip(!E2E_LOCAL, "Tier-3 only: uploads the full archive to the local CSS (a real Pod would be throttled).");
  test.skip(
    !ARCHIVE,
    "No logistics archive found — commit one under test/e2e/fixtures/ or set LOGISTICS_ARCHIVE.",
  );
  test.skip(
    !hasAccount(ACC),
    "Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run this e2e.",
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "archive-live-enrichment");
    // Lift the local wrapper stub → the open-data enrichment hits the LIVE wrappers
    // (the Pod stays the local CSS). Wikidata/Commons logos stay stubbed.
    await allowLiveWrappers(page);
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "archive-live-enrichment");
    await page.close();
  });

  test("each selected building shows its on-demand wrapper enrichment", async () => {
    test.setTimeout(IMPORT_TIMEOUT + 2 * 60_000);

    // Upload the real archive (dev-mode) to the local Pod, confirm the overwrite. The
    // ~1.3k PUTs run before the success toast resolves, hence the generous timeout.
    await setDevMode(page, true);
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles(ARCHIVE!);
    await confirmDialog(page, "Restore");
    await expect(page.getByText(tPattern("devRestoreSuccess")))
      .toBeVisible({ timeout: IMPORT_TIMEOUT });

    // The buildings populate the list.
    await openBuildingsList(page);

    for (const id of selectionIds(ARCHIVE!)) {
      // The BUILDING page carries the location context layers, fetched live.
      await page.goto(buildingRoute("building", id));

      // linked-mastr: the nearby renewable installations (by coordinate).
      await expect(page.getByText(t("niTitle")))
        .toBeVisible({ timeout: T.poll });

      // The observation page keeps the region-grain context.
      await page.goto(buildingRoute("observation", id));

      // linked-energieatlas: the Standort energy profile (by the building's Gemeinde).
      // Exact heading — "Location energy profile" prefixes the neighbourhood section's
      // "Location energy profile — neighbourhood".
      await expect(
        page.getByRole("heading", { name: t("secStandortProfile"), exact: true }),
      ).toBeVisible({ timeout: T.poll });
    }
  });
});
