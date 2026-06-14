import { type ReactNode } from "react";
import {
  type Breakpoint,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { shouldDialogClose } from "../lib/dialogGuard.ts";

export interface ModalProps {
  open: boolean;
  /**
   * The real close routine (resets state + notifies the parent). Called when the
   * user dismisses via Escape and the guard passes; explicit Cancel/X buttons
   * should call it directly (a deliberate close needs no guard).
   */
  onClose: () => void;
  /** Header text. Omit for a header-less dialog. */
  title?: ReactNode;
  children: ReactNode;
  /** Footer actions (right-aligned). Omit/`false` for no button row. */
  actions?: ReactNode;
  /**
   * A full-dialog overlay rendered above title/body/actions — e.g. a "busy
   * curtain" while a save runs. Position it with `position: absolute; inset: 0`;
   * the dialog's Paper is a positioned ancestor.
   */
  overlay?: ReactNode;
  /** MUI width preset (default "sm"). */
  maxWidth?: Breakpoint;
  /** When true, Escape asks to confirm before closing (unsaved input). */
  dirty?: boolean;
  /** When true, the dialog can't be closed (a save/upload is running). */
  busy?: boolean;
  /**
   * When true, a backdrop click also closes (for read-only info popups where
   * clicking away is the expected dismissal). Forms leave this off so a misclick
   * can't discard input.
   */
  dismissable?: boolean;
}

/**
 * The single dialog wrapper for the whole app (UI-conventions rule: no raw MUI
 * `Dialog` — that import is ESLint-banned outside this file). Backed by MUI
 * `Dialog`, it fixes one structure (title / content / actions / optional
 * overlay), defaults (`fullWidth`, width preset), and the close-guard semantics
 * (backdrop never closes; Escape confirms while `dirty`; suppressed while
 * `busy`) via {@link shouldDialogClose}, so every dialog behaves identically.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  overlay,
  maxWidth = "sm",
  dirty = false,
  busy = false,
  dismissable = false,
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (shouldDialogClose(reason, { dirty, busy, dismissable })) onClose();
      }}
      fullWidth
      maxWidth={maxWidth}
      slotProps={{ paper: { sx: { position: "relative" } } }}
    >
      {overlay}
      {title != null && <DialogTitle>{title}</DialogTitle>}
      <DialogContent>{children}</DialogContent>
      {actions ? <DialogActions>{actions}</DialogActions> : null}
    </Dialog>
  );
}
