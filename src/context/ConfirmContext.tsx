import React, {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Button, Typography } from "@mui/material";
import Modal from "../components/Modal.tsx";

export interface ConfirmOptions {
  /** Header text (default "Please confirm"). */
  title?: string;
  /** Body — a string may carry `\n` line breaks (rendered pre-line). */
  message: ReactNode;
  /** Primary-button label (default "Confirm"). Use the verb, e.g. "Delete". */
  confirmLabel?: string;
  /** Cancel-button label (default "Cancel"). */
  cancelLabel?: string;
  /**
   * A destructive action (default true — every current caller deletes/revokes/
   * wipes). Renders the primary button as `color="error"`.
   */
  destructive?: boolean;
}

interface ConfirmContextValue {
  /** Open the shared confirm dialog; resolves true if the user confirms. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * The single confirmation mechanism for the app — the dialog counterpart to
 * `NotificationContext`. `useConfirm()` returns an async `confirm(options)` that
 * opens one shared `Modal` and resolves to the user's choice, so a call site
 * reads `if (!await confirm({ … })) return;` — replacing the unstyled,
 * unthemeable, un-e2e-testable native `window.confirm`. (The lone remaining
 * native confirm is the Escape-while-dirty guard in `dialogGuard.ts`, which must
 * stay synchronous.)
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // The pending promise's resolver; settled exactly once per open.
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const destructive = options?.destructive ?? true;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => settle(false)}
        title={options?.title ?? "Please confirm"}
        actions={options && (
          <>
            <Button variant="text" onClick={() => settle(false)}>
              {options.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant="contained"
              color={destructive ? "error" : "primary"}
              onClick={() => settle(true)}
            >
              {options.confirmLabel ?? "Confirm"}
            </Button>
          </>
        )}
      >
        <Typography variant="body1" sx={{ whiteSpace: "pre-line" }}>
          {options?.message}
        </Typography>
      </Modal>
    </ConfirmContext.Provider>
  );
}

// The hook is co-located with its Provider (the canonical context pattern); the
// react-refresh one-component-per-file rule is waived here as in NotificationContext.
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside ConfirmProvider");
  }
  return ctx;
}
