import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "./i18n.ts";
import { T } from "./timeouts.ts";
import { confirmDialog } from "./confirm.ts";
import {
  buildingRoute as appBuildingRoute,
  observationRoute as appObservationRoute,
} from "../../../src/routes.ts";

/**
 * Manage-tab building/aggregation helpers shared across the building/excel/sharing specs
 * (extracted from per-spec copies). Building rows show the building's DISPLAY
 * name (label / code / address — heike-5 #1), so the id is resolved from the
 * row's `data-building-id` attribute, never parsed from its text.
 */

/** Locator for the building rows on Manage. */
export const buildingRows = (page: Page) =>
  page.locator("li[data-building-id]");

/** A row's building id (the building's IRI-based identifier, verbatim). */
export const buildingIdOf = (row: Locator): Promise<string | null> =>
  row.getAttribute("data-building-id");

/**
 * Open the Buildings tab's **List** view — the former "Manage" list (building
 * rows, "Add Building", and the per-row actions). The redesign merged Explore +
 * Manage into one Buildings tab with a Map⇄List toggle that lands on Map, so
 * reaching the list is now: select the Buildings tab, then toggle to List.
 */
export async function openBuildingsList(page: Page): Promise<void> {
  await page.getByRole("tab", { name: en("navBuildings") }).click();
  await page.getByRole("button", { name: en("btnList") }).click();
}

/**
 * Open the Buildings tab's **Map** view (the former "Explore" map). The redesign
 * merged Explore + Manage into one Buildings tab with a Map⇄List toggle; the tab
 * lands on Map, but a prior `openBuildingsList` may have left List active, so
 * select the tab then the Map toggle explicitly.
 */
export async function openBuildingsMap(page: Page): Promise<void> {
  await page.getByRole("tab", { name: en("navBuildings") }).click();
  // Scope to the Buildings-view toggle group: the cube's "Explore view" selector also
  // carries a "Map" button, so an unscoped getByRole matches two (see plans/stumble.md).
  await page
    .getByLabel(en("bldgsViewAria"))
    .getByRole("button", { name: en("btnMap"), exact: true })
    .click();
}

/**
 * Open the **Aggregations** finder (`/aggregations`) — the redesign split it out
 * of the old Buildings/Manage list into its own top-nav finder. Used by the
 * create / share / detail aggregation flows.
 */
export async function openAggregations(page: Page): Promise<void> {
  await page.getByRole("tab", { name: en("navAggregations") }).click();
}

/**
 * Open the Buildings List and resolve the row for `street` + its building id,
 * retrying with a **fresh read** (a full `goto`) until the row appears. Guards the
 * Tier-3 CSS write→container-listing race: a just-added building can be missing from
 * the freshly-fetched listing for a moment, and the app's global `refetchOnMount:
 * false` means merely re-opening the tab won't re-read — only a fresh document load
 * does. Replaces the bare `openBuildingsList → expect(row).toBeVisible` the share /
 * energy / files helpers used to inline (the observed `share-building` flake).
 */
export async function findOwnBuildingRow(
  page: Page,
  street: string,
): Promise<{ row: Locator; id: string }> {
  const row = page.locator("li[data-building-id]", { hasText: street }).first();
  await expect(async () => {
    await page.goto("/");
    await openBuildingsList(page);
    await expect(row).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  const id = await buildingIdOf(row);
  if (!id) throw new Error(`findOwnBuildingRow: no id for building "${street}"`);
  return { row, id };
}

/**
 * Real-path route to a building's standalone page (BrowserRouter). The id rides in
 * a query param — `?ref=` for a storage-relative (own) id, `?uri=` for an absolute
 * (foreign/shared) IRI — via the app's own route builders, so a raw `#`/`/` in the
 * id can't truncate the path and the harness can't drift from the app grammar.
 * Every spec goto goes through this, never hand-built paths. Accepts `null`
 * (getAttribute's type) and fails LOUDLY instead of routing to the literal "null".
 */
export function buildingRoute(
  kind: "building" | "observation",
  id: string | null,
): string {
  if (!id) throw new Error(`buildingRoute(${kind}): missing building id`);
  return kind === "observation" ? appObservationRoute(id) : appBuildingRoute(id);
}

/**
 * Delete one building row and wait for THAT row to vanish — not the shared
 * "Building deleted" toast, which lingers ~6 s from the previous delete and
 * lets a loop race ahead into mid-refetch re-renders that swallow clicks.
 */
export async function deleteBuildingRow(page: Page, id: string): Promise<void> {
  const row = page.locator(`li[data-building-id="${id}"]`).first();
  await row.getByRole("button", { name: en("buildingDeleteAria") }).click();
  await confirmDialog(page, "Delete");
  await expect(row).toHaveCount(0, { timeout: T.action });
}

/** The ids of all building rows currently listed on Manage. */
export async function buildingIds(page: Page): Promise<string[]> {
  const rows = buildingRows(page);
  const n = await rows.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await buildingIdOf(rows.nth(i));
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Add a building via the single generic manual form (location fields). Pass
 * `operatedBy` to also set the "Operated by (WebID)" operator — needed when a
 * spec exercises the operator-average (Betreiber) benchmark, which keys on it.
 */
export async function addBuilding(
  page: Page,
  street: string,
  opts: { operatedBy?: string } = {},
): Promise<void> {
  await openBuildingsList(page);
  await page.getByRole("button", { name: /^add building$/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/street address/i)).toBeVisible({
    timeout: T.visible,
  });
  await dialog.getByLabel(/street address/i).fill(street);
  await dialog.getByLabel(/locality/i).fill("Nürnberg");
  await dialog.getByLabel(/postal code/i).fill("90451");
  await dialog.getByLabel(/region/i).fill("Bayern");
  await dialog.getByLabel(/latitude/i).fill("49.45");
  await dialog.getByLabel(/longitude/i).fill("11.08");
  if (opts.operatedBy) {
    await dialog.getByLabel(/operated by/i).fill(opts.operatedBy);
    // "Operated by" is a contacts Autocomplete: once the operator is a remembered
    // contact (e.g. the 2nd building reusing it), a suggestion popup opens and would
    // overlap/intercept the submit click. Escape closes just the popup (MUI consumes
    // it; the dialog stays open).
    await page.keyboard.press("Escape");
  }
  await dialog.getByRole("button", { name: /^add building$/i }).click();
  await expect(dialog).toBeHidden({ timeout: T.action });
}

/**
 * Add (or overwrite) an annual energy figure for `street`. The redesign moved
 * energy entry off the finder row onto the building's observation page
 * (`/observation/:id`), so this opens that page and uses its "Edit energy years"
 * button. `scenario` matches the Scenario option (e.g. /^Actual$/, /^Planned/).
 * Returns to the shell afterwards so a caller's next `openBuildingsList` works.
 */
export async function addEnergyYear(
  page: Page,
  street: string,
  year: string,
  electricity: string,
  scenario: RegExp = /^Actual$/,
): Promise<void> {
  // Self-contained + race-hardened: resolve the row with a fresh-read retry (a
  // caller may be on a standalone detail route, and a just-added building can lag
  // the listing — see findOwnBuildingRow).
  const { id } = await findOwnBuildingRow(page, street);
  await page.goto(buildingRoute("observation", id));
  await page.getByRole("button", { name: "Edit energy years" }).click();
  // The dialog's accessible name contains "year", so target inputs by exact
  // label / role to avoid matching the dialog itself.
  await page.getByRole("spinbutton", { name: en("lblYear"), exact: true }).fill(year);
  await page.getByLabel(en("lblScenario"), { exact: true }).click();
  await page.getByRole("option", { name: scenario }).click();
  await page.getByRole("spinbutton", { name: "Electricity consumption (kWh)" })
    .fill(electricity);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Energy data saved").first())
    .toBeVisible({ timeout: T.action });
  // Saving keeps the dialog open (so the table reflects the new year); close it
  // so each call is self-contained and the next action isn't blocked by the modal.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: T.action });
  // /observation/:id is a standalone route (no app shell) — return to the shell.
  await page.goto("/");
}

/**
 * Share the building at `street` with the room's User-role members, choosing the
 * "What to share" scope. With `years`, picks "energy for specific year(s)" and
 * ticks exactly those years; without, shares static + all energy (the default).
 *
 * The redesign removed the per-row "Share building data" action; sharing now lives
 * on the building page's `SharingSection` — resolve the building's id from the
 * Buildings list, route to `/building/:id`, click that section's "Share" button,
 * then drive the SAME `ShareBuildingDialog` (its internals are unchanged). Returns
 * to the app shell (`/`) at the end so a caller's next tab nav works (the
 * building page is a standalone route with no app-shell tabs).
 */
export async function shareByRole(
  page: Page,
  street: string,
  years?: number[],
): Promise<void> {
  await openShareDialog(page, street);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /by role/i }).click();
  await dialog.getByLabel(en("lblRole")).click();
  await page.getByRole("option", { name: "User" }).click();

  if (years) {
    // Switch the energy scope to per-year and tick the requested year(s).
    await dialog.getByRole("radio", { name: /specific year/i }).check();
    for (const year of years) {
      await dialog.getByRole("checkbox", { name: String(year), exact: true })
        .check();
    }
  }

  await reviewAndConfirmShare(page);
}

/**
 * Open the `ShareBuildingDialog` for the building at `street`, via the redesigned
 * flow: resolve its id from the Buildings list, route to `/building/:id`, click
 * the SharingSection "Share" button. Leaves the dialog open and visible; the
 * page is on the standalone `/building/:id` route.
 */
async function openShareDialog(page: Page, street: string): Promise<void> {
  const { id } = await findOwnBuildingRow(page, street);
  await page.goto(buildingRoute("building", id));
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.action });
}

/**
 * Drive the share dialog's review→confirm tail (shared by the by-role / by-WebID
 * flows): "Review and Share" resolves recipients over the network, so retry until
 * the review step's Confirm appears, confirm, await success, dismiss. Returns the
 * page to the app shell so a caller's next tab nav works.
 */
async function reviewAndConfirmShare(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dialog.getByRole("button", { name: /review and share/i }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(/shared successfully/i))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: /done/i }).click();
  await expect(dialog).toBeHidden({ timeout: T.action });
  // /building/:id is a standalone route (no app shell) — return to the shell.
  await page.goto("/");
}

/** Upload a file to the building at `street` via the Files dialog. */
export async function uploadBuildingFile(
  page: Page,
  street: string,
  fixturePath: string,
): Promise<void> {
  const { id } = await findOwnBuildingRow(page, street);
  // Files moved to the building page's Files section (the per-row "Manage files"
  // dialog is gone); the hidden input is set directly.
  await page.goto(buildingRoute("building", id));
  await page.locator("#building-files-input").setInputFiles(fixturePath, {
    timeout: T.action,
  });
  const name = fixturePath.split("/").pop()!;
  await expect(page.locator("li", { hasText: name }).first())
    .toBeVisible({ timeout: T.action });
  // Back to the shell so the caller's next nav works.
  await page.goto("/");
}

/** Share the building at `street` directly with a recipient WebID ("By WebID"). */
export async function shareByWebId(
  page: Page,
  street: string,
  webId: string,
): Promise<void> {
  await openShareDialog(page, street);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /by webid/i }).click();
  // The recipient field is a multi free-solo Autocomplete: type the WebID and
  // press Enter to commit it as a chip (a plain fill doesn't register it).
  const recipientInput = dialog.getByLabel(/Recipient WebID/i);
  await recipientInput.fill(webId);
  await recipientInput.press("Enter");
  // The committed chip renders as a resolved AgentChip — the profile's name,
  // or the WebID fragment as fallback — never the raw IRI (the IRI stays on
  // the chip's title attribute).
  await expect(dialog.getByText(webId, { exact: true })).toHaveCount(0);

  await reviewAndConfirmShare(page);
}

/** The aggregation name the share-aggregation spec creates and shares. */
export const AGGREGATION_NAME = "E2E Shared Aggregation";

/** Create the shared aggregation (idempotent: reuse an existing one with AGGREGATION_NAME). */
export async function ensureAggregation(page: Page): Promise<void> {
  await openAggregations(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await page.locator("li").filter({ hasText: AGGREGATION_NAME }).count()) return;

  await page.getByRole("button", { name: /create aggregation/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: T.quick });
  // Default annual-portfolio mode (no role selection; for an annual-only building
  // set the "Aggregation type" dropdown isn't even shown). Metrics are pre-selected.
  await dialog.getByLabel(en("aggNameLabel")).fill(AGGREGATION_NAME);
  await dialog.getByLabel(en("aggSelectBuildings")).click();
  // Fail fast with a clear message if the picker is empty (no buildings to aggregate),
  // rather than hanging on a click that waits out the whole test timeout.
  const firstBuilding = page.getByRole("option").first();
  await expect(firstBuilding, "a building to add to the aggregation")
    .toBeVisible({ timeout: T.visible });
  await firstBuilding.click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /create aggregation/i }).click();
  // Wait on the durable outcome — the aggregation appears in the Aggregations list
  // and the dialog closes — NOT the transient success toast. The single FIFO
  // snackbar can be mid-showing an earlier notice (e.g. first-time "Set up the
  // aggregations folder" provisioning), burying/delaying the success toast though the
  // aggregation itself was created.
  await expect(page.locator("li").filter({ hasText: AGGREGATION_NAME }).first())
    .toBeVisible({ timeout: T.action });
  // The row appears while the dialog is still fading out (MUI keeps it in the
  // DOM through the close transition). Don't return until it's gone, so a
  // caller's next role=dialog locator can't bind to this dialog's ghost.
  await expect(dialog).toBeHidden({ timeout: T.quick });
}

/**
 * Share the `AGGREGATION_NAME` aggregation directly with a recipient WebID — the
 * simple DUO path (no data room): the `ShareAggregationDialog`'s recipient field
 * is a free-solo WebID Autocomplete (room members are only a convenience "Add"
 * list), so we type the WebID + Enter, then Review→Confirm. Mirrors `shareByWebId`
 * for buildings. Leaves the dialog closed; assumes the aggregation already exists.
 */
export async function shareAggregationByWebId(
  page: Page,
  webId: string,
): Promise<void> {
  await openAggregations(page);
  const row = page.locator("li").filter({ hasText: AGGREGATION_NAME }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  await row.getByRole("button", { name: en("aggShareAria") }).click();
  // Scope to the SHARE dialog by its title (the CreateAggregationDialog's closing
  // ghost can otherwise bind a generic role=dialog locator — see ensureAggregation).
  const dialog = page.getByRole("dialog")
    .filter({ hasText: `Share "${AGGREGATION_NAME}"` });
  await expect(dialog).toBeVisible({ timeout: T.action });
  // The recipient field is a multi free-solo Autocomplete: type the WebID and
  // press Enter to commit it (a plain fill doesn't register it).
  const recipientInput = dialog.getByLabel(/Recipient WebID/i);
  await recipientInput.fill(webId);
  await recipientInput.press("Enter");
  const confirm = dialog.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dialog.getByRole("button", { name: /review and share/i }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(/shared successfully/i))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: /close/i }).click();
  await expect(dialog).toBeHidden({ timeout: T.action });
}

/**
 * The Share-tab "Aggregations shared with you" list (named via the `<ul>`'s aria-label).
 * Present only when at least one aggregation is shared; for the empty state assert the
 * section's "no aggregations shared with you yet…" text on the page directly.
 */
export const receivedAggregations = (page: Page) =>
  page.getByRole("list", { name: /aggregations shared with you/i });
