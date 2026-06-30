import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { t, tPattern } from "../helpers/i18n.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { buildingIds, buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { T } from "../helpers/timeouts.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { createZip } from "../../../src/lib/zip.ts";

/**
 * "Is the wrapper-pulled data visible in the app?" — imports a logistikimmobilien-shaped
 * archive (one logistics building carrying the fields the six `linked-*` wrappers feed into
 * the dataset) and asserts the building detail page renders them:
 *  - PV system + capacity      ← linked-mastr  (`<#pv>` :PVSystem)
 *  - measured building height   ← linked-lod2-by (`bldg:buildingHeight`)
 *  - Standort energy profile    ← linked-lau/-nuts/-energieatlas, reached live from the region
 *                                 concept the building points at via `dcterms:spatial`
 *  - 3D building model           ← linked-lod2-by, fetched live by the building's coordinate
 *
 * The building uses a real Nürnberg coordinate + the real Nürnberg LAU concept so the
 * live-fetched panels (Standort, 3D model) light up against the running wrappers. The archive is
 * the generator's verbatim shape (relative `<#it>`, no base/webId ⇒ PUT as-is).
 *
 * MUTATES the Pod (adds one building); afterAll resets it. Tier 3 vs a disposable CSS. Alice
 * (account A); skipped without creds.
 *
 *   deno task e2e:local test/e2e/solo/logistics-visible.spec.ts
 */

const ACC = account("A");
const ARCHIVE_PATH = "test-results/logistics-visible-e2e.zip";

// A real Nürnberg coordinate (AGS 09564) — inside the LoD2-BY dump + Energie-Atlas coverage.
const LAT = 49.452;
const LON = 11.080;
const GEMEINDE = "https://wunderfacts.com/lau/lau/DE_09564000#it";

const PREFIXES = [
  "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
  "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
  "@prefix rec: <https://w3id.org/rec#> .",
  "@prefix bldg: <https://solid.ti.rw.fau.de/gra/building.ttl#> .",
  "@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .",
  "@prefix dcterms: <http://purl.org/dc/terms/> .",
  "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
  "",
].join("\n");

/** A v3 archive (verbatim PUT, like the generator) with one logistics building exercising the
 *  wrapper-derived shape: PV system, LoD2 height, geo:Point coordinates, and the region concept. */
function logisticsArchive(): Uint8Array {
  const enc = new TextEncoder();
  const building = PREFIXES +
    `<#it> a rec:Building ;\n` +
    `    rdfs:label "E2E Logistik Halle" ;\n` +
    `    bldg:usedAs "Logistics" ;\n` +
    `    bldg:hasBuildingArea 5000 ;\n` +
    `    bldg:hallArea "5000"^^xsd:decimal ;\n` +
    `    bldg:companyName "E2E Logistik GmbH" ;\n` +
    `    bldg:buildingHeight 11.40 ;\n` +
    `    geo:location [ a geo:Point ; geo:lat ${LAT} ; geo:long ${LON} ] ;\n` +
    `    dcterms:spatial <${GEMEINDE}> ;\n` +
    `    bldg:hasSystem <#pv> .\n` +
    `<#pv> a bldg:PVSystem ;\n` +
    `    bldg:capacityKW "180.0"^^xsd:decimal .\n`;
  const manifest = JSON.stringify(
    { version: 3, entries: { "buildings/logistics-e2e.ttl": "text/turtle" } },
    null,
    2,
  );
  return createZip([
    { path: "manifest.json", data: enc.encode(manifest) },
    { path: "buildings/logistics-e2e.ttl", data: enc.encode(building) },
  ]);
}

test.describe("imported wrapper-derived logistics data is visible on the building page", () => {
  test.skip(
    !hasAccount(ACC),
    "Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run this e2e.",
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "logistics-visible");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    mkdirSync("test-results", { recursive: true });
    writeFileSync(ARCHIVE_PATH, logisticsArchive());
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "logistics-visible");
    await page.close();
  });

  test("imports the archive and renders PV, height, region profile, 3D model", async () => {
    test.setTimeout(T.testSolo);

    // Import the archive (dev-mode), confirm the overwrite.
    await setDevMode(page, true);
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles(ARCHIVE_PATH);
    await confirmDialog(page, "Restore");
    await expect(page.getByText(tPattern("devRestoreSuccess"))).toBeVisible({
      timeout: T.action,
    });

    // The building lands in the list (poll-stabilised for the Pod).
    await openBuildingsList(page);
    let id = "";
    await expect(async () => {
      id = (await buildingIds(page)).find((i) => i.includes("logistics-e2e")) ?? "";
      expect(id, "logistics building imported").not.toBe("");
    }).toPass({ timeout: T.poll });

    await page.goto(buildingRoute("building", id));

    // ── Wrapper data from the ARCHIVE ──
    // linked-mastr: the PV system + its capacity.
    await expect(page.getByText(t("mdPvSystem"))).toBeVisible({ timeout: T.action });
    await expect(page.getByText(/180(\.0)? kW/)).toBeVisible({ timeout: T.action });
    // linked-lod2-by: the measured building height.
    await expect(page.getByText(/11[.,]4/)).toBeVisible({ timeout: T.action });

    // ── Wrapper data fetched LIVE from the region concept / coordinate ──
    // linked-lau/-nuts/-energieatlas: the Standort energy profile (driven by dcterms:spatial →
    // regionConceptIri → AGS). linked-lod2-by: the 3D model (by coordinate). Generous timeouts —
    // these hit the live wrappers.
    await expect(page.getByText(t("secStandortProfile"))).toBeVisible({ timeout: T.poll });
    await expect(page.getByText(t("b3dTitle"))).toBeVisible({ timeout: T.poll });
  });
});
