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
 * Archive-import → render of the technical-system nodes (dev-mode). Imports a tiny
 * archive carrying a battery building (`<#battery>` :BatteryStorage) and a CHP
 * building (`<#chp>` :CHPSystem) — the same shape the logistics generator emits
 * (relative `<#it>`, no base/webId ⇒ verbatim PUT) — then asserts the building
 * detail shows the "Battery storage" and "Cogeneration (CHP)" rows. The webapp
 * loader's parse-dispatch-on-rdf:type + MasterDataSection rendering, end to end
 * through the real Import-archive flow.
 *
 * MUTATES the Pod (adds two buildings); afterAll resets it. Tier 3 runs against a
 * disposable CSS. Runs against Alice (account A); skipped without creds.
 *
 *   deno task e2e:local test/e2e/solo/archive-systems.spec.ts
 */

const ACC = account("A");
const ARCHIVE_PATH = "test-results/archive-systems-e2e.zip";

const PREFIXES = [
  "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
  "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
  "@prefix rec: <https://w3id.org/rec#> .",
  "@prefix bldg: <https://solid.ti.rw.fau.de/gra/building.ttl#> .",
  "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
  "",
].join("\n");

/** A v3 archive (no base/webId ⇒ verbatim PUT, like the generator's output) with a
 *  battery building and a CHP building, each a `bldg:hasSystem` fragment node. */
function systemsArchive(): Uint8Array {
  const enc = new TextEncoder();
  const battery = PREFIXES +
    `<#it> a rec:Building ;\n` +
    `    rdfs:label "E2E Battery Hall" ;\n` +
    `    bldg:hasSystem <#battery> .\n` +
    `<#battery> a bldg:BatteryStorage ;\n` +
    `    bldg:storageCapacityKWh "215.5"^^xsd:decimal ;\n` +
    `    bldg:commissioningYear "2021"^^xsd:gYear .\n`;
  const chp = PREFIXES +
    `<#it> a rec:Building ;\n` +
    `    rdfs:label "E2E CHP Hall" ;\n` +
    `    bldg:hasSystem <#chp> .\n` +
    `<#chp> a bldg:CHPSystem ;\n` +
    `    bldg:capacityKW "61"^^xsd:decimal ;\n` +
    `    bldg:thermalCapacityKW "126"^^xsd:decimal ;\n` +
    `    bldg:commissioningYear "2017"^^xsd:gYear .\n`;
  const manifest = JSON.stringify(
    {
      version: 3,
      entries: {
        "buildings/battery-e2e.ttl": "text/turtle",
        "buildings/chp-e2e.ttl": "text/turtle",
      },
    },
    null,
    2,
  );
  return createZip([
    { path: "manifest.json", data: enc.encode(manifest) },
    { path: "buildings/battery-e2e.ttl", data: enc.encode(battery) },
    { path: "buildings/chp-e2e.ttl", data: enc.encode(chp) },
  ]);
}

test.describe("archive import renders battery + CHP system nodes", () => {
  test.skip(
    !hasAccount(ACC),
    "Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run this e2e.",
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "archive-systems");
    // The restore goes through window.confirm — accept it.
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
    mkdirSync("test-results", { recursive: true });
    writeFileSync(ARCHIVE_PATH, systemsArchive());
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "archive-systems");
    await page.close();
  });

  test("imports a battery + CHP archive and renders the system rows", async () => {
    test.setTimeout(T.testSolo);

    // Import the archive (dev-mode), confirm the overwrite.
    await setDevMode(page, true);
    await page.locator('input[type="file"][accept*="zip"]').setInputFiles(ARCHIVE_PATH);
    await confirmDialog(page, "Restore");
    await expect(page.getByText(tPattern("devRestoreSuccess"))).toBeVisible({
      timeout: T.action,
    });

    // Both imported buildings land in the list (poll-stabilised for the Pod).
    await openBuildingsList(page);
    let batteryId = "";
    let chpId = "";
    await expect(async () => {
      const ids = await buildingIds(page);
      batteryId = ids.find((i) => i.includes("battery-e2e")) ?? "";
      chpId = ids.find((i) => i.includes("chp-e2e")) ?? "";
      expect(batteryId, "battery building imported").not.toBe("");
      expect(chpId, "CHP building imported").not.toBe("");
    }).toPass({ timeout: T.poll });

    // Battery detail: the :BatteryStorage node renders as the "Battery storage" row.
    await page.goto(buildingRoute("building", batteryId));
    await expect(page.getByText(t("mdBatteryStorage"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(/215\.5 kWh/)).toBeVisible({ timeout: T.action });

    // CHP detail: the :CHPSystem node renders as the "Cogeneration (CHP)" row,
    // with its electrical + thermal output.
    await page.goto(buildingRoute("building", chpId));
    await expect(page.getByText(t("mdChpSystem"))).toBeVisible({
      timeout: T.action,
    });
    await expect(page.getByText(/126 kW th/)).toBeVisible({ timeout: T.action });
  });
});
