import { expect, test } from "@playwright/test";
import { account } from "../helpers/login.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "../helpers/rooms.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { freshPage } from "../helpers/twoPod.ts";
import {
  assignUserRole,
  hostRoomAndGetUri,
  joinRoomAsUser,
} from "../helpers/connect.ts";
import { ensureView, receivedViews, VIEW_NAME } from "../helpers/manage.ts";
import { logCollectionState, wipeCollection } from "../helpers/cleanSlate.ts";

/**
 * Aggregated-VIEW sharing across TWO throwaway Pods (PROBLEMS.md #17 + #21), in
 * ONE test (the data room is the WebID directory, so no WebID is configured):
 *
 *   • A hosts a room + role; B joins + role; A creates a view and shares it with B
 *     via the dialog's room-members "Add" (ShareViewDialog has no "by role");
 *   • 2 s cooldown → B sees it under "Views shared with you" and the values render;
 *   • A deletes the view (revokes + notifies B via `revokeAllViewRecipients`);
 *   • 2 s cooldown → B no longer sees it (the revocation folded it out).
 *
 * Was 6 single-account parts to stay under solidcommunity.net's Cloudflare burst
 * limit; on reliable Pods it runs as one test driving two contexts, self-cleaning
 * (the view is deleted as part of the flow; A's room in `finally`). Needs
 * E2E_{USERNAME,PASSWORD}_A and _B; skipped without them.
 */

const A = account("A");
const B = account("B");

// Cross-Pod view sharing needs an INTEROPERATING provider pair (see share-building).
// Skips on NSS↔CSS-v5; the logic is covered by the Tier-2 headless `share-view` task.
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("view sharing across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("A shares a view; B sees it, then A deletes it and B no longer sees it", async ({ browser }) => {
    test.setTimeout(660_000);
    const a = await freshPage(browser, A);
    a.page.on("dialog", (d) => d.accept()); // Delete view / room confirms
    try {
      // Clean slate for A before any writes (reload re-provisions the inbox).
      await wipeCollection(a.page, { reload: true, tag: "share-view:A" });
      // ── A hosts a room + role; B joins + role; A creates + shares the view ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);

      const b1 = await freshPage(browser, B);
      // Clean slate for B before it joins/receives anything.
      await wipeCollection(b1.page, { reload: true, tag: "share-view:B" });
      try {
        await joinRoomAsUser(b1.page, roomUri);
      } finally {
        await b1.ctx.close();
      }

      // A needs buildings to build an aggregated view from — self-seed an empty
      // (e.g. freshly-wiped) Pod so ensureView's building picker isn't empty.
      await ensureDemoBuildings(a.page);
      await ensureView(a.page);
      const viewRow = a.page.locator("li").filter({ hasText: VIEW_NAME }).first();
      const shareDlg = a.page.getByRole("dialog");
      const add = shareDlg.getByRole("button", { name: /^add$/i });
      // Add B from the room-members list (B joined + took a role above). The
      // dialog loads members ONCE on open, asynchronously, so the "Add" row only
      // appears a moment AFTER the dialog is visible — use a WAITING assertion for
      // it (`locator.isVisible()` does NOT wait; its `timeout` arg is a no-op, so an
      // immediate check always races the async member load). Re-open between waits
      // so a member that's still propagating on a remote Pod (Tier 4) is re-read.
      await expect(async () => {
        if (!(await shareDlg.isVisible().catch(() => false))) {
          await viewRow.getByRole("button", { name: "Share view" }).click();
          await expect(shareDlg).toBeVisible({ timeout: 10_000 });
        }
        try {
          await expect(add.first()).toBeVisible({ timeout: 15_000 });
          return;
        } catch {
          // Not yet — close so the next iteration re-opens and re-runs loadMembers.
          await shareDlg.getByRole("button", { name: /close/i }).click();
          await expect(shareDlg).toBeHidden({ timeout: 5_000 }).catch(() => {});
          throw new Error("B not yet listed as a room member");
        }
      }).toPass({ timeout: 120_000 });
      await add.first().click();
      const confirm = shareDlg.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      await expect(shareDlg.getByText(/shared successfully/i))
        .toBeVisible({ timeout: 120_000 });
      await shareDlg.getByRole("button", { name: /close/i }).click();

      // ── 2 s cooldown → B sees the view + its values ──
      await a.page.waitForTimeout(2000);
      const b2 = await freshPage(browser, B);
      try {
        await b2.page.getByRole("tab", { name: "Share" }).click();
        try {
          await expect(receivedViews(b2.page).getByText(VIEW_NAME))
            .toBeVisible({ timeout: 120_000 });
          await b2.page.getByRole("button", { name: /show values/i }).first()
            .click();
          await expect(b2.page.locator("svg.recharts-surface").first())
            .toBeVisible({ timeout: 60_000 });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await b2.ctx.close();
      }

      // ── A deletes the view (revokes + notifies B) ──
      await a.page.getByRole("tab", { name: "Manage" }).click();
      await a.page.waitForLoadState("networkidle").catch(() => {});
      const del = a.page.locator("li").filter({ hasText: VIEW_NAME })
        .getByRole("button", { name: "Delete view" });
      for (let i = 0; i < 10; i++) {
        if (!(await del.count())) break;
        await del.first().click();
        await expect(a.page.getByText("View deleted").first())
          .toBeVisible({ timeout: 45_000 }).catch(() => {});
      }

      // ── 2 s cooldown → B no longer sees the view ──
      await a.page.waitForTimeout(2000);
      const b3 = await freshPage(browser, B);
      try {
        await b3.page.getByRole("tab", { name: "Share" }).click();
        try {
          // Positive empty-state assertion: the section's empty notice is shown
          // (the list is absent when empty) AND the view is gone.
          await expect(
            b3.page.getByText(
              /no aggregated views have been shared with you/i,
            ),
          ).toBeVisible({ timeout: 120_000 });
          await expect(receivedViews(b3.page).getByText(VIEW_NAME)).toHaveCount(0);
        } catch (timeout) {
          b3.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        // Drop B's bookmark of A's room so it doesn't leak on B's Pod.
        await removeAllBookmarkedRooms(b3.page);
        await b3.ctx.close();
      }
    } finally {
      // Self-cleaning: the view was deleted above; tear down A's room.
      try {
        if (!a.page.isClosed()) await deleteAllOwnedRooms(a.page);
      } catch {
        // best-effort cleanup; never fail the run
      }
      await logCollectionState(a.page, "share-view"); // verify A's cleanup
      await a.ctx.close();
    }
  });
});
