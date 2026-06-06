import { expect, test } from "@playwright/test";
import { account } from "../helpers/login.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "../helpers/rooms.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  assignUserRole,
  hostRoomAndGetUri,
  joinRoomAsUser,
} from "../helpers/connect.ts";
import { addBuilding, shareByRole } from "../helpers/manage.ts";

/**
 * End-to-end building sharing across TWO throwaway Solid Pods, in ONE test (the
 * data room is the WebID directory, so no WebID is configured):
 *
 *   • write part — A hosts a room + takes the User role; B joins + takes the User
 *     role; A adds a building and shares it "By role" → User (the room resolves the
 *     role to B's WebID);
 *   • a 2 s cooldown;
 *   • read part — B logs in fresh (so `readInbox` archives the grant into B's
 *     `shared-in/`) and sees the building under "Buildings shared with you".
 *
 * Previously split into 4 single-account parts to stay under solidcommunity.net's
 * Cloudflare burst limit; on the reliable Pods (solidweb.org) it runs as one test
 * driving two browser contexts, and cleans up after itself (A deletes its building
 * + room in `finally`). Needs E2E_{USERNAME,PASSWORD}_A and _B; skipped without.
 *   npm run sharing            (headed:  npm run sharing -- --headed)
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
    test.setTimeout(420_000);
    // A and B's first logins are independent (B only needs A's room URI to JOIN,
    // not to log in), so run both ~50 s OIDC flows concurrently — one login's
    // wall-clock instead of two.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
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

      // ── 2 s cooldown between the write part and the read part ──
      await a.page.waitForTimeout(2000);

      // ── Read part: B logs in fresh → readInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        await b2.page.getByRole("tab", { name: "Share" }).click();
        const received = b2.page.getByRole("heading", {
          name: /buildings shared with you/i,
        }).locator("xpath=following-sibling::*[1]");
        try {
          await expect(received.getByText(/^Building /))
            .toBeVisible({ timeout: 120_000 });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
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
            await expect(a.page.getByText("Building deleted").first())
              .toBeVisible({ timeout: 90_000 });
          }
          await deleteAllOwnedRooms(a.page);
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      await a.ctx.close();
    }
  });

  // Catalog gap (PROBLEMS.md #17): share a single year of energy, not the whole
  // building. Sharing currently has only two levels, so this is a tracked gap
  // pending the feature (and an interoperating Pod pair to run against).
  test.fixme(
    "share a single year of energy granularity (PROBLEMS.md #17)",
    () => {},
  );
});
