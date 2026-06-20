import { expect, type Page } from "@playwright/test";
import { t } from "./i18n.ts";
import { T } from "./timeouts.ts";

/**
 * Drive the ⌘K command palette (plan-palette §4) — the intent catalog made a
 * *callable surface for humans*. These helpers are the single way the CT-anchored
 * palette specs reach a verb: they open the palette, type the verb, and select it,
 * so the spec exercises the **registry-driven palette**, not the bespoke dialog's
 * own button. That distinction is the whole point of the palette specs.
 *
 * Architectural note: `CommandPalette` is mounted ONCE, in the app-shell
 * (`AppShell.tsx`), so ⌘K is live on the finder routes (`/buildings`,
 * `/aggregations`, …). A **form-eligible** verb (`ShareBuilding`, `AddRoom`,
 * `ShareAggregation`, the revoke/remove/room verbs — see `lib/paramForm.ts`)
 * surfaces in the palette WITHOUT a focused object and, on select, opens the
 * schema-driven **{@link IntentParamForm}** in place of the command list: the
 * form's entity pickers ARE the object selection. A **param-less write** verb
 * (`CreateRoom`, the dev seeders) fires straight away with no params. The remaining
 * rich verbs that own a bespoke dialog and are NOT form-eligible (Add/Edit building,
 * Enter energy) still route to a detail page with `?action=…`.
 *
 * So a CT spec drives Share through the palette's FORM (open ⌘K → run the verb →
 * fill the form → submit), not the old `?action=share` route.
 */

/** Open the ⌘K palette via the keyboard shortcut and wait for its filter field. */
export async function openPalette(page: Page): Promise<void> {
  // Ctrl-K is the cross-platform binding the component listens for (metaKey ||
  // ctrlKey); Playwright on Linux/CI maps Control reliably.
  await page.keyboard.press("Control+k");
  await expect(paletteInput(page)).toBeVisible({ timeout: T.visible });
}

/** The palette's filter TextField (its aria-label is the placeholder message). */
export function paletteInput(page: Page) {
  return page.getByRole("textbox", { name: t("palettePlaceholder") });
}

/** Select a command in the open palette by its visible (localized) label. */
async function selectPaletteCommand(
  page: Page,
  verb: string,
  label: string | RegExp,
): Promise<void> {
  await paletteInput(page).fill(verb);
  const item = page.getByRole("button", { name: label }).first();
  await expect(item).toBeVisible({ timeout: T.visible });
  await item.click();
}

/**
 * Open the palette, type `verb` to filter, and select the matching command by its
 * visible label (an exact, case-insensitive match against the localized label).
 * Asserts the palette closes afterward (selecting a *navigation / direct-invoke*
 * command closes the Modal-backed palette). For a form-eligible verb that opens the
 * second-step form instead, use {@link runPaletteFormCommand}.
 */
export async function runPaletteCommand(
  page: Page,
  verb: string,
  label: string | RegExp,
): Promise<void> {
  await openPalette(page);
  await selectPaletteCommand(page, verb, label);
  // Selecting a command closes the Modal-backed palette.
  await expect(paletteInput(page)).toBeHidden({ timeout: T.action });
}

/**
 * Open the palette, select a **form-eligible** verb, and wait for its schema-driven
 * {@link IntentParamForm} to render in place of the command list — keyed on the
 * form's title (the verb's localized intent label, e.g. "Share building"). The
 * caller then fills the form fields and submits via {@link submitPaletteForm}.
 * Returns the Playwright `dialog` locator scoping the open palette Modal.
 */
export async function runPaletteFormCommand(
  page: Page,
  verb: string,
  label: string | RegExp,
  formTitle: string | RegExp,
) {
  await openPalette(page);
  await selectPaletteCommand(page, verb, label);
  const dialog = page.getByRole("dialog");
  // The form replaces the filter field; its heading is the verb's intent label.
  await expect(dialog.getByRole("heading", { name: formTitle })).toBeVisible({
    timeout: T.visible,
  });
  await expect(paletteInput(page)).toBeHidden({ timeout: T.action });
  return dialog;
}

/** Click the param-form's submit ("Run") button and wait for the palette to close. */
export async function submitPaletteForm(page: Page): Promise<void> {
  await page.getByRole("button", { name: t("paramFormSubmit") }).click();
  // A successful invoke closes the Modal (onDone → close).
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: T.action });
}
