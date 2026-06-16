import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import type { IntentObject } from "../intents/applicable.ts";

/**
 * The object the ⌘K command palette acts on, plus the surface's per-intent direct
 * handlers (plan-palette §4).
 *
 * The palette is a global surface but a verb acts on the **focused/selected**
 * object — so a page that has a current object *registers* it here (with the
 * handlers for the param-less verbs it can fire directly: hide/delete/refresh).
 * When nothing is registered the palette shows only the global navigation verbs.
 * Param-ful verbs (share/edit/create) need no handler — the palette routes to
 * their bespoke dialog by navigating to the object's page (§5 is the later
 * generic-form polish).
 *
 * Kept a tiny client-only context (mirroring NotificationContext/ConfirmContext):
 * no Pod state, no React Query — just the current in-memory focus.
 */
export interface PaletteFocus {
  /** The object the palette's verbs act on, or `undefined` for navigation-only. */
  object: IntentObject;
  /** Per-intent direct handlers, keyed by the descriptor's stable `name`. */
  handlers: Record<string, () => void>;
}

interface PaletteFocusValue {
  focus: PaletteFocus;
  /** Replace the current focus (a page sets its object + handlers). */
  setFocus: (focus: PaletteFocus) => void;
  /** Clear the focus back to navigation-only (on unmount / deselect). */
  clearFocus: () => void;
}

const EMPTY: PaletteFocus = { object: undefined, handlers: {} };

const PaletteFocusContext = createContext<PaletteFocusValue | null>(null);

export function PaletteFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<PaletteFocus>(EMPTY);
  const value = useMemo<PaletteFocusValue>(
    () => ({ focus, setFocus, clearFocus: () => setFocus(EMPTY) }),
    [focus],
  );
  return (
    <PaletteFocusContext.Provider value={value}>
      {children}
    </PaletteFocusContext.Provider>
  );
}

/** Read the current palette focus + the setters. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePaletteFocus(): PaletteFocusValue {
  const v = useContext(PaletteFocusContext);
  if (!v) {
    throw new Error("usePaletteFocus must be used within a PaletteFocusProvider");
  }
  return v;
}
