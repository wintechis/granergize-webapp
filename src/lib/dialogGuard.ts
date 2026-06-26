/** The reasons MUI's Dialog `onClose` reports (Escape, or a backdrop click). */
export type DialogCloseReason = "backdropClick" | "escapeKeyDown";

/** What a dialog should do for a dismissal attempt: close immediately, stay open,
 *  or ask the user to confirm discarding unsaved input first. */
export type DialogCloseDecision = "close" | "keepOpen" | "confirm";

/**
 * Decide what a dialog should do when the user tries to dismiss it, given how —
 * two safety nets so form input isn't lost by accident:
 *
 *   - a **backdrop click never closes** (the classic footgun: fill in a form,
 *     misclick outside, lose everything) — unless `dismissable` is set, for
 *     read-only info popups where clicking away is the expected dismissal;
 *   - **Escape** asks to `"confirm"` while there's unsaved input (`dirty`).
 *
 * Closing is suppressed entirely (`"keepOpen"`) while `busy` (a save/upload is
 * running). Explicit Cancel/X buttons should call the close routine directly and
 * bypass this.
 *
 * Pure so the logic stays unit-testable without rendering MUI (see
 * dialogGuard.test.ts): a `"confirm"` result is the *intent* to ask — the actual
 * async confirmation is run by `<Modal>` through `ConfirmContext`, not here, so
 * this function has no UI/`window.confirm` dependency.
 */
export function dialogCloseDecision(
  reason: DialogCloseReason,
  { dirty = false, busy = false, dismissable = false }: {
    dirty?: boolean;
    busy?: boolean;
    dismissable?: boolean;
  } = {},
): DialogCloseDecision {
  if (busy) return "keepOpen";
  if (reason === "backdropClick") return dismissable ? "close" : "keepOpen";
  // escapeKeyDown: confirm before discarding unsaved input, else close.
  return dirty ? "confirm" : "close";
}
