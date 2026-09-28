import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { addBuilding } from "../helpers/manage.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { E2E_LOCAL, stubWhenLocal } from "../helpers/lane.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Observations finder's `open` source tier — actually-settled generation of nearby
 * renewable installations (netztransparenz, joined to MaStR via the unit's EEG number).
 * LOCAL stubs the three-step join: `mastr/within` (a nearby solar unit) →
 * `mastr/see/{id}` (its `EegMaStRNummer`) → `netztransparenz/eeg/{number}` (the settled
 * kWh/year), asserting the specific "E2E Solar Plant" row + 156.33 kW detail. REMOTE lets
 * the join reach the LIVE wrappers (the seed sits on real MaStR coverage in central
 * Nürnberg), so the plant name/figures are nondeterministic and we assert only that the
 * open section populates with a settled-generation row (year + kWh) that drills to a
 * read-only detail page. The open tier is **context around your own buildings**
 * (`ownDataAnchor`), so an owned building with coordinates anchors the open fetch once the
 * tier is ticked. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/solo/open-observations.spec.ts
 */

const ACC = account("A");
const ADDR = "Open Obs E2E Strasse 1";
const CORS = { "access-control-allow-origin": "*" };

// The three join hops, stubbed. A renewable (solar, carrier 2495) unit in the bbox →
// its detail carries the EEG number → the netztransparenz plant carries one 2024
// settlement (123456 kWh).
const MASTR_BBOX = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/E2E1#it>
  rdfs:label "E2E Solar Plant" ; geo:lat 49.451 ; geo:long 11.081 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2495" .
`;
const MASTR_SEE = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/E2E1#it>
  rdfs:label "E2E Solar Plant" ;
  mastr:Bruttoleistung 156.330 ;
  mastr:Gemeinde "Nürnberg" ;
  mastr:EegMaStRNummer <https://wunderfacts.com/mastr/eeg/999000111#it> ;
  mastr:Energietraeger <https://wunderfacts.com/mastr/cl/148#2495> .
`;
const NETZ_PLANT = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix vocab: <https://wunderfacts.com/netztransparenz/vocab#> .
<https://wunderfacts.com/netztransparenz/eeg/999000111#it>
  rdf:type vocab:Plant ; vocab:energySource "Solar" ;
  vocab:hasSettlement
    [ vocab:disposalForm "market-premium" ; vocab:strommengeKWh 123456 ;
      vocab:year "2024"^^xsd:gYear ] .
`;

const turtle = (body: string) => ({
  status: 200,
  contentType: "text/turtle",
  headers: CORS,
  body,
});

test.describe.configure({ mode: "serial" });

test.describe("open observations (netztransparenz)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the open-observations e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "open-observations");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    // LOCAL only: stub the join — `/mastr/` serves the bbox listing or a `/see/` unit by
    // path; `/netztransparenz/` serves the plant. REMOTE reaches the live wrappers.
    await stubWhenLocal(page, /\/mastr\//, (route) => {
      const url = route.request().url();
      if (url.includes("/mastr/within")) return route.fulfill(turtle(MASTR_BBOX));
      if (url.includes("/see/")) return route.fulfill(turtle(MASTR_SEE));
      return route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await stubWhenLocal(
      page,
      /\/netztransparenz\//,
      (route) => route.fulfill(turtle(NETZ_PLANT)),
    );
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.afterAll(async () => {
    // Drop the wrapper stubs BEFORE teardown: the reset navigates to `/`, and a stubbed
    // 404 for an unexpected `/mastr/` call there raises an error alert that shifts the
    // header — making the account-menu wipe click miss. Un-stubbed, teardown matches
    // every other (non-stubbing) spec.
    await page.unroute(/\/mastr\//).catch(() => {});
    await page.unroute(/\/netztransparenz\//).catch(() => {});
    await verifyAndReset(page, "open-observations");
    await page.close();
  });

  test("the open tier surfaces nearby settled generation in the List", async () => {
    test.setTimeout(T.testSolo);

    // The open tier anchors to the user's OWN buildings (`ownDataAnchor`) — context around
    // your data, not the free viewport. Seed one with coordinates (49.45/11.08, ~the
    // stubbed plant at 49.451/11.081), then open the List with the open tier ticked
    // (`?tiers`): the join fetch fires around that building (bbox → see → netztransparenz,
    // all through the stubs).
    await addBuilding(page, ADDR);
    await page.goto("/observations?view=list&tiers=mine,shared,open");

    await expect(page.getByRole("heading", { name: t("obsOpenSection") }))
      .toBeVisible({ timeout: T.poll });

    // LOCAL: the specific stubbed plant. REMOTE: any settled-generation row (a nearby
    // unit joined to a netztransparenz settlement — "{year} · {kWh}").
    const openRow = E2E_LOCAL
      ? page.locator("li", { hasText: "E2E Solar Plant" }).first()
      : page.locator("li").filter({ hasText: /\d{4}/ }).filter({ hasText: "kWh" })
        .first();
    await expect(openRow).toBeVisible({ timeout: T.action });
    await expect(openRow).toContainText("kWh");
    if (E2E_LOCAL) await expect(openRow).toContainText("2024");

    // Drilling the row opens the in-app READ-ONLY plant detail (not the upstream doc):
    // the unit master data + the settled-generation chart, no edit/share.
    if (E2E_LOCAL) await openRow.getByText("E2E Solar Plant").click();
    else await openRow.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/observation\?uri=/, { timeout: T.action });
    if (E2E_LOCAL) {
      await expect(page.getByRole("heading", { name: "E2E Solar Plant" }))
        .toBeVisible({ timeout: T.action });
      await expect(page.getByText("156.33 kW")).toBeVisible({ timeout: T.action });
    } else {
      // Live: the detail page renders a heading + the unit's rated power ("… kW").
      await expect(page.getByRole("heading").first())
        .toBeVisible({ timeout: T.action });
      await expect(page.getByText(/\bkW\b/).first()).toBeVisible({ timeout: T.action });
    }
    await expect(page.getByRole("button", { name: /share|edit/i })).toHaveCount(0);
  });
});
