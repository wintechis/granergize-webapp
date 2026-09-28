import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, clearFinderMemory, verifyAndReset } from "../helpers/cleanSlate.ts";
import { buildingRoute, openBuildingsList, openBuildingsMap } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Navigational UI state lives in the URI so a browser reload (or a bookmark)
 * restores the view — see notes/ui-state.md. The active *finder* is the route now
 * (`/buildings`, `/rooms`, …) — no `?tab=`; this proves the route survives a real
 * reload. The standalone detail pages are real routes too: a cold deep-link to
 * `/building/:id` and `/observation/:id` (no clicking) opens them after a reload,
 * and the observation page's Weather section deep-links the same way. (The map is
 * a pure finder now — a marker click NAVIGATES to `/building/:id`; the old
 * `?b=`/`?dt=` map-detail sub-state is gone.) The two **redirect** routes are covered
 * too: the folded `/aggregations` lands in Explore's `?view=aggregations` projection
 * carrying the rest of the query string, and the former canonical `/observations`
 * lands on `/explore` with its cube coordinate intact (Step 3 of
 * `plans/plan-cube-centered-ui.md` swapped the two).
 *
 * The tab test needs no data, so it runs first and is independent of the (Tier-3
 * CSS) write flakiness. The selection tests add one throwaway building idempotently
 * (retried), deleted in afterAll. Selecting the single marker assumes a pristine
 * collection — the per-spec CSS reset (Tier 3) / per-run granergize-e2e-<uuid>
 * (Tier 4).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/uri-state.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 */

const ADDR = "URI State E2E Strasse 1";
const ACC = account("A");

/** Add one User-template building idempotently; retried against the CSS write race. */
async function ensureBuilding(page: Page): Promise<string> {
  await expect(async () => {
    await openBuildingsList(page);
    if (await page.locator("li", { hasText: ADDR }).count()) return;
    // A leftover dialog from a failed attempt covers the page button — close it.
    if (await page.getByRole("dialog").count()) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: T.visible });
    }
    await page.getByRole("button", { name: t("addBuildingBtn"), exact: true }).first()
      .click();
    const add = page.getByRole("dialog");
    await add.getByLabel(t("lblStreetAddress")).fill(ADDR);
    await add.getByLabel(t("lblLocality")).fill("Nürnberg");
    await add.getByLabel(t("lblPostalCode")).fill("90451");
    await add.getByLabel(t("lblRegion")).fill("Bayern");
    await add.getByLabel(t("lblLatitude")).fill("49.45");
    await add.getByLabel(t("lblLongitude")).fill("11.08");
    await add.getByRole("button", { name: t("addBuildingBtn") }).click();
    await expect(page.getByText(t("addBuildingAddedCount", { count: 1 })))
      .toBeVisible({ timeout: T.action });
  }).toPass({ timeout: T.poll });

  const row = page.locator("li", { hasText: ADDR }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  const id = (await row.getAttribute("data-building-id")) ?? "";
  expect(id, "the added building's id").toBeTruthy();
  return id;
}

test.describe.configure({ mode: "serial" });

test.describe("URI-encoded navigational state survives reload", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the uri-state e2e.`,
  );

  let page: Page;
  let id = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "uri-state");
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
    await assertCleanStart(page);
  });

  test.beforeEach(async () => {
    // The finder view/tier session memory is sticky; reset it so each test starts from
    // the hardcoded defaults (a sibling test's toggle must not leak in).
    await clearFinderMemory(page);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    try {
      if (!page.isClosed()) {
        await page.goto("/");
        await openBuildingsList(page);
        const row = page.locator("li", { hasText: ADDR }).first();
        if (await row.count()) {
          await row.getByRole("button", { name: t("buildingDeleteAria") }).click();
          await confirmDialog(page, "Delete");
          await expect(page.getByText(t("buildingDeleted")).first())
            .toBeVisible({ timeout: T.action });
        }
      }
    } catch {
      // best-effort cleanup; never fail teardown
    } finally {
      await verifyAndReset(page, "uri-state");
      await page.close();
    }
  });

  test("the active finder is restored after a reload", async () => {
    test.setTimeout(T.testSolo);
    // Pick a non-default finder (Rooms) — the app lands on /explore, so
    // restoring Rooms proves the route round-trips, not just the default.
    const roomsTab = page.getByRole("tab", { name: t("navMeet") });
    await roomsTab.click();
    await expect(roomsTab).toHaveAttribute("aria-selected", "true", {
      timeout: T.action,
    });
    expect(page.url()).toContain("/rooms");

    await page.reload();

    // Same finder after reload — not back on the default Buildings finder.
    await expect(page.getByRole("tab", { name: t("navMeet") }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
    expect(page.url()).toContain("/rooms");
  });

  test("a marker click navigates to the building page (and survives reload)", async () => {
    test.setTimeout(T.testSolo);
    id = await ensureBuilding(page);

    await page.goto("/");
    // Buildings tab lands on the Map view — markers live here. The cube's Space axis
    // is URL state (`?space=rows` for the List; Map is the implicit default), and
    // goto("/") drops the query, so we're already on Map; the explicit toggle is
    // belt-and-suspenders. Use the shared helper, which scopes the "Map" toggle to
    // the Buildings Space group (`bldgsViewAria`).
    await openBuildingsMap(page);

    // The map is a pure finder: clicking the (only) marker NAVIGATES to the
    // building's standalone page — a real route (`/building?ref=<id>`; an own
    // building's id is storage-relative, so it rides in `?ref=`).
    const marker = page.locator(".leaflet-marker-icon").first();
    await expect(marker).toBeVisible({ timeout: T.action });
    // The single-building auto-fit zooms hard (to z=18); a click can race that zoom
    // animation while the marker is still settling, so Leaflet swallows it and no nav
    // fires. Retry click→nav until the map has settled and the click lands. Use
    // toHaveURL (polls), not waitForURL (a BrowserRouter pushState nav fires no "load").
    await expect(async () => {
      await marker.click({ force: true });
      await expect(page).toHaveURL(/\/building\?/, { timeout: 2_000 });
    }).toPass({ timeout: T.action, intervals: [500] });
    expect(page.url()).toContain(`/building?ref=${encodeURIComponent(id)}`);

    // The route is a genuine path + query, so a reload restores it (the
    // silent-redirect restore that the standalone routes depend on must preserve
    // the query string — see notes/ui-state.md).
    await page.reload();
    await expect(page).toHaveURL(/\/building\?/, { timeout: T.action });
    expect(page.url()).toContain(`/building?ref=${encodeURIComponent(id)}`);
  });

  test("the Map ⇄ List view is restored from the URL after reload", async () => {
    test.setTimeout(T.testSolo);
    if (!id) id = await ensureBuilding(page);
    await page.goto("/buildings");
    // The cube's Space axis is URL state (`?space=rows` for the List; Map is the
    // implicit default) — switching writes it.
    await page.getByRole("button", { name: t("btnList") }).click();
    await expect(page).toHaveURL(/space=rows/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: t("navBuildings") }))
      .toBeVisible({ timeout: T.action });
    // A genuine reload restores List — not the default Map.
    await page.reload();
    await expect(page).toHaveURL(/space=rows/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: t("navBuildings") }))
      .toBeVisible({ timeout: T.action });
  });
  // (The Observations `?view=` round-trip is covered by cube-space-cut.spec.ts, which
  // seeds energy via importExampleBuildings so the View toggle is present.)

  // Step 2 of plan-cube-centered-ui: the Aggregations finder folded into Explore as
  // its `?view=aggregations` projection, and `/aggregations` stayed as a redirect. A
  // deep link must land on the folded surface WITH its other params intact (here the
  // projection's own `?guise=` sub-axis) — and, being ordinary URI state, survive a
  // reload.
  test("the /aggregations deep link redirects into Explore, keeping ?guise=", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/aggregations?guise=timeline");
    // Explore's canonical path is `/explore` since Step 3 of plan-cube-centered-ui.
    await expect(page).toHaveURL(/\/explore\?/, { timeout: T.action });
    await expect(page).toHaveURL(/view=aggregations/, { timeout: T.action });
    await expect(page).toHaveURL(/guise=timeline/, { timeout: T.action });
    // The folded surface renders (its own heading inside the Explore finder).
    await expect(page.getByRole("heading", { name: t("navAggregations") }))
      .toBeVisible({ timeout: T.action });

    await page.reload();
    await expect(page).toHaveURL(/view=aggregations/, { timeout: T.action });
    await expect(page).toHaveURL(/guise=timeline/, { timeout: T.action });
  });

  // Step 3 of plan-cube-centered-ui: `/explore` became the canonical Explore path and
  // the former `/observations` became the redirect (the reverse of Step 1). Same
  // contract as the `/aggregations` test above — an old bookmark/deep link must land on
  // the surface with its cube COORDINATE intact (here the pivot projection + its row
  // level), and, being ordinary URI state, survive a reload.
  test("the old /observations deep link redirects to /explore, keeping the coordinate", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/observations?view=pivot&rows=land");
    await expect(page).toHaveURL(/\/explore\?/, { timeout: T.action });
    await expect(page).toHaveURL(/view=pivot/, { timeout: T.action });
    await expect(page).toHaveURL(/rows=land/, { timeout: T.action });
    // The redirect is `replace`, so it left no history entry to bounce back into.
    await expect(page).not.toHaveURL(/\/observations/, { timeout: T.action });

    await page.reload();
    await expect(page).toHaveURL(/\/explore\?/, { timeout: T.action });
    await expect(page).toHaveURL(/view=pivot/, { timeout: T.action });
    await expect(page).toHaveURL(/rows=land/, { timeout: T.action });
  });

  // The centre flipped: "/" is Explore now, not the Buildings finder. Guards the home
  // landing itself (every spec's `goto("/")` depends on it) — asserted on the URL AND
  // on the rendered surface (the Explore tab selected), so a bare redirect that landed
  // on the wrong finder can't pass.
  test("home lands on Explore", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await expect(page).toHaveURL(/\/explore/, { timeout: T.action });
    await expect(page.getByRole("tab", { name: t("navObservations") }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
  });

  test("the map viewport (centre+zoom) is written to the URL", async () => {
    test.setTimeout(T.testSolo);
    if (!id) id = await ensureBuilding(page);
    // Map is the default view; with a located building the map auto-frames it,
    // and that settle writes the centre+zoom to the URL — so the view is
    // shareable and a later Back restores it (`?c=<lat>,<lng>&z=<zoom>`).
    await page.goto("/buildings");
    await expect(page.locator(".leaflet-marker-icon").first())
      .toBeVisible({ timeout: T.action });
    await expect(page).toHaveURL(/[?&]c=/, { timeout: T.action });
    await expect(page).toHaveURL(/[?&]z=/, { timeout: T.action });
  });

  test("a cold deep-link opens the observation page (incl. its Weather section)", async () => {
    test.setTimeout(T.testSolo);
    if (!id) id = await ensureBuilding(page);
    // No clicking: drive the read path straight from the address, then reload so
    // it's a genuinely COLD load. The observation page is a real route; Weather
    // is a section on it (relocated off the old map "Weather data" tab), shown
    // because this building has coordinates.
    await page.goto(buildingRoute("observation", id));
    await page.reload();
    await expect(page.getByRole("heading", { name: t("secWeather"), exact: true }))
      .toBeVisible({ timeout: T.action });
  });
});
