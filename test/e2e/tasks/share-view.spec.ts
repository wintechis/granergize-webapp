import { expect, test } from "@playwright/test";
import { account } from "../helpers/login.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { deleteAllOwnedRooms, removeAllBookmarkedRooms } from "../helpers/rooms.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { freshPagesParallel } from "../helpers/twoPod.ts";
import {
  assignUserRole,
  hostRoomAndGetUri,
  joinRoomAsUser,
} from "../helpers/connect.ts";
import { ensureView, receivedViews, VIEW_NAME } from "../helpers/manage.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

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
    test.setTimeout(T.testSharing);
    // Log A and B in ONCE each. B's three phases (join, see the shared view, see it
    // gone) don't need fresh OIDC logins — each phase only needs B to RE-FETCH the
    // shared state from a cold cache, which `b.page.reload()` does: the silent session
    // restore re-fires `onLogin`, draining B's inbox and invalidating the
    // receivedViews query, exactly like a login but without the ~login-long OIDC cost.
    // The only separation that's actually required is A vs B (distinct WebIDs), not
    // B-phase vs B-phase — so one reused B context replaces the old four B logins.
    const [a, b] = await freshPagesParallel(browser, [A, B]);
    a.page.on("dialog", (d) => d.accept()); // Delete view / room confirms
    try {
      await assertCleanStart(a.page, "share-view:A");
      await assertCleanStart(b.page, "share-view:B");
      // ── A hosts a room + role; B joins + role; A creates + shares the view ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page);
      await joinRoomAsUser(b.page, roomUri);

      // A needs buildings to build an aggregated view from — self-seed an empty
      // (e.g. freshly-wiped) Pod so ensureView's building picker isn't empty.
      // Must be INVESTOR: ensureView creates an Investor view, and CreateViewDialog
      // only offers roles that exist among the buildings' provenance — a "user"
      // building would leave the Role dropdown without an "Investor" option, so
      // ensureView's role selection would hang.
      await ensureDemoBuildings(a.page);
      await ensureView(a.page);
      const viewRow = a.page.locator("li").filter({ hasText: VIEW_NAME }).first();
      // Scope to the SHARE dialog by its title: a generic role=dialog locator
      // once bound to the CreateViewDialog mid close-transition, so the poll
      // below skipped its "Share view" click and waited its whole budget on a
      // dialog that no longer existed.
      const shareDlg = a.page.getByRole("dialog")
        .filter({ hasText: `Share "${VIEW_NAME}"` });
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
          await expect(shareDlg).toBeVisible({ timeout: T.quick });
        }
        try {
          await expect(add.first()).toBeVisible({ timeout: T.visible });
          return;
        } catch {
          // Not yet — close so the next iteration re-opens and re-reads the
          // members. Bound + tolerate the click: if the dialog vanished since
          // the visibility check, an unbounded click would wedge this and
          // every remaining poll iteration (it did — see the trace notes).
          await shareDlg.getByRole("button", { name: /close/i })
            .click({ timeout: T.quick }).catch(() => {});
          await expect(shareDlg).toBeHidden({ timeout: T.quick }).catch(() => {});
          throw new Error("B not yet listed as a room member");
        }
      }).toPass({ timeout: T.poll });
      await add.first().click();
      const confirm = shareDlg.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: T.quick });
      }).toPass({ timeout: T.poll });
      await confirm.click();
      await expect(shareDlg.getByText(/shared successfully/i))
        .toBeVisible({ timeout: T.action });
      await shareDlg.getByRole("button", { name: /close/i }).click();

      // ── 2 s cooldown → B reloads (cold re-fetch) and sees the view + its values ──
      await a.page.waitForTimeout(2000);
      await b.page.reload();
      await b.page.getByRole("tab", { name: "Share" }).click();
      try {
        await expect(receivedViews(b.page).getByText(VIEW_NAME))
          .toBeVisible({ timeout: T.action });
        await b.page.getByRole("button", { name: /show values/i }).first()
          .click();
        await expect(b.page.locator("svg.recharts-surface").first())
          .toBeVisible({ timeout: T.action });
      } catch (timeout) {
        b.guard.assertNoAppErrors();
        throw timeout;
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
          .toBeVisible({ timeout: T.action }).catch(() => {});
      }

      // ── 2 s cooldown → B reloads (cold re-fetch) and no longer sees the view ──
      await a.page.waitForTimeout(2000);
      await b.page.reload();
      await b.page.getByRole("tab", { name: "Share" }).click();
      try {
        // Positive empty-state assertion: the section's empty notice is shown
        // (the list is absent when empty) AND the view is gone.
        await expect(
          b.page.getByText(
            /no aggregated views have been shared with you/i,
          ),
        ).toBeVisible({ timeout: T.action });
        await expect(receivedViews(b.page).getByText(VIEW_NAME)).toHaveCount(0);
      } catch (timeout) {
        b.guard.assertNoAppErrors();
        throw timeout;
      }
    } finally {
      // Self-cleaning: the view was deleted above; tear down A's room and drop B's
      // bookmark of it so neither leaks on its Pod.
      try {
        if (!a.page.isClosed()) await deleteAllOwnedRooms(a.page);
      } catch {
        // best-effort cleanup; never fail the run
      }
      try {
        if (!b.page.isClosed()) await removeAllBookmarkedRooms(b.page);
      } catch {
        // best-effort cleanup; never fail the run
      }
      // Leave both Pods empty — the per-run collection is removed entirely on each.
      try {
        await verifyAndResetBoth(a.page, b.page, "share-view");
      } finally {
        await b.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
