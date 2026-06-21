import { expect, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  addBuilding,
  buildingIdOf,
  deleteBuildingRow,
  openBuildingsList,
  openBuildingsMap,
  shareByWebId,
} from "../helpers/manage.ts";
import { openPalette, paletteInput } from "../helpers/palette.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "Hide a shared building" — A shares a building with B; B hides it from B's own
 * dashboard (map + lists) without touching A's share, then shows it again. The hide
 * is the `ToggleBuildingVisibility` intent (applies: a *shared* building;
 * `gran:hiddenBuilding` in B's prefs.ttl, re-read by getSharedWithMe) — a param-less
 * verb routed through `useToggleVisibility`.
 *
 * SURFACE NOTE / RESIDUAL: in the current build the `ToggleBuildingVisibility` verb
 * is surfaced for B as the "Shown/Hidden" Switch on B's Sharing finder row — the
 * registry's focus-host handler for it lives on the shell-less /building detail page
 * (Building.tsx registers it via PaletteFocusContext), but `CommandPalette` is
 * mounted only in the app-shell (AppShell), and the registry-driven
 * `ObjectActions` renders this verb on no finder (it shows owned-building verbs
 * only). The verb is also param-less, so there is no `?action=` routing contract to
 * ride (unlike Share / Enter-energy). So this CT drives the hide through the actual
 * user surface (the Sharing-tab Switch) and asserts the palette is reachable in the
 * shell — flagging that wiring this verb into the palette needs the palette mounted
 * on the focus host (plan-palette §"Open questions": the focus-handoff seam).
 *
 *   # tier 4 (real, interoperating Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/palette-hide-shared-building.spec.ts
 *
 * Needs E2E_{USERNAME,PASSWORD}_A and _B and an INTEROPERATING provider pair; skips
 * otherwise (the logic is covered "in principle" by the Tier-2 headless task).
 */

const A = account("A");
const B = account("B");
const STREET = "Palette Hide Weg 9";

const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("palette: hide a shared building across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  test("A shares with B; B hides then shows the shared building", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "palette-hide-shared-building:A");
    await assertCleanStart(b1.page, "palette-hide-shared-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building)
    try {
      const bWebId = await webIdOf(b1.page);

      // A adds a building and shares it directly to B's WebID (static + all energy).
      await addBuilding(a.page, STREET);
      await shareByWebId(a.page, STREET, bWebId);
      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below

      // ── B: drain the grant, then exercise the hide/show toggle ──
      const b2 = await freshPage(browser, B);
      try {
        // Sanity: the palette opens in B's shell and renders its commands.
        await openPalette(b2.page);
        await expect(b2.page.getByText(t("paletteGroupNavigation")))
          .toBeVisible({ timeout: T.visible });
        await b2.page.keyboard.press("Escape");
        await expect(paletteInput(b2.page)).toBeHidden({ timeout: T.action });

        const received = b2.page.getByRole("list", {
          name: t("sharedBuildingsHeading"),
        });
        try {
          await reloadUntil(b2.page, async () => {
            await b2.page.getByRole("tab", { name: t("navSharing") }).click();
            await expect(received.getByText(tPattern("shareBuildingN"))).toBeVisible({
              timeout: T.quick,
            });
          });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }

        // The shared row carries the Shown/Hidden Switch (the ToggleBuildingVisibility
        // verb's surface). B owns nothing, so the shared building is the only Map
        // marker — a clean hide/show signal.
        const sharedRow = received.locator("li")
          .filter({ has: b2.page.getByText(tPattern("shareBuildingN")) }).first();
        const visToggle = sharedRow.getByRole("switch");
        await expect(sharedRow.getByText(t("shareShown"))).toBeVisible({
          timeout: T.action,
        });
        const markers = b2.page.locator(".leaflet-marker-icon");

        // Hide → row reads "Hidden" and B's Map drops to no markers.
        await visToggle.click();
        await expect(sharedRow.getByText(t("shareHidden"))).toBeVisible({
          timeout: T.action,
        });
        await openBuildingsMap(b2.page);
        await expect(async () => {
          expect(await markers.count()).toBe(0);
        }).toPass({ timeout: T.poll });

        // Show → row reads "Shown" again and the marker returns.
        await b2.page.getByRole("tab", { name: t("navSharing") }).click();
        await expect(sharedRow.getByText(t("shareHidden"))).toBeVisible({
          timeout: T.action,
        });
        await visToggle.click();
        await expect(sharedRow.getByText(t("shareShown"))).toBeVisible({
          timeout: T.action,
        });
        await openBuildingsMap(b2.page);
        await expect(markers.first()).toBeVisible({ timeout: T.action });
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
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
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "palette-hide-shared-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });
});
