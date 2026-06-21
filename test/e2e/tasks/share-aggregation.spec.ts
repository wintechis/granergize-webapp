import { expect, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import {
  deleteAllOwnedRooms,
  removeAllBookmarkedRooms,
} from "../helpers/rooms.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  assignUserRole,
  hostRoomAndGetUri,
  joinRoomAsUser,
} from "../helpers/connect.ts";
import {
  AGGREGATION_NAME,
  aggregationsList,
  ensureAggregation,
  openAggregations,
  shareAggregationByWebId,
} from "../helpers/manage.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Aggregation sharing across TWO throwaway Pods (PROBLEMS.md #17 + #21), both ways
 * a recipient can be addressed (mirrors share-building / share-files):
 *
 *   • DIRECT (By WebID) — the simple DUO: A already knows B's WebID and types it
 *     into the share dialog's recipient field — no data room;
 *   • VIA A DATA ROOM — A hosts a room + role; B joins + role; A shares the
 *     aggregation with B via the dialog's room-members "Add" (the room resolves
 *     membership to B's WebID). This test also covers the delete-revoke tail:
 *   • B reloads (re-draining the inbox) until it appears under "Aggregations shared with
 *     you" and the values render;
 *   • A deletes the aggregation (revokes + notifies B via `revokeAllAggregationRecipients`);
 *   • B reloads until it no longer sees it (the revocation folded it out).
 *
 * Was 6 single-account parts to stay under solidcommunity.net's Cloudflare burst
 * limit; on reliable Pods it runs as one test driving two contexts, self-cleaning
 * (the aggregation is deleted as part of the flow; A's room in `finally`). Needs
 * E2E_{USERNAME,PASSWORD}_A and _B; skipped without them.
 */

const A = account("A");
const B = account("B");

// Cross-Pod aggregation sharing needs an INTEROPERATING provider pair (see share-building).
// Skips on NSS↔CSS-v5; the logic is covered by the Tier-2 headless `share-aggregation` task.
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("aggregation sharing across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("A shares an aggregation by WebID; B sees it under Aggregations shared with you", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // The SIMPLE DUO: A already holds B's WebID, so it shares the aggregation
    // straight to it — no data room. A's seed-buildings + build-aggregation takes
    // long enough that B's inbox is provisioned by share time; keep B's first
    // session open through the share, then B re-logs in fresh to drain the grant.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    a.page.on("dialog", (d) => d.accept()); // Delete aggregation confirms
    try {
      await assertCleanStart(a.page, "share-aggregation:A");
      await assertCleanStart(b1.page, "share-aggregation:B");
      const bWebId = await webIdOf(b1.page);

      // A self-seeds buildings (so the aggregation picker isn't empty) + builds
      // the aggregation, then shares it directly to B's WebID.
      await ensureDemoBuildings(a.page);
      await ensureAggregation(a.page);
      await shareAggregationByWebId(a.page, bWebId);
      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below

      const b2 = await freshPage(browser, B);
      try {
        await reloadUntil(b2.page, async () => {
          await openAggregations(b2.page);
          await expect(aggregationsList(b2.page).getByText(AGGREGATION_NAME))
            .toBeVisible({ timeout: T.quick });
          // Show-values + chart render INSIDE the reload loop: B's value fetch is
          // cross-Pod, so a transient failure under load must re-fetch on the next
          // reload, not fail a one-shot wait.
          await b2.page.getByRole("button", { name: t("shareShowValues") }).first()
            .click();
          await expect(b2.page.locator("svg.recharts-surface").first())
            .toBeVisible({ timeout: T.visible });
        });
      } catch (timeout) {
        b2.guard.assertNoAppErrors();
        throw timeout;
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
      // Self-cleaning: delete the aggregation A created (no room — direct share).
      try {
        if (!a.page.isClosed()) {
          await openAggregations(a.page);
          await a.page.waitForLoadState("networkidle").catch(() => {});
          const del = a.page.locator("li").filter({ hasText: AGGREGATION_NAME })
            .getByRole("button", { name: t("aggDeleteAria") });
          for (let i = 0; i < 10; i++) {
            if (!(await del.count())) break;
            await del.first().click();
            await confirmDialog(a.page, "Delete");
            await expect(a.page.getByText(t("aggregationDeleted")).first())
              .toBeVisible({ timeout: T.action }).catch(() => {});
          }
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-aggregation");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  test("A shares an aggregation; B sees it, then A deletes it and B no longer sees it", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // Log A and B in ONCE each. B's three phases (join, see the shared aggregation, see it
    // gone) don't need fresh OIDC logins — each phase only needs B to RE-FETCH the
    // shared state from a cold cache, which `b.page.reload()` does: the silent session
    // restore re-fires `onLogin`, draining B's inbox and invalidating the
    // receivedAggregations query, exactly like a login but without the ~login-long OIDC cost.
    // The only separation that's actually required is A vs B (distinct WebIDs), not
    // B-phase vs B-phase — so one reused B context replaces the old four B logins.
    const [a, b] = await freshPagesParallel(browser, [A, B]);
    a.page.on("dialog", (d) => d.accept()); // Delete aggregation / room confirms
    try {
      await assertCleanStart(a.page, "share-aggregation:A");
      await assertCleanStart(b.page, "share-aggregation:B");
      // ── A hosts a room + role; B joins + role; A creates + shares the aggregation ──
      const roomUri = await hostRoomAndGetUri(a.page);
      await assignUserRole(a.page, roomUri);
      await joinRoomAsUser(b.page, roomUri);

      // A needs buildings to build an aggregation from — self-seed an empty
      // (e.g. freshly-wiped) Pod so ensureAggregation's building picker isn't empty.
      // Must be INVESTOR: ensureAggregation creates an Investor aggregation, and CreateAggregationDialog
      // only offers roles that exist among the buildings' provenance — a "user"
      // building would leave the Role dropdown without an "Investor" option, so
      // ensureAggregation's role selection would hang.
      await ensureDemoBuildings(a.page);
      await ensureAggregation(a.page);
      const aggregationRow = a.page.locator("li").filter({ hasText: AGGREGATION_NAME })
        .first();
      // Scope to the SHARE dialog by its title: a generic role=dialog locator
      // once bound to the CreateAggregationDialog mid close-transition, so the poll
      // below skipped its "Share aggregation" click and waited its whole budget on a
      // dialog that no longer existed.
      const shareDlg = a.page.getByRole("dialog")
        .filter({ hasText: t("shareAggTitle", { name: AGGREGATION_NAME }) });
      const add = shareDlg.getByRole("button", { name: t("btnAdd"), exact: true });
      // Add B from the room-members list (B joined + took a role above). The
      // dialog loads members ONCE on open, asynchronously, so the "Add" row only
      // appears a moment AFTER the dialog is visible — use a WAITING assertion for
      // it (`locator.isVisible()` does NOT wait; its `timeout` arg is a no-op, so an
      // immediate check always races the async member load). Re-open between waits
      // so a member that's still propagating on a remote Pod (Tier 4) is re-read.
      await expect(async () => {
        if (!(await shareDlg.isVisible().catch(() => false))) {
          await aggregationRow.getByRole("button", { name: t("aggShareAria") }).click();
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
          await shareDlg.getByRole("button", { name: t("btnClose"), exact: true })
            .click({ timeout: T.quick }).catch(() => {});
          await expect(shareDlg).toBeHidden({ timeout: T.quick }).catch(
            () => {},
          );
          throw new Error("B not yet listed as a room member");
        }
      }).toPass({ timeout: T.poll });
      await add.first().click();
      const confirm = shareDlg.getByRole("button", { name: t("shareConfirmShare") });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: t("shareReviewAndShare") })
          .click();
        await expect(confirm).toBeVisible({ timeout: T.quick });
      }).toPass({ timeout: T.poll });
      await confirm.click();
      await expect(shareDlg.getByText(t("shareSuccessWith")))
        .toBeVisible({ timeout: T.action });
      await shareDlg.getByRole("button", { name: t("btnClose"), exact: true }).click();

      // ── B reloads (cold re-fetch, re-draining the inbox) until the shared aggregation
      //    propagates and folds in, then reads its values — no blind cooldown ──
      try {
        await reloadUntil(b.page, async () => {
          await openAggregations(b.page);
          await expect(aggregationsList(b.page).getByText(AGGREGATION_NAME))
            .toBeVisible({ timeout: T.quick });
          // Show-values + chart render INSIDE the reload loop: B's value fetch is
          // cross-Pod, so a transient failure under load must re-fetch on the next
          // reload, not fail a one-shot wait.
          await b.page.getByRole("button", { name: t("shareShowValues") }).first()
            .click();
          await expect(b.page.locator("svg.recharts-surface").first())
            .toBeVisible({ timeout: T.visible });
        });
      } catch (timeout) {
        b.guard.assertNoAppErrors();
        throw timeout;
      }

      // ── A deletes the aggregation (revokes + notifies B) ──
      await openAggregations(a.page);
      await a.page.waitForLoadState("networkidle").catch(() => {});
      const del = a.page.locator("li").filter({ hasText: AGGREGATION_NAME })
        .getByRole("button", { name: t("aggDeleteAria") });
      for (let i = 0; i < 10; i++) {
        if (!(await del.count())) break;
        await del.first().click();
        await confirmDialog(a.page, "Delete");
        await expect(a.page.getByText(t("aggregationDeleted")).first())
          .toBeVisible({ timeout: T.action }).catch(() => {});
      }

      // ── B reloads (cold re-fetch, re-draining the revocation) until the aggregation
      //    folds out — no blind cooldown ──
      try {
        // After the revocation folds out, the aggregation is gone from B's
        // Aggregations finder (B holds no own aggregations, so the list empties).
        await reloadUntil(b.page, async () => {
          await openAggregations(b.page);
          await expect(aggregationsList(b.page).getByText(AGGREGATION_NAME))
            .toHaveCount(0, { timeout: T.quick });
        });
      } catch (timeout) {
        b.guard.assertNoAppErrors();
        throw timeout;
      }
    } finally {
      // Self-cleaning: the aggregation was deleted above; tear down A's room and drop B's
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
        await verifyAndResetBoth(a.page, b.page, "share-aggregation");
      } finally {
        await b.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
