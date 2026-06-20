import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { t } from "../helpers/i18n.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { buildingRoute, openBuildingsList, buildingRows } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { T } from "../helpers/timeouts.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readZip } from "../../../src/lib/zip.ts";

/**
 * Full-archive smoke test — **Tier 3 only**. Imports the REAL logistics archive the
 * generator emits (~1k resources / ~366 buildings) into a throwaway CSS Pod and
 * asserts the whole dataset imports and the technical-system rows render on real
 * data: the generator → archive → import → render pipeline, end to end, at scale.
 * (The focused, deterministic battery/CHP render behaviour is `archive-systems.spec.ts`;
 * this is the integration/scale companion.)
 *
 * Every assertion is DERIVED from the archive at run time (the restored-resource
 * count, and a battery + a CHP building's id are read out of the zip), so the spec
 * survives a regen without touching hardcoded counts/ids.
 *
 * Heavy + slow: a single Import drives ~1k sequential PUTs. It is gated to Tier 3
 * (skipped unless E2E_LOCAL — a real Pod would be throttled to death) and skipped
 * when the archive file is absent. Point it at a specific file with
 * `LOGISTICS_ARCHIVE=<path>`; otherwise it picks the newest
 * `../logistikimmobilien/logistik-*archive-*.zip`.
 *
 *   deno task e2e:local test/e2e/tasks/archive-full-load.spec.ts
 *
 * MUTATES the Pod (imports the full dataset); afterAll resets it. Runs against
 * Alice (account A); skipped without creds.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const ACC = account("A");
// An own building's app id is its subject IRI shortened to a STORAGE-ROOT-relative
// reference — which includes the app-collection segment (`buildingIdFor`). The run
// bakes that segment into the build AND exports it to this runner, so a building
// imported at `<root>/<appDir>/buildings/<stem>.ttl#it` is keyed `<appDir>/buildings/<stem>.ttl#it`.
const APP_DIR = ENV?.VITE_POD_APP_DIR ?? "granergize";

/** Newest `logistik-*archive-*.zip` under ../logistikimmobilien, or the explicit
 *  LOGISTICS_ARCHIVE override; null when none is found (→ the test self-skips). */
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
  const dir = "../logistikimmobilien";
  try {
    const zips = readdirSync(dir)
      .filter((n) => /^logistik-.*archive-.*\.zip$/.test(n))
      .sort(); // ISO-dated filenames → lexicographic sort = chronological
    const newest = zips.at(-1);
    return newest ? `${dir}/${newest}` : null;
  } catch {
    return null;
  }
}

const ARCHIVE = locateArchive();
// ~1k sequential PUTs to the local CSS take far longer than a single-write action.
const IMPORT_TIMEOUT = 8 * 60_000;

interface ArchivePlan {
  /** Resources the importer reports as restored = entries minus manifest.json. */
  expectedRestored: number;
  /** A building file carrying a `:BatteryStorage` node, as its `?ref=` id. */
  batteryId: string;
  /** A building file carrying a `:CHPSystem` node, as its `?ref=` id. */
  chpId: string;
}

/** Read the archive once and derive the facts the assertions key on. */
function planFromArchive(path: string): ArchivePlan {
  const entries = readZip(new Uint8Array(readFileSync(path)));
  const manifest = JSON.parse(
    new TextDecoder().decode(
      entries.find((e) => e.path === "manifest.json")!.data,
    ),
  ) as { entries: Record<string, string> };

  const expectedRestored =
    Object.keys(manifest.entries).filter((p) => p !== "manifest.json").length;

  const dec = new TextDecoder();
  const findBuilding = (marker: string): string => {
    const hit = entries.find(
      (e) =>
        /^buildings\/[^/]+\.ttl$/.test(e.path) &&
        dec.decode(e.data).includes(marker),
    );
    if (!hit) throw new Error(`archive has no building with a ${marker} node`);
    // Storage-root-relative id (app-dir segment + the manifest path) → `?ref=`.
    return `${APP_DIR}/${hit.path}#it`;
  };

  return {
    expectedRestored,
    batteryId: findBuilding("BatteryStorage"),
    chpId: findBuilding("CHPSystem"),
  };
}

test.describe("full logistics archive imports and renders at scale", () => {
  test.skip(!E2E_LOCAL, "Tier-3 only (a real Pod would be rate-limited).");
  test.skip(
    !ARCHIVE,
    "No logistics archive found — set LOGISTICS_ARCHIVE=<path> or place one in ../logistikimmobilien.",
  );
  test.skip(
    !hasAccount(ACC),
    "Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run this e2e.",
  );

  let page: Page;
  let plan: ArchivePlan;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    plan = planFromArchive(ARCHIVE!);
    page = await newCapturedPage(browser, "archive-full-load");
    // Keep the run hermetic and let the UI settle for teardown: the List/Map resolves
    // each operator's owl:sameAs against wikidata.org — hundreds of slow real-internet
    // GETs across 366 buildings — which otherwise keeps the app busy and races the
    // afterAll menu/dialog. The app tolerates a failed agent lookup (falls back to the
    // building's name), so stubbing these out changes nothing the spec asserts.
    await page.route(/wikidata\.org/, (route) => route.fulfill({ status: 404, body: "" }));
    // The restore goes through window.confirm — accept it.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "archive-full-load");
    await page.close();
  });

  test("imports the full dataset and renders a battery + a CHP building", async () => {
    test.setTimeout(IMPORT_TIMEOUT + 2 * 60_000);

    // Import the real archive (dev-mode), confirm the overwrite. The ~1k PUTs run
    // before the success toast resolves, hence the generous timeout.
    await setDevMode(page, true);
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles(ARCHIVE!);
    await confirmDialog(page, "Restore");
    await expect(
      page.getByText(
        new RegExp(`Restored ${plan.expectedRestored} resource\\(s\\)`),
      ),
    ).toBeVisible({ timeout: IMPORT_TIMEOUT });

    // The buildings populate the list.
    await openBuildingsList(page);
    await expect(buildingRows(page).first()).toBeVisible({ timeout: T.action });

    // A real battery building renders the "Battery storage" row (capacity in kWh).
    await page.goto(buildingRoute("building", plan.batteryId));
    await expect(page.getByText(t("mdBatteryStorage"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(/kWh/).first()).toBeVisible({ timeout: T.action });

    // A real CHP building renders the "Cogeneration (CHP)" row (thermal output).
    await page.goto(buildingRoute("building", plan.chpId));
    await expect(page.getByText(t("mdChpSystem"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(/kW th/).first()).toBeVisible({ timeout: T.action });
  });
});
