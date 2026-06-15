import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { exploreRoute, openBuildingsList } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Navigational UI state lives in the URI so a browser reload (or a bookmark)
 * restores the view — see notes/ui-state.md. The active *finder* is the route now
 * (`/buildings`, `/rooms`, …) — no `?tab=`; this proves the route survives a real
 * reload, and that the Buildings-map selected building + detail sub-tab
 * (`?b=`/`?dt=`) survive too. A third test drives a cold deep-link (no clicking) to
 * confirm the read path.
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
    const roomsTab = page.getByRole("tab", { name: "Rooms" });
    await roomsTab.click();
    await expect(roomsTab).toHaveAttribute("aria-selected", "true", {
      timeout: T.action,
    });
    expect(page.url()).toContain("/rooms");

    await page.reload();

    // Same finder after reload — not back on the default Buildings finder.
    await expect(page.getByRole("tab", { name: "Rooms" }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
    expect(page.url()).toContain("/rooms");
  });

  test("the Explore selection + detail tab are restored after a reload", async () => {
    test.setTimeout(T.testSolo);
    id = await ensureBuilding(page);

    await page.goto("/");
    // Buildings tab lands on the Map view (the former Explore) — markers + the
    // selection/detail pane live here. ensureBuilding left the view on List, and
    // the Map/List toggle is local (non-URL) state, so select Map explicitly.
    await page.getByRole("tab", { name: "Buildings" }).click();
    await page.getByRole("button", { name: "Map" }).click();

    // Select the (only) building marker, then open its Energy detail sub-tab.
    const marker = page.locator(".leaflet-marker-icon").first();
    await expect(marker).toBeVisible({ timeout: T.action });
    await marker.click({ force: true });
    const energyTab = page.getByRole("tab", { name: "Energy data" });
    await energyTab.click();
    await expect(energyTab).toHaveAttribute("aria-selected", "true", {
      timeout: T.action,
    });
    expect(page.url()).toContain(`b=${encodeURIComponent(id)}`);
    expect(page.url()).toContain("dt=energy");

    await page.reload();

    // The selection and detail tab come back from the URI on the fresh page.
    await expect(page.getByRole("tab", { name: "Energy data" }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
    expect(page.url()).toContain(`b=${encodeURIComponent(id)}`);
    expect(page.url()).toContain("dt=energy");
  });

  test("a cold deep-link opens the named building + detail tab", async () => {
    test.setTimeout(T.testSolo);
    if (!id) id = await ensureBuilding(page);
    // No clicking: drive the read path straight from the address. Reload so it's a
    // genuinely COLD load — the Buildings tab then defaults to Map (the map/list
    // toggle is local, non-URL state), and the URI's ?b=/?dt= drive the pane.
    await page.goto(exploreRoute(id, "weather"));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Weather data" }))
      .toHaveAttribute("aria-selected", "true", { timeout: T.action });
  });
});
