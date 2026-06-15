import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { buildingRoute, openBuildingsList } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Navigational UI state lives in the URI so a browser reload (or a bookmark)
 * restores the view — see notes/ui-state.md. The active *finder* is the route now
 * (`/buildings`, `/rooms`, …) — no `?tab=`; this proves the route survives a real
 * reload. The standalone detail pages are real routes too: a cold deep-link to
 * `/building/:id` and `/observation/:id` (no clicking) opens them after a reload,
 * and the observation page's Weather section deep-links the same way. (The map is
 * a pure finder now — a marker click NAVIGATES to `/building/:id`; the old
 * `?b=`/`?dt=` map-detail sub-state is gone.)
 *
 * The tab test needs no data, so it runs first and is independent of the (Tier-3
 * CSS) write flakiness. The selection tests add one throwaway building idempotently
 * (retried), deleted in afterAll. Selecting the single marker assumes a pristine
 * collection — the per-spec CSS reset (Tier 3) / per-run granergize-e2e-<uuid>
 * (Tier 4).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/uri-state.spec.ts
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
    await page.getByRole("button", { name: "Add Building", exact: true }).first()
      .click();
    const add = page.getByRole("dialog");
    await add.getByLabel(/street address/i).fill(ADDR);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
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
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the uri-state e2e.`,
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

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    try {
      if (!page.isClosed()) {
        await page.goto("/");
        await openBuildingsList(page);
        const row = page.locator("li", { hasText: ADDR }).first();
        if (await row.count()) {
          await row.getByRole("button", { name: "Delete building" }).click();
          await confirmDialog(page, "Delete");
          await expect(page.getByText("Building deleted").first())
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
    // Pick a non-default finder (Rooms) — the app lands on /buildings, so
    // restoring Rooms proves the route round-trips, not just the default.
    const roomsTab = page.getByRole("tab", { name: "Meet" });
    await roomsTab.click();
    await expect(roomsTab).toHaveAttribute("aria-selected", "true", {
      timeout: T.action,
    });
    expect(page.url()).toContain("/rooms");

    await page.reload();

    // Same finder after reload — not back on the default Buildings finder.
    await expect(page.getByRole("tab", { name: "Meet" }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
    expect(page.url()).toContain("/rooms");
  });

  test("a marker click navigates to the building page (and survives reload)", async () => {
    test.setTimeout(T.testSolo);
    id = await ensureBuilding(page);

    await page.goto("/");
    // Buildings tab lands on the Map view (the former Explore) — markers live
    // here. The Map/List view is URL state (`?view=list`; Map is the implicit
    // default), and goto("/") drops the query, so we're already on Map; the
    // explicit toggle is belt-and-suspenders.
    await page.getByRole("tab", { name: "Buildings" }).click();
    await page.getByRole("button", { name: "Map" }).click();

    // The map is a pure finder: clicking the (only) marker NAVIGATES to the
    // building's standalone page — a real route (`/building/:id`).
    const marker = page.locator(".leaflet-marker-icon").first();
    await expect(marker).toBeVisible({ timeout: T.action });
    await marker.click({ force: true });
    await page.waitForURL(/\/building\//, { timeout: T.action });
    expect(page.url()).toContain(`/building/${encodeURIComponent(id)}`);

    // The route is a genuine path, so a reload restores it (the silent-redirect
    // restore that the standalone routes depend on — see notes/ui-state.md).
    await page.reload();
    await expect(page).toHaveURL(/\/building\//, { timeout: T.action });
    expect(page.url()).toContain(`/building/${encodeURIComponent(id)}`);
  });

  test("the Map ⇄ List view is restored from the URL after reload", async () => {
    test.setTimeout(T.testSolo);
    if (!id) id = await ensureBuilding(page);
    await page.goto("/buildings");
    // List is URL state now (?view=list) — switching writes it.
    await page.getByRole("button", { name: "List" }).click();
    await expect(page).toHaveURL(/view=list/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: T.action });
    // A genuine reload restores List — not the default Map.
    await page.reload();
    await expect(page).toHaveURL(/view=list/, { timeout: T.action });
    await expect(page.getByRole("heading", { name: "Your buildings" }))
      .toBeVisible({ timeout: T.action });
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
    await expect(page.getByRole("heading", { name: "Weather", exact: true }))
      .toBeVisible({ timeout: T.action });
  });
});
