import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The Observations finder's `open` source tier — actually-settled generation of nearby
 * renewable installations (netztransparenz, joined to MaStR via the unit's EEG number).
 * EXTERNAL hosts, so this STUBS the three-step join: `mastr/bbox` (a nearby solar unit) →
 * `mastr/see/{id}` (its `EegMaStRNummer`) → `netztransparenz/eeg/{number}` (the settled
 * kWh/year). An owned building frames the Observations map → `?c`, so the open fetch
 * fires once the tier is ticked. Asserts the "Open generation (nearby)" row surfaces the
 * plant + its settled kWh. Self-cleaning; Alice (account A).
 *
 *   deno task e2e:local test/e2e/tasks/open-observations.spec.ts
 */

const ACC = account("A");
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
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
<https://wunderfacts.com/mastr/see/E2E1#it>
  mastr:Bruttoleistung 156.330 ;
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
    // Stub the join: `/mastr/` serves the bbox listing or a `/see/` unit by path;
    // `/netztransparenz/` serves the plant. No live cross-origin call escapes.
    await page.route(/\/mastr\//, (route) => {
      const url = route.request().url();
      if (url.includes("/bbox")) return route.fulfill(turtle(MASTR_BBOX));
      if (url.includes("/see/")) return route.fulfill(turtle(MASTR_SEE));
      return route.fulfill({ status: 404, headers: CORS, body: "" });
    });
    await page.route(
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

    // The open tier is viewport-driven and opt-in — no owned building needed (keeping
    // the slate clean for teardown). Preset both in the URL: a centre near the stubbed
    // installation (`?c`) + the open tier ticked (`?tiers`), so the join fetch fires on
    // load (bbox → see → netztransparenz, all through the stubs).
    await page.goto("/observations?view=list&c=49.451,11.081&z=14&tiers=mine,shared,open");

    await expect(page.getByRole("heading", { name: t("obsOpenSection") }))
      .toBeVisible({ timeout: T.poll });
    const openRow = page.locator("li", { hasText: "E2E Solar Plant" }).first();
    await expect(openRow).toBeVisible({ timeout: T.action });
    await expect(openRow).toContainText("2024");
    await expect(openRow).toContainText("kWh");
  });
});
