import { expect, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { confirmDialog } from "../helpers/confirm.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  AGGREGATION_NAME,
  aggregationsList,
  openAggregations,
} from "../helpers/manage.ts";
import { runPaletteCommand } from "../helpers/palette.ts";
import { ACTION_PARAM } from "../../../src/routes.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "Build a benchmark and share it back", driven through the registry-driven
 * surfaces (plan-palette §"e2e — anchored in competency tasks": "via the palette /
 * the registry-driven menu"). Two throwaway Pods:
 *
 *   1. CREATE — A opens the ⌘K command palette in the shell and selects "Create
 *      aggregation"; the palette routes to Explore's saved-views projection
 *      (`/observations?view=aggregations&action=create-aggregation`),
 *      auto-opening the CreateAggregationDialog. A names the aggregation, picks a
 *      building, and creates it. (CreateAggregation is an always-applicable
 *      collection verb, so it IS reachable from ⌘K in the shell with no focus.)
 *   2. SHARE BACK — A shares the aggregation snapshot with B through the
 *      catalog-driven `ObjectActions` row action on the Aggregations finder (the
 *      "Share aggregation" icon button, whose handler — keyed by the registry's
 *      `ShareAggregation` intent — opens the ShareAggregationDialog). Both legs ride
 *      the registry, not a bespoke one-off control. B logs in fresh, drains, and
 *      sees it under "Aggregations shared with you".
 *
 * The `ShareAggregation` verb is surfaced through the registry-driven menu (it has a
 * handler on the finder row), unlike the building-page rich verbs that need
 * `?action=` routing — so this leg exercises the palette family directly in the
 * shell. Mirrors share-aggregation.spec for the seed/share/drain shape.
 *
 *   # tier 4 (real, interoperating Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/duo/palette-benchmark-share.spec.ts
 *
 * Needs E2E_{USERNAME,PASSWORD}_A and _B and an INTEROPERATING provider pair; skips
 * otherwise (covered "in principle" by the Tier-2 headless share-aggregation task).
 */

const A = account("A");
const B = account("B");

const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("palette: build a benchmark and share it back across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("⌘K → Create aggregation, then registry menu → Share aggregation; B sees it", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    a.page.on("dialog", (d) => d.accept()); // Delete aggregation confirms
    try {
      await assertCleanStart(a.page, "palette-benchmark-share:A");
      await assertCleanStart(b1.page, "palette-benchmark-share:B");
      const bWebId = await webIdOf(b1.page);

      // A self-seeds buildings so the aggregation picker isn't empty.
      await ensureDemoBuildings(a.page);

      // ── Step 1: create the aggregation through the ⌘K palette ──
      await a.page.goto("/");
      await openAggregations(a.page);
      await runPaletteCommand(a.page, t("aggCreateTitle"), tPattern("aggCreateTitle"));

      // The palette routed to the saved-views projection with
      // ?action=create-aggregation, auto-opening
      // the dialog.
      await expect(a.page).toHaveURL(
        new RegExp(`${ACTION_PARAM}=create-aggregation`),
      );
      const create = a.page.getByRole("dialog");
      await expect(create).toBeVisible({ timeout: T.action });
      await create.getByLabel(t("aggNameLabel")).fill(AGGREGATION_NAME);
      await create.getByLabel(t("aggSelectBuildings")).click();
      const firstBuilding = a.page.getByRole("option").first();
      await expect(firstBuilding, "a building to add to the aggregation")
        .toBeVisible({ timeout: T.visible });
      await firstBuilding.click();
      await a.page.keyboard.press("Escape");
      await create.getByRole("button", { name: t("aggCreateTitle") }).click();
      // The aggregation appears in the list; the dialog closes (don't await the
      // transient toast — the single FIFO snackbar may be mid-showing provisioning).
      const aggRow = a.page.locator("li").filter({ hasText: AGGREGATION_NAME })
        .first();
      await expect(aggRow).toBeVisible({ timeout: T.action });
      await expect(create).toBeHidden({ timeout: T.quick });

      // ── Step 2: share it back via the catalog-driven ObjectActions ──
      // The "Share aggregation" row action is the registry's ShareAggregation
      // intent (label intentShareAggregation), whose handler opens the dialog.
      await aggRow.getByRole("button", { name: t("intentShareAggregation") })
        .click();
      const share = a.page.getByRole("dialog")
        .filter({ hasText: t("shareAggTitle", { name: AGGREGATION_NAME }) });
      await expect(share).toBeVisible({ timeout: T.action });
      const recipientInput = share.getByLabel(t("racLabel"));
      await recipientInput.fill(bWebId);
      await recipientInput.press("Enter");
      const confirm = share.getByRole("button", { name: t("shareConfirmShare") });
      await expect(async () => {
        await share.getByRole("button", { name: t("shareReviewAndShare") }).click();
        await expect(confirm).toBeVisible({ timeout: T.quick });
      }).toPass({ timeout: T.poll });
      await confirm.click();
      await expect(share.getByText(t("shareSuccessWith"))).toBeVisible({
        timeout: T.action,
      });
      await share.getByRole("button", { name: t("btnClose"), exact: true }).click();
      await expect(share).toBeHidden({ timeout: T.action });

      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        await reloadUntil(b2.page, async () => {
          await openAggregations(b2.page);
          await expect(aggregationsList(b2.page).getByText(AGGREGATION_NAME))
            .toBeVisible({ timeout: T.action });
        });
      } catch (timeout) {
        b2.guard.assertNoAppErrors();
        throw timeout;
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
      // Self-cleaning: delete the aggregation A created.
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
        await verifyAndResetBoth(a.page, bEnd.page, "palette-benchmark-share");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
