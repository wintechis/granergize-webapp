import { expect, type Page } from "@playwright/test";

/**
 * Best-effort: delete every data room this account OWNS, leaving the Pod's room
 * list empty. Owned rooms are the only ones that show a "Delete data room"
 * button (joined/external rooms don't), so this never touches another Pod's
 * rooms. Used by specs' afterAll so a created room doesn't outlive the test —
 * rooms persist in the Pod, and otherwise leak on every run (e.g. a failed room
 * test, or sharing's room that must survive its own parts). Hosting/deleting
 * confirms via window.confirm, so the caller must auto-accept dialogs
 * (`page.on("dialog", (d) => d.accept())`).
 *
 * Swallows errors — cleanup must never fail the suite — but caps the loop so a
 * never-shrinking list can't spin forever.
 */
export async function deleteAllOwnedRooms(page: Page): Promise<void> {
  try {
    const connect = page.getByRole("tab", { name: "Connect" });
    if (await connect.count()) await connect.click();

    const deleteButtons = page.getByRole("button", { name: "Delete data room" });
    for (let i = 0; i < 50; i++) {
      const remaining = await deleteButtons.count();
      if (remaining === 0) return;
      await deleteButtons.first().click();
      // Wait for this delete to take effect (one fewer button) before the next.
      await expect(deleteButtons).toHaveCount(remaining - 1, { timeout: 45_000 });
    }
  } catch {
    // Cleanup is best-effort; never let it fail the run.
  }
}
