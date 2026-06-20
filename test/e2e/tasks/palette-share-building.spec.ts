import { expect, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
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
import {
  openPalette,
  paletteInput,
  runPaletteCommand,
  runPaletteFormCommand,
  submitPaletteForm,
} from "../helpers/palette.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { deleteAllOwnedRooms } from "../helpers/rooms.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "Share building X (energy 2022–2024) with my investor", driven THROUGH the
 * ⌘K command palette's **schema-driven param form** (`IntentParamForm`), not the
 * building page's bespoke "Share" button and not the old `?action=share` route.
 * Now that `ShareBuilding` is form-eligible (`lib/paramForm.ts`), selecting it in
 * the palette opens the form in place of the command list: the form's entity
 * pickers ARE the object selection (no focused object needed).
 *
 * Two throwaway Pods (mirrors share-building.spec): A adds a building + three
 * annual energy years, opens ⌘K → "Share building", picks the building, types B's
 * WebID as recipient, ticks 2022–2024 years, toggles "include energy data", and
 * submits. B logs in fresh, drains the inbox, and sees the building under
 * "Buildings shared with you".
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

  test("⌘K form → Share with the 2022–2024 years; B sees it shared with them", async ({ browser }) => {
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

      // A adds the building + three annual years (the per-year share field is
      // driven by building.energyDatasets — each year must exist before sharing).
      await addBuilding(a.page, STREET);
      await addEnergyYear(a.page, STREET, "2022", "10000");
      await addEnergyYear(a.page, STREET, "2023", "11000");
      await addEnergyYear(a.page, STREET, "2024", "12000");

      // ── Share through the palette's param FORM ──────────────────────────────
      await a.page.goto("/");
      await openBuildingsList(a.page);

      // Sanity: the palette opens in the shell and renders its command surface.
      await openPalette(a.page);
      await expect(a.page.getByText(t("paletteGroupNavigation"))).toBeVisible({
        timeout: T.visible,
      });
      // Close it again — press Escape on the focused filter field so the key
      // reaches the Modal's close-guard (a bare page-level press can miss it).
      await paletteInput(a.page).press("Escape");
      await expect(paletteInput(a.page)).toBeHidden({ timeout: T.action });

      // ⌘K → "Share building" → the IntentParamForm opens (its heading is the
      // verb's intent label). Fill the building, recipient, years + energy toggle.
      const form = await runPaletteFormCommand(
        a.page,
        t("intentShareBuilding"),
        t("intentShareBuilding"),
        t("intentShareBuilding"),
      );

      // Building picker (single MUI Select, labelled "Building").
      await form.getByLabel(t("paramBuilding")).click();
      await a.page.getByRole("option", { name: new RegExp(STREET) }).click();

      // Recipient: a free-solo multi Autocomplete; type B's WebID + Enter → chip.
      // (Match a substring of the label — "Recipient WebID(s)" has literal parens.)
      const recipient = form.getByLabel(t("racLabel"));
      await recipient.fill(bWebId);
      await recipient.press("Enter");

      // Include energy data (the boolean switch) so the per-year grant is real.
      await form.getByLabel(t("paramIncludeEnergyData")).check();

      // Years: type a 4-digit year, Enter adds a chip (the YearChips field).
      const years = form.getByLabel(t("paramYears"));
      for (const year of ["2022", "2023", "2024"]) {
        await years.fill(year);
        await years.press("Enter");
      }

      // Submit the form (recipient resolution is networked; retry until it closes).
      await expect(async () => {
        await submitPaletteForm(a.page);
      }).toPass({ timeout: T.poll });
      await a.page.goto("/");

      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        const received = b2.page.getByRole("list", {
          name: t("sharedBuildingsHeading"),
        });
        try {
          await reloadUntil(b2.page, async () => {
            await b2.page.getByRole("tab", { name: t("navSharing") }).click();
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

/**
 * Solo CT: the palette's **param-less direct-invoke** path. `CreateRoom` ("Host a
 * data room") has no modelled params, so selecting it in ⌘K fires the core straight
 * away (no form, no dialog) and the new room appears in the Rooms finder. Covers the
 * `routesToDirect` leg of the palette.
 */
const solo = resolveAccounts({ count: 1 });

test.describe("palette: host a data room (param-less direct invoke)", () => {
  test.skip(!solo.ok, solo.ok ? "" : solo.reason);

  test("⌘K → Host a data room → a room is created and listed", async ({ browser }) => {
    test.setTimeout(T.testSolo);
    const a = await freshPage(browser, A);
    await assertCleanStart(a.page, "palette-create-room:A");
    a.page.on("dialog", (d) => d.accept()); // delete-room confirm in cleanup
    try {
      await a.page.goto("/");
      await a.page.getByRole("tab", { name: t("navMeet") }).click();

      // No room yet (empty-state). Host one straight from the palette.
      const owned = a.page.getByRole("button", { name: t("roomDeleteAria") });
      const before = await owned.count();

      await runPaletteCommand(a.page, t("roomHostBtn"), t("roomHostBtn"));

      // A newly-hosted room shows the owner-only "Delete data room" action.
      await expect(owned).toHaveCount(before + 1, { timeout: T.action });
    } finally {
      try {
        if (!a.page.isClosed()) {
          await a.page.goto("/");
          await deleteAllOwnedRooms(a.page);
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      await a.ctx.close();
    }
  });
});
