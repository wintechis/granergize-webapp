/** The reasons MUI's Dialog `onClose` reports (Escape, or a backdrop click). */
export type DialogCloseReason = "backdropClick" | "escapeKeyDown";

/**
 * Decide whether a dialog should actually close, given how the user tried to
 * dismiss it — two safety nets so form input isn't lost by accident:
 *
 *   - a **backdrop click never closes** (the classic footgun: fill in a form,
 *     misclick outside, lose everything) — unless `dismissable` is set, for
 *     read-only info popups where clicking away is the expected dismissal;
 *   - **Escape** asks to confirm while there's unsaved input (`dirty`).
 *
 * Closing is suppressed entirely while `busy` (a save/upload is running).
 * Explicit Cancel/X buttons should call the close routine directly and bypass
 * this. Kept as a pure function so the logic is unit-testable without rendering
 * MUI (see dialogGuard.test.ts); the `<Modal>` wrapper wires it into MUI's
 * `onClose`.
 */
export function shouldDialogClose(
  reason: DialogCloseReason,
  { dirty = false, busy = false, dismissable = false }: {
    dirty?: boolean;
    busy?: boolean;
    dismissable?: boolean;
  } = {},
): boolean {
  if (busy) return false;
  if (reason === "backdropClick") return dismissable;
  if (
    reason === "escapeKeyDown" && dirty &&
    !globalThis.confirm("Discard your changes?")
  ) {
    return false;
  }
  return true;
}
