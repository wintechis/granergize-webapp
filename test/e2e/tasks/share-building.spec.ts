import { expect, test } from "@playwright/test";
import { account } from "../helpers/login.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "../helpers/rooms.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  assignUserRole,
  hostRoomAndGetUri,
  joinRoomAsUser,
} from "../helpers/connect.ts";
import { addBuilding, addEnergyYear, shareByRole } from "../helpers/manage.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * End-to-end building sharing across TWO throwaway Solid Pods, in ONE test (the
 * data room is the WebID directory, so no WebID is configured):
 *
 *   • write part — A hosts a room + takes the User role; B joins + takes the User
 *     role; A adds a building and shares it "By role" → User (the room resolves the
 *     role to B's WebID);
 *   • a 2 s cooldown;
 *   • read part — B logs in fresh (so `drainInbox` archives the grant into B's
 *     `shared-in/`) and sees the building under "Buildings shared with you".
 *
 * Previously split into 4 single-account parts to stay under solidcommunity.net's
 * Cloudflare burst limit; on the reliable Pods (solidweb.org) it runs as one test
 * driving two browser contexts, and cleans up after itself (A deletes its building
 * + room in `finally`). Needs E2E_{USERNAME,PASSWORD}_A and _B; skipped without.
 *   deno task e2e:remote       (runs the solo + sharing projects against real Pods)
 */

const A = account("A");
const B = account("B");
const STREET = "Teilenstraße 7";

// Cross-Pod sharing needs an INTEROPERATING provider pair. NSS↔CSS-v5 (the current
// A/B) don't interoperate, so this SKIPs with a reason; the logic is covered "in
// principle" by the Tier-2 headless `share-building` task (deno task it).
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("sharing across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("A shares a building by role; B sees it under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // A and B's first logins are independent (B only needs A's room URI to JOIN,
    // not to log in), so run both ~50 s OIDC flows concurrently — one login's
    // wall-clock instead of two.
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building/room)
    try {
      // ── Write part: A hosts a room + role, B joins + role, A adds + shares ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);

      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }

      await addBuilding(a.page, STREET);
      await shareByRole(a.page, STREET);

      // ── Producer side: A's Manage row now surfaces the outgoing-share STATE —
      // the "Shared with" badge (the materialized fold of the shared-out/ event
      // log, via getSharedBuildings) with a revoke control + the <AgentLabel>
      // recipient. This is the sharer-side display the suite never asserted; it's
      // shown in default (non-dev) mode, unlike the raw shared-out/ log link.
      // Bounce tabs to force a refetch (sharing doesn't invalidate the query).
      await a.page.getByRole("tab", { name: "Explore" }).click();
      await a.page.getByRole("tab", { name: "Manage" }).click();
      const sharedRow = a.page.locator("li", { hasText: STREET }).first();
      await expect(sharedRow.getByText(/shared with/i))
        .toBeVisible({ timeout: T.action });
      await expect(sharedRow.getByRole("button", { name: "Revoke access" }).first())
        .toBeVisible({ timeout: T.action });

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        const received = b2.page.getByRole("list", {
          name: /buildings shared with you/i,
        });
        try {
          // No blind write→read cooldown: poll B's view, reloading to re-drain the
          // inbox each attempt, until A's grant propagates and folds in.
          await expect(async () => {
            await b2.page.reload();
            await b2.page.getByRole("tab", { name: "Share" }).click();
            await expect(received.getByText(/^Building /))
              .toBeVisible({ timeout: T.action });
          }).toPass({ timeout: T.poll });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }

        // heike-1 / handbuch: B can hide a building shared with them from their
        // OWN dashboard (map + lists) via the eye toggle, without touching the
        // owner's share. The Share-tab row carries a "Shown/Hidden" Switch
        // (gran:hiddenBuilding in prefs.ttl, re-read by getSharedWithMe). B owns
        // nothing, so the shared building is the only Explore marker — a clean
        // signal that hiding removes it from the map and showing brings it back.
        const sharedRow = received.locator("li")
          .filter({ has: b2.page.getByText(/^Building /) }).first();
        const visToggle = sharedRow.getByRole("checkbox"); // the Shown/Hidden Switch
        await expect(sharedRow.getByText("Shown")).toBeVisible({ timeout: T.action });
        const markers = b2.page.locator(".leaflet-marker-icon");

        // Hide → row reads "Hidden" and B's Explore map drops to no markers.
        await visToggle.click();
        await expect(sharedRow.getByText("Hidden")).toBeVisible({ timeout: T.action });
        await b2.page.getByRole("tab", { name: "Explore" }).click();
        await expect(async () => {
          expect(await markers.count()).toBe(0);
        }).toPass({ timeout: T.poll });

        // Show → row reads "Shown" again and the marker returns.
        await b2.page.getByRole("tab", { name: "Share" }).click();
        await expect(sharedRow.getByText("Hidden")).toBeVisible({ timeout: T.action });
        await visToggle.click();
        await expect(sharedRow.getByText("Shown")).toBeVisible({ timeout: T.action });
        await b2.page.getByRole("tab", { name: "Explore" }).click();
        await expect(markers.first()).toBeVisible({ timeout: T.action });
      } finally {
        // Drop B's bookmark of A's room so it doesn't leak on B's Pod.
        await removeAllBookmarkedRooms(b2.page);
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building + the room it hosted (best-effort).
      try {
        if (!a.page.isClosed()) {
          await a.page.getByRole("tab", { name: "Manage" }).click();
          const row = a.page.locator("li", { hasText: STREET }).first();
          if (await row.count()) {
            await row.getByRole("button", { name: "Delete building" }).click();
            await confirmDialog(a.page, "Delete");
            await expect(a.page.getByText("Building deleted").first())
              .toBeVisible({ timeout: T.action });
          }
          await deleteAllOwnedRooms(a.page);
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  // PROBLEMS.md #17: share a single YEAR of energy, not all of it. A's building
  // carries two annual years (2098, 2099); A grants only 2099 via the per-year
  // picker. The crux is the recipient side: B can read 2099 but is denied 2098 —
  // the building file lists both `cons:hasEnergyDataset` links (B reads the file),
  // but only 2099's dataset .acl grants B, so 2098 403s and AnnualEnergy skips
  // it. The map's Energy tab renders AnnualEnergy's per-year table, so both the
  // present (2099) and the withheld (2098) year are observable in one view.
  const STREET_Y = "Jahrgasse 9"; // distinct from the all-energy test's building
  const SHARED_YEAR = "2099";
  const WITHHELD_YEAR = "2098";

  test("A shares one year of energy; B sees that year but not the withheld one", async ({ browser }) => {
    test.setTimeout(T.longOp);
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building/room)
    try {
      // ── Write part: A hosts a room + role, B joins + role ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);

      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }

      // ── A adds a building with two annual years, shares only the later one ──
      await addBuilding(a.page, STREET_Y);
      await addEnergyYear(a.page, STREET_Y, WITHHELD_YEAR, "11111");
      await addEnergyYear(a.page, STREET_Y, SHARED_YEAR, "22222");
      await shareByRole(a.page, STREET_Y, [Number(SHARED_YEAR)]);

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        // B owns no buildings (none seeded), so the shared one is the only marker.
        // No blind write→read cooldown: poll, reloading to re-drain the inbox each
        // attempt, until the shared marker propagates and renders.
        const markers = b2.page.locator(".leaflet-marker-icon");
        await expect(async () => {
          await b2.page.reload();
          await b2.page.getByRole("tab", { name: "Explore" }).click();
          await expect(markers.first()).toBeVisible({ timeout: T.action });
        }).toPass({ timeout: T.poll });

        // Open the building's detail pane → Energy tab (AnnualEnergy per-year table).
        // No blind map-settle wait: click each marker until the Energy tab appears,
        // letting toPass pace the retries (it returns the instant the pane opens).
        const energyTab = b2.page.getByRole("tab", { name: "Energy data" });
        await expect(async () => {
          const count = await markers.count();
          for (let i = 0; i < count; i++) {
            await markers.nth(i).click({ force: true }).catch(() => {});
            if (await energyTab.isVisible().catch(() => false)) return;
          }
          throw new Error("building detail (Energy tab) not open yet");
        }).toPass({ timeout: T.poll });
        await energyTab.click();

        try {
          // The granted year renders as an AnnualEnergy row with its electricity
          // figure (de-DE "22.222", 0 decimals)...
          const grantedRow = b2.page.getByRole("row", {
            name: new RegExp(SHARED_YEAR),
          });
          await expect(grantedRow).toBeVisible({ timeout: T.action });
          await expect(grantedRow.getByText("22.222")).toBeVisible();
          // ...the withheld year's dataset 403s for B, so it never appears.
          await expect(
            b2.page.getByRole("cell", { name: WITHHELD_YEAR, exact: true }),
          ).toHaveCount(0);
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await removeAllBookmarkedRooms(b2.page);
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building + the room it hosted (best-effort).
      try {
        if (!a.page.isClosed()) {
          await a.page.getByRole("tab", { name: "Manage" }).click();
          const row = a.page.locator("li", { hasText: STREET_Y }).first();
          if (await row.count()) {
            await row.getByRole("button", { name: "Delete building" }).click();
            await confirmDialog(a.page, "Delete");
            await expect(a.page.getByText("Building deleted").first())
              .toBeVisible({ timeout: T.action });
          }
          await deleteAllOwnedRooms(a.page);
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  // When A DELETES a shared building, B must lose it cleanly: deletion revokes the
  // recipient first (logs the revocation, withdraws the ACL, notifies the inbox),
  // so after B drains the inbox the building folds out of "Buildings shared with
  // you" — it doesn't linger until a later 404-prune. (Tier-1 + Tier-2 cover the
  // data layer; this is the in-practice browser check.)
  const STREET_D = "Entfernweg 3";

  test("A deletes a shared building; B no longer sees it under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // delete-building confirm + cleanup
    try {
      // ── Write part: A hosts a room + role, B joins + role, A adds + shares ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);
      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }
      await addBuilding(a.page, STREET_D);
      await shareByRole(a.page, STREET_D);

      // ── B logs in fresh once → drainInbox archives the grant → B sees it ──
      // The SAME B context is reused for the after-delete re-check: a reload
      // re-runs drainInbox (Login.tsx restores the session → "login" → handleLogin
      // → drainInbox), so B drains the revocation without a second ~OIDC login.
      const b = await freshPage(browser, B);
      try {
        await b.page.getByRole("tab", { name: "Share" }).click();
        const received = () =>
          b.page.getByRole("list", { name: /buildings shared with you/i });
        try {
          await expect(received().getByText(/^Building /))
            .toBeVisible({ timeout: T.action });
        } catch (timeout) {
          b.guard.assertNoAppErrors();
          throw timeout;
        }

        // ── A deletes the shared building (revokes B + posts the inbox notice) ──
        await a.page.getByRole("tab", { name: "Manage" }).click();
        const row = a.page.locator("li", { hasText: STREET_D }).first();
        await row.getByRole("button", { name: "Delete building" }).click();
        await confirmDialog(a.page, "Delete");
        await expect(a.page.getByText("Building deleted").first())
          .toBeVisible({ timeout: T.action });
        // ── B reloads → drainInbox drains the revocation → it folds out. No blind
        //    settle wait: reload inside the poll so each attempt re-drains. ──
        try {
          // B owned nothing else, so the received list must have no building rows.
          await expect(async () => {
            await b.page.reload();
            await b.page.getByRole("tab", { name: "Share" }).click();
            expect(await received().getByText(/^Building /).count()).toBe(0);
          }).toPass({ timeout: T.poll });
        } catch (timeout) {
          b.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await removeAllBookmarkedRooms(b.page);
        await b.ctx.close();
      }
    } finally {
      // Building already deleted by the test; just drop the room A hosted.
      try {
        if (!a.page.isClosed()) await deleteAllOwnedRooms(a.page);
      } catch { /* best-effort cleanup */ }
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
