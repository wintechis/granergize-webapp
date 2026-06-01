import type { DialogProps } from "@mui/material";

/**
 * Build a Dialog `onClose` handler with two safety nets, so a form's contents
 * aren't lost by accident:
 *
 *   - **Backdrop click** never closes the dialog (the classic footgun: fill in
 *     a form, misclick outside, lose everything).
 *   - **Escape** asks for confirmation when `dirty` is true (the form has
 *     unsaved input); when not dirty it closes silently.
 *
 * Explicit Cancel / X buttons should call the real close routine directly —
 * those are deliberate actions and don't go through here.
 *
 * @param close  the real close routine (resets state + calls onClose)
 * @param dirty  whether the form has unsaved input (gates the Escape confirm)
 * @param busy   when true, suppress closing entirely (a save/upload is running)
 */
export function guardedDialogClose(
  close: () => void,
  { dirty = false, busy = false }: { dirty?: boolean; busy?: boolean } = {},
): NonNullable<DialogProps["onClose"]> {
  return (_event, reason) => {
    if (busy) return;
    if (reason === "backdropClick") return;
    if (
      reason === "escapeKeyDown" && dirty &&
      !globalThis.confirm("Discard your changes?")
    ) {
      return;
    }
    close();
  };
}
