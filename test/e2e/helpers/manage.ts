import { expect, type Locator, type Page } from "@playwright/test";
import { metricT, roleT, t } from "./i18n.ts";
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
  await page.getByRole("tab", { name: t("navBuildings") }).click();
  await page.getByRole("button", { name: t("btnList") }).click();
}

/**
 * Open the Buildings tab's **Map** view (the former "Explore" map). The redesign
 * merged Explore + Manage into one Buildings tab with a Map⇄List toggle; the tab
 * lands on Map, but a prior `openBuildingsList` may have left List active, so
 * select the tab then the Map toggle explicitly.
 */
export async function openBuildingsMap(page: Page): Promise<void> {
  await page.getByRole("tab", { name: t("navBuildings") }).click();
  // Scope to the cube's Space-axis group (`bldgsViewAria`): a building's own detail
  // page carries a separate "Map" toggle, so keep the click scoped + defensive.
  await page
    .getByLabel(t("bldgsViewAria"))
    .getByRole("button", { name: t("btnMap"), exact: true })
    .click();
}

/**
 * Open the **Observations** finder (`/observations`) and select a cube View — `map`
 * (the geographic energy map + year slider, the default), `list` (the per-building
 * summary), `overtime` (the buildings × years heatmap) or `trend` (per-building
 * direction). Energy lives here now (Buildings is space/identity only). The View
 * toggle is scoped to `obsViewAria` (a building's own detail page carries a separate
 * "Map" toggle).
 */
export async function openObservationsView(
  page: Page,
  view: "map" | "list" | "overtime" | "overyears",
): Promise<void> {
  await page.getByRole("tab", { name: t("navObservations") }).click();
  const label = view === "map"
    ? t("btnMap")
    : view === "list"
    ? t("btnList")
    : view === "overtime"
    ? t("obsViewOvertime")
    : t("obsViewOveryears");
  await page
    .getByLabel(t("obsViewAria"))
    .getByRole("button", { name: label, exact: true })
    .click();
}

/**
 * Open the **Aggregations** finder (`/aggregations`) — the redesign split it out
 * of the old Buildings/Manage list into its own top-nav finder. Used by the
 * create / share / detail aggregation flows.
 */
export async function openAggregations(page: Page): Promise<void> {
  await page.getByRole("tab", { name: t("navAggregations") }).click();
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
  await row.getByRole("button", { name: t("buildingDeleteAria") }).click();
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
  await page.getByRole("button", { name: t("addBuildingBtn"), exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(t("lblStreetAddress"))).toBeVisible({
    timeout: T.visible,
  });
  await dialog.getByLabel(t("lblStreetAddress")).fill(street);
  await dialog.getByLabel(t("lblLocality")).fill("Nürnberg");
  await dialog.getByLabel(t("lblPostalCode")).fill("90451");
  await dialog.getByLabel(t("lblRegion")).fill("Bayern");
  await dialog.getByLabel(t("lblLatitude")).fill("49.45");
  await dialog.getByLabel(t("lblLongitude")).fill("11.08");
  await dialog.getByRole("button", { name: t("addBuildingBtn"), exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: T.action });

  // The operator is master data now, not a create-form basic — the create modal mints
  // only the basics (address + coordinates). Set "Operated by" INLINE on the new
  // building's page via the master-data editor (the inline flesh-out). It's a contacts
  // Autocomplete, so Escape closes the suggestion popup before Save.
  if (opts.operatedBy) {
    const { id } = await findOwnBuildingRow(page, street);
    await page.goto(buildingRoute("building", id));
    await page.getByRole("heading", { name: t("secMasterData"), exact: true })
      .locator("xpath=..")
      .getByRole("button")
      .click();
    await page.getByLabel(t("lblOperatedBy")).fill(opts.operatedBy);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
    await expect(page.getByText(t("buildingUpdated")))
      .toBeVisible({ timeout: T.action });
    // Return to the Buildings list so callers still find the new row. The inline-operator
    // detour left us on the building detail page, which is shell-less (no tabs), so go back
    // to the shell FIRST, then switch to the list.
    await page.goto("/");
    await openBuildingsList(page);
  }
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
  scenario: "actual" | "planned" = "actual",
): Promise<void> {
  // Self-contained + race-hardened: resolve the row with a fresh-read retry (a
  // caller may be on a standalone detail route, and a just-added building can lag
  // the listing — see findOwnBuildingRow).
  const { id } = await findOwnBuildingRow(page, street);
  await page.goto(buildingRoute("observation", id));
  await page.getByRole("button", { name: t("btnEditEnergyYears") }).click();
  // The energy-year editor is INLINE on the observation page now (it replaces the
  // charts view while open) — target inputs by exact label / role.
  await page.getByRole("spinbutton", { name: t("lblYear"), exact: true }).fill(year);
  await page.getByLabel(t("lblScenario"), { exact: true }).click();
  await page.getByRole("option", {
    name: t(scenario === "planned" ? "scenarioPlanned" : "scenarioActual"),
    exact: true,
  }).click();
  await page.getByRole("spinbutton", { name: metricT("electricityConsumption") })
    .fill(electricity);
  await page.getByRole("button", { name: t("btnSave"), exact: true }).click();
  await expect(page.getByText(t("energySaved")).first())
    .toBeVisible({ timeout: T.action });
  // Saving keeps the editor open (so its table reflects the new year); close it so
  // each call is self-contained (Close flips back to the charts view). Two controls
  // answer to "Close" right now — the editor's text Button and the success snackbar's
  // icon-only Alert X (the `energySaved` toast we just awaited). Disambiguate to the
  // editor's: it's the only one carrying the visible text (the X's name is its aria-label).
  await page.getByRole("button", { name: t("btnClose"), exact: true })
    .filter({ hasText: t("btnClose") }).click();
  await expect(page.getByRole("spinbutton", { name: t("lblYear"), exact: true }))
    .toBeHidden({ timeout: T.action });
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
  await dialog.getByRole("button", { name: t("shareByRole") }).click();
  await dialog.getByLabel(t("lblRole")).click();
  await page.getByRole("option", { name: roleT("user"), exact: true }).click();

  if (years) {
    // Switch the energy scope to per-year and tick the requested year(s).
    await dialog.getByRole("radio", { name: t("shareScopeYears") }).check();
    for (const year of years) {
      await dialog.getByRole("checkbox", { name: String(year), exact: true })
        .check();
    }
  }

  await reviewAndConfirmShare(page);
}

/**
 * Open the `ShareBuildingDialog` for the building at `street`: sharing is a
 * Buildings-list **row action** (the Share icon, next to Delete) — the detail-page
 * Share button was removed. `findOwnBuildingRow` lands on the Buildings list with the
 * row located; click its Share action. Leaves the dialog open on the Buildings tab.
 */
async function openShareDialog(page: Page, street: string): Promise<void> {
  const { row } = await findOwnBuildingRow(page, street);
  await row.getByRole("button", { name: t("intentShareBuilding"), exact: true }).click();
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
  const confirm = dialog.getByRole("button", { name: t("shareConfirmShare") });
  await expect(async () => {
    await dialog.getByRole("button", { name: t("shareReviewAndShare") }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(t("shareSuccessWith")))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: t("btnDone"), exact: true }).click();
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
  opts?: { withhold?: string[] },
): Promise<void> {
  await openShareDialog(page, street);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t("shareByWebId") }).click();
  // The recipient field is a multi free-solo Autocomplete: type the WebID and
  // press Enter to commit it as a chip (a plain fill doesn't register it).
  const recipientInput = dialog.getByLabel(t("racLabel"));
  await recipientInput.fill(webId);
  await recipientInput.press("Enter");
  // The committed chip renders as a resolved AgentChip — the profile's name,
  // or the WebID fragment as fallback — never the raw IRI (the IRI stays on
  // the chip's title attribute).
  await expect(dialog.getByText(webId, { exact: true })).toHaveCount(0);

  // Per-attachment selection: untick the named attachments to WITHHOLD them
  // (the dialog's attachment checklist is all-checked by default, so an
  // untouched share includes every file).
  for (const filename of opts?.withhold ?? []) {
    await dialog.getByRole("checkbox", { name: filename }).uncheck();
  }

  await reviewAndConfirmShare(page);
}

/** The aggregation name the share-aggregation spec creates and shares. */
export const AGGREGATION_NAME = "E2E Shared Aggregation";

/** Create the shared aggregation (idempotent: reuse an existing one with AGGREGATION_NAME). */
export async function ensureAggregation(page: Page): Promise<void> {
  await openAggregations(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await page.locator("li").filter({ hasText: AGGREGATION_NAME }).count()) return;

  await page.getByRole("button", { name: t("aggCreateTitle") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: T.quick });
  // Default annual-portfolio mode (no role selection; for an annual-only building
  // set the "Aggregation type" dropdown isn't even shown). Metrics are pre-selected.
  await dialog.getByLabel(t("aggNameLabel")).fill(AGGREGATION_NAME);
  await dialog.getByLabel(t("aggSelectBuildings")).click();
  // Fail fast with a clear message if the picker is empty (no buildings to aggregate),
  // rather than hanging on a click that waits out the whole test timeout.
  const firstBuilding = page.getByRole("option").first();
  await expect(firstBuilding, "a building to add to the aggregation")
    .toBeVisible({ timeout: T.visible });
  await firstBuilding.click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: t("aggCreateTitle") }).click();
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
  await row.getByRole("button", { name: t("aggShareAria") }).click();
  // Scope to the SHARE dialog by its title (the CreateAggregationDialog's closing
  // ghost can otherwise bind a generic role=dialog locator — see ensureAggregation).
  const dialog = page.getByRole("dialog")
    .filter({ hasText: t("shareAggTitle", { name: AGGREGATION_NAME }) });
  await expect(dialog).toBeVisible({ timeout: T.action });
  // The recipient field is a multi free-solo Autocomplete: type the WebID and
  // press Enter to commit it (a plain fill doesn't register it).
  const recipientInput = dialog.getByLabel(t("racLabel"));
  await recipientInput.fill(webId);
  await recipientInput.press("Enter");
  const confirm = dialog.getByRole("button", { name: t("shareConfirmShare") });
  await expect(async () => {
    await dialog.getByRole("button", { name: t("shareReviewAndShare") }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(t("shareSuccessWith")))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: t("btnClose"), exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: T.action });
}

/**
 * The Aggregations-finder list (named via the `<ul>`'s aria-label) — the unified
 * collection where BOTH own and received (shared-with-me) aggregations now appear
 * under the source-tier facet (the standalone "Aggregations shared with you" list
 * on the Sharing tab was removed in the finder-collection-model Slice 5). To verify
 * an aggregation was received, open the Aggregations finder (`openAggregations`) and
 * assert its name within this list.
 */
export const aggregationsList = (page: Page) =>
  page.getByRole("list", { name: t("navAggregations") });
