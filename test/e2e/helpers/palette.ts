import { expect, type Page } from "@playwright/test";
import { en } from "./i18n.ts";
import { T } from "./timeouts.ts";

/**
 * Drive the ⌘K command palette (plan-palette §4) — the intent catalog made a
 * *callable surface for humans*. These helpers are the single way the CT-anchored
 * palette specs reach a verb: they open the palette, type the verb, and select it,
 * so the spec exercises the **registry-driven palette**, not the bespoke dialog's
 * own button. That distinction is the whole point of the palette specs.
 *
 * Architectural note (the residual the specs are designed around): `CommandPalette`
 * is mounted ONCE, in the app-shell (`AppShell.tsx`), so ⌘K is live only on the
 * finder routes (`/buildings`, `/aggregations`, …) — NOT on the shell-less
 * standalone detail pages (`/building`, `/observation`, `/aggregation`), which
 * render as siblings of the shell (`App.tsx`). With no object focused in the shell
 * (`PaletteFocusContext` is set only by those detail pages, which the palette can't
 * see), the palette there offers the **navigation** verbs and the always-applicable
 * **collection-create** verbs (Add building, Create aggregation). The object-scoped
 * rich verbs (Share, Enter energy, Share aggregation) route to a detail page with
 * `?action=…`, which the surface auto-opens — so a CT spec drives the create/share-back
 * legs through the palette directly, and asserts the object-verb legs via the
 * palette's `?action=` routing contract (the same URL `CommandPalette.run()` builds).
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
  return page.getByRole("textbox", { name: en("palettePlaceholder") });
}

/**
 * Open the palette, type `verb` to filter, and select the matching command by its
 * visible label (an exact, case-insensitive match against the localized label).
 * Asserts the palette closes afterward (selecting a command closes it).
 */
export async function runPaletteCommand(
  page: Page,
  verb: string,
  label: string | RegExp,
): Promise<void> {
  await openPalette(page);
  await paletteInput(page).fill(verb);
  const item = page.getByRole("button", { name: label }).first();
  await expect(item).toBeVisible({ timeout: T.visible });
  await item.click();
  // Selecting a command closes the Modal-backed palette.
  await expect(paletteInput(page)).toBeHidden({ timeout: T.action });
}
