/**
 * Pure queue logic for the app's one notification snackbar (used by
 * NotificationContext). The snackbar shows a single toast at a time, so a burst
 * of `showNotification` calls — e.g. the login flow's inbox-setup notice landing
 * right before a refetch error — must not let a later message clobber an earlier
 * one. This keeps a FIFO queue: the current toast plays its full duration, then
 * the next is promoted on the exit transition. Nothing is dropped.
 *
 * Kept framework-agnostic and pure (like `dialogGuard.ts`) so it's unit-testable
 * without rendering MUI, which doesn't work under `deno test`.
 *
 * Invariant: `current === null` implies `pending` is empty (a queued notice
 * always has something showing ahead of it).
 */
export type NotificationSeverity = "error" | "warning" | "info" | "success";

export interface Notice {
  /** Unique, monotonic — the caller supplies it (React uses it as the Snackbar key). */
  key: number;
  message: string;
  severity: NotificationSeverity;
}

export interface QueueState {
  /** The notice currently showing (or animating out); null when idle. */
  current: Notice | null;
  /** Notices waiting their turn, in arrival order. */
  pending: Notice[];
  /** Whether the snackbar should be open (true → showing, false → idle/closing). */
  open: boolean;
}

export const initialQueueState: QueueState = {
  current: null,
  pending: [],
  open: false,
};

/**
 * Add a notice. If nothing is showing it becomes current and opens immediately;
 * otherwise it waits in `pending` so the current toast isn't cut short.
 */
export function enqueue(state: QueueState, notice: Notice): QueueState {
  if (state.current === null) {
    return { current: notice, pending: [], open: true };
  }
  return { ...state, pending: [...state.pending, notice] };
}

/** Begin closing the current toast (auto-hide or explicit dismiss). */
export function requestClose(state: QueueState): QueueState {
  return { ...state, open: false };
}

/**
 * Called once the close transition finishes: promote the next pending notice (if
 * any) to current and reopen, else go idle. This is what makes the queue drain.
 */
export function promoteNext(state: QueueState): QueueState {
  const [next, ...rest] = state.pending;
  if (next === undefined) return initialQueueState;
  return { current: next, pending: rest, open: true };
}
