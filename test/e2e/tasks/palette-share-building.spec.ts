import { expect, test } from "@playwright/test";
import { en } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  addBuilding,
  addEnergyYear,
  buildingIdOf,
  deleteBuildingRow,
  openBuildingsList,
} from "../helpers/manage.ts";
import { openPalette, paletteInput } from "../helpers/palette.ts";
import { ACTION_PARAM, buildingRoute as appBuildingRoute, withAction } from "../../../src/routes.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "Share building X (energy 2022–2024) with my investor", driven THROUGH the
 * ⌘K command palette's routing contract (plan-palette §"e2e — anchored in competency
 * tasks"), not the building page's bespoke "Share" button. Two throwaway Pods
 * (mirrors share-building.spec): A adds a building + three annual energy years,
 * invokes Share via the palette, ticks the 2022–2024 years, and shares directly to
 * B's WebID (the simple DUO — A already holds B's WebID, no data room). B logs in
 * fresh, drains the inbox, and sees the building under "Buildings shared with you".
 *
 * HOW THE PALETTE DRIVES SHARE (and the residual it reflects): Share is a *rich*
 * focused-object verb (surface ShareBuildingDialog on /building). `CommandPalette`
 * is mounted only in the app-shell (AppShell), NOT on the shell-less /building
 * detail page, so we exercise the palette's exact routing contract: navigate to
 * `withAction(buildingRoute(id), "share")` — the URL `CommandPalette.run()` builds
 * for this verb — which the SharingSection auto-opens (`autoOpenShare`). The spec
 * first asserts the palette opens in the shell and offers its commands, so the ⌘K
 * surface itself is covered; the object-verb leg then rides the `?action=share`
 * contract. (When the palette is later mounted on the focus host, the navigate is
 * replaced by ⌘K → "Share building".)
 *
 *   # tier 4 (real, interoperating Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/palette-share-building.spec.ts
 *
 * Needs E2E_{USERNAME,PASSWORD}_A and _B and an INTEROPERATING provider pair; skips
 * otherwise (the share logic is covered "in principle" by the Tier-2 headless task).
 */

const A = account("A");
const B = account("B");
const STREET = "Palette Share Weg 7";

const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("palette: share building by year across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("⌘K-route → Share with the 2022–2024 years; B sees it shared with them", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // Keep B's first session open through the share so B's inbox is provisioned
    // (ensureOwnInbox runs async post-login) and A can POST the grant; B then
    // re-logs in fresh to drain it.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "palette-share-building:A");
    await assertCleanStart(b1.page, "palette-share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building)
    try {
      const bWebId = await webIdOf(b1.page);

      // A adds the building + three annual years (the per-year share picker is
      // driven by building.energyDatasets — each year must exist before sharing).
      await addBuilding(a.page, STREET);
      await addEnergyYear(a.page, STREET, "2022", "10000");
      await addEnergyYear(a.page, STREET, "2023", "11000");
      await addEnergyYear(a.page, STREET, "2024", "12000");

      // Sanity: the palette opens in the shell and renders its command surface
      // (the ⌘K surface itself, before we ride its routing contract).
      await a.page.goto("/");
      await openBuildingsList(a.page);
      await openPalette(a.page);
      await expect(a.page.getByText(en("paletteGroupNavigation"))).toBeVisible({
        timeout: T.visible,
      });
      await a.page.keyboard.press("Escape");
      await expect(paletteInput(a.page)).toBeHidden({ timeout: T.action });

      // Resolve the building id, then ride the palette's Share routing contract:
      // navigate to the exact `?action=share` URL the palette builds, which
      // auto-opens the ShareBuildingDialog on the building page.
      const aRow = a.page.locator("li[data-building-id]", { hasText: STREET })
        .first();
      await expect(aRow).toBeVisible({ timeout: T.action });
      const aId = await buildingIdOf(aRow);
      if (!aId) throw new Error("palette-share: missing building id");
      await a.page.goto(withAction(appBuildingRoute(aId), "share"));
      await expect(a.page).toHaveURL(new RegExp(`${ACTION_PARAM}=share`));

      const dialog = a.page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: T.action });

      // Share By WebID, scoped to the specific years 2022–2024.
      await dialog.getByRole("button", { name: /by webid/i }).click();
      const recipientInput = dialog.getByLabel(/Recipient WebID/i);
      await recipientInput.fill(bWebId);
      await recipientInput.press("Enter");
      await dialog.getByRole("radio", { name: /specific year/i }).check();
      for (const year of ["2022", "2023", "2024"]) {
        await dialog.getByRole("checkbox", { name: year, exact: true }).check();
      }

      // Review → confirm (recipient resolution is networked; retry until Confirm).
      const confirm = dialog.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await dialog.getByRole("button", { name: /review and share/i }).click();
        await expect(confirm).toBeVisible({ timeout: T.quick });
      }).toPass({ timeout: T.poll });
      await confirm.click();
      await expect(dialog.getByText(/shared successfully/i)).toBeVisible({
        timeout: T.action,
      });
      await dialog.getByRole("button", { name: /done/i }).click();
      await a.page.goto("/");

      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        const received = b2.page.getByRole("list", {
          name: /buildings shared with you/i,
        });
        try {
          await reloadUntil(b2.page, async () => {
            await b2.page.getByRole("tab", { name: en("navSharing") }).click();
            await expect(received.getByText(/^Building /)).toBeVisible({
              timeout: T.action,
            });
          });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building (no room — direct share).
      try {
        if (!a.page.isClosed()) {
          await a.page.goto("/");
          await openBuildingsList(a.page);
          const row = a.page.locator("li[data-building-id]", { hasText: STREET })
            .first();
          if (await row.count()) {
            const id = await buildingIdOf(row);
            if (id) await deleteBuildingRow(a.page, id);
          }
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "palette-share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
