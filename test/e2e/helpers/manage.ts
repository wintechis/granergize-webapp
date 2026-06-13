import { expect, type Locator, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";
import { confirmDialog } from "./confirm.ts";

/**
 * Manage-tab building/view helpers shared across the building/excel/sharing specs
 * (extracted from per-spec copies). Building rows show the building's DISPLAY
 * name (label / code / address — heike-5 #1), so the id is resolved from the
 * row's `data-building-id` attribute, never parsed from its text.
 */

/** Locator for the building rows on Manage. */
export const buildingRows = (page: Page) => page.locator("li[data-building-id]");

/** A row's building id (the building's IRI-based identifier, verbatim). */
export const buildingIdOf = (row: Locator): Promise<string | null> =>
  row.getAttribute("data-building-id");

/**
 * Hash route to a building's standalone page. The id is an IRI reference
 * (contains `/` and `#`), so it MUST be URL-encoded — a raw `#` truncates the
 * hash route. Every spec goto goes through this, never hand-built paths.
 * Accepts `null` (getAttribute's type) and fails LOUDLY instead of routing to
 * the literal string "null".
 */
export function buildingRoute(
  kind: "building" | "energy",
  id: string | null,
): string {
  if (!id) throw new Error(`buildingRoute(${kind}): missing building id`);
  return `/#/${kind}/${encodeURIComponent(id)}`;
}

/** Hash route to the Explore tab with a building selected (`?b=`), optionally
 * on a detail sub-tab (`?dt=`). Encodes + null-rejects like {@link buildingRoute}. */
export function exploreRoute(id: string | null, dt?: string): string {
  if (!id) throw new Error("exploreRoute: missing building id");
  return `/#/?tab=explore&b=${encodeURIComponent(id)}${dt ? `&dt=${dt}` : ""}`;
}

/**
 * Delete one building row and wait for THAT row to vanish — not the shared
 * "Building deleted" toast, which lingers ~6 s from the previous delete and
 * lets a loop race ahead into mid-refetch re-renders that swallow clicks.
 */
export async function deleteBuildingRow(page: Page, id: string): Promise<void> {
  const row = page.locator(`li[data-building-id="${id}"]`).first();
  await row.getByRole("button", { name: "Delete building" }).click();
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
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: /^add building$/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/street address/i)).toBeVisible({ timeout: T.visible });
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
 * Add (or overwrite) an annual energy figure for `street` via the per-building
 * "Add or edit energy year" row action. `scenario` matches the Scenario option
 * (e.g. /^Actual$/, /^Planned/). Lifted from energy-entry.spec.ts so the sharing
 * specs can seed energy too.
 */
export async function addEnergyYear(
  page: Page,
  street: string,
  year: string,
  electricity: string,
  scenario: RegExp = /^Actual$/,
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  await row.getByRole("button", { name: "Add or edit energy year" }).click();
  // The dialog's accessible name contains "year", so target inputs by exact
  // label / role to avoid matching the dialog itself.
  await page.getByRole("spinbutton", { name: "Year", exact: true }).fill(year);
  await page.getByLabel("Scenario", { exact: true }).click();
  await page.getByRole("option", { name: scenario }).click();
  await page.getByRole("spinbutton", { name: "Electricity (kWh)" })
    .fill(electricity);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Energy data saved").first())
    .toBeVisible({ timeout: T.action });
  // Saving keeps the dialog open (so the table reflects the new year); close it
  // so each call is self-contained and the next action isn't blocked by the modal.
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: T.action });
}

/**
 * Share the building at `street` with the room's User-role members, choosing the
 * "What to share" scope. With `years`, picks "energy for specific year(s)" and
 * ticks exactly those years; without, shares static + all energy (the default).
 */
export async function shareByRole(
  page: Page,
  street: string,
  years?: number[],
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  await row.getByRole("button", { name: "Share building data" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: T.quick });
  await dialog.getByRole("button", { name: /by role/i }).click();
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: "User" }).click();

  if (years) {
    // Switch the energy scope to per-year and tick the requested year(s).
    await dialog.getByRole("radio", { name: /specific year/i }).check();
    for (const year of years) {
      await dialog.getByRole("checkbox", { name: String(year), exact: true })
        .check();
    }
  }

  // "Review & Share" resolves the role to member WebIDs over the network; retry
  // until the review step's Confirm appears.
  const confirm = dialog.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dialog.getByRole("button", { name: /review & share/i }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(/shared successfully/i))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: /done/i }).click();
}

/** Upload a file to the building at `street` via the Files dialog. */
export async function uploadBuildingFile(
  page: Page,
  street: string,
  fixturePath: string,
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  await row.getByRole("button", { name: "Manage files" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Add files" }))
    .toBeVisible({ timeout: T.visible });
  await dialog.locator('input[type="file"]').setInputFiles(fixturePath, {
    timeout: T.action,
  });
  const name = fixturePath.split("/").pop()!;
  await expect(dialog.getByText(name)).toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: /close/i }).click({ timeout: T.visible });
  await expect(dialog).toBeHidden({ timeout: T.visible });
}

/** Share the building at `street` directly with a recipient WebID ("By WebID"). */
export async function shareByWebId(
  page: Page,
  street: string,
  webId: string,
): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  const row = page.locator("li", { hasText: street }).first();
  await expect(row).toBeVisible({ timeout: T.action });
  await row.getByRole("button", { name: "Share building data" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: T.quick });
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

  const confirm = dialog.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dialog.getByRole("button", { name: /review & share/i }).click();
    await expect(confirm).toBeVisible({ timeout: T.quick });
  }).toPass({ timeout: T.poll });
  await confirm.click();
  await expect(dialog.getByText(/shared successfully/i))
    .toBeVisible({ timeout: T.action });
  await dialog.getByRole("button", { name: /done/i }).click();
}

/** The aggregated view name the share-view spec creates and shares. */
export const VIEW_NAME = "E2E Shared View";

/** Create the shared view (idempotent: reuse an existing one with VIEW_NAME). */
export async function ensureView(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  if (await page.locator("li").filter({ hasText: VIEW_NAME }).count()) return;

  await page.getByRole("button", { name: /create view/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: T.quick });
  // Default annual-portfolio mode (no role selection; for an annual-only building
  // set the "View type" dropdown isn't even shown). Metrics are pre-selected.
  await dialog.getByLabel("View Name").fill(VIEW_NAME);
  await dialog.getByLabel("Select Buildings").click();
  // Fail fast with a clear message if the picker is empty (no buildings to view),
  // rather than hanging on a click that waits out the whole test timeout.
  const firstBuilding = page.getByRole("option").first();
  await expect(firstBuilding, "a building to add to the view")
    .toBeVisible({ timeout: T.visible });
  await firstBuilding.click();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: /create view/i }).click();
  // Wait on the durable outcome — the view appears in the Aggregated-views list
  // and the dialog closes — NOT the transient success toast. The single FIFO
  // snackbar can be mid-showing an earlier notice (e.g. first-time "Set up the
  // views folder" provisioning), burying/delaying the success toast though the
  // view itself was created.
  await expect(page.locator("li").filter({ hasText: VIEW_NAME }).first())
    .toBeVisible({ timeout: T.action });
  // The row appears while the dialog is still fading out (MUI keeps it in the
  // DOM through the close transition). Don't return until it's gone, so a
  // caller's next role=dialog locator can't bind to this dialog's ghost.
  await expect(dialog).toBeHidden({ timeout: T.quick });
}

/**
 * The Share-tab "Views shared with you" list (named via the `<ul>`'s aria-label).
 * Present only when at least one view is shared; for the empty state assert the
 * section's "no views shared with you yet…" text on the page directly.
 */
export const receivedViews = (page: Page) =>
  page.getByRole("list", { name: /views shared with you/i });
