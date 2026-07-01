/**
 * The shared **invoke-an-intent-from-the-palette** effect (form step + direct
 * invoke). The ⌘K palette has two ways to fire a catalog verb that bypass the
 * per-intent mutation hooks (it calls the core directly through {@link invokeByName}):
 * the schema-driven param form (`IntentParamForm`) and the param-less direct-invoke
 * commands (`CreateRoom`, the dev seeders, …). Both need the SAME outcome handling,
 * so it lives here once:
 *
 * - dispatch through {@link invokeByName} (the headless entry the deep links and the
 *   bench seeder also use);
 * - on success, the shared cache settlement ({@link settlePaletteInvoke}): a room
 *   verb patches the never-invalidated rooms registry exactly like its hook
 *   adapter would, then a **blanket** `invalidateQueries` of everything else (the
 *   form/palette bypasses the hooks that would own their invalidations, and these
 *   run rarely — a manual ⌘K action, not a hot path) + a brief success toast;
 * - on error, honour the catalog's `silentError`: a silent verb surfaces its error
 *   inline (the caller renders the returned message through an `<Alert>`); every
 *   other verb routes it to the central toast (`formatError`/`classifyQueryError`).
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, inlineError }` on failure —
 * `inlineError` is non-null only for a `silentError` verb (the central toast has
 * already fired otherwise). The caller decides what to do with `ok` (close the
 * palette, clear a busy flag).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "../context/I18nProvider.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { getGateway } from "./session.ts";
import { findIntent } from "../intents/applicable.ts";
import { invokeByName } from "../intents/registry.ts";
import { settlePaletteInvoke } from "./roomRegistry.ts";
import { classifyQueryError } from "./queryErrors.ts";
import { formatError } from "../lib/formatError.ts";
import type { MessageId } from "../lib/messages.ts";

/** The outcome of {@link useInvokeIntent}'s effect. */
export type InvokeOutcome =
  | { ok: true }
  | { ok: false; inlineError: string | null };

/**
 * Returns an async effect that invokes a catalog verb by name with the given
 * params and applies the shared palette outcome handling (see the module doc).
 */
export function useInvokeIntent(): (
  name: string,
  params: Record<string, unknown>,
) => Promise<InvokeOutcome> {
  const t = useT();
  const { showNotification } = useNotification();
  const qc = useQueryClient();

  return async (name, params) => {
    const entry = findIntent(name);
    try {
      const result = await invokeByName(name, params, getGateway());
      await settlePaletteInvoke(qc, name, result);
      showNotification(t("paramFormSuccess"), "success");
      return { ok: true };
    } catch (err) {
      if (entry?.silentError) {
        return { ok: false, inlineError: classifyQueryError(err).message };
      }
      const action = entry?.action;
      showNotification(
        action
          ? formatError(action as MessageId, err)
          : classifyQueryError(err).message,
        "error",
      );
      return { ok: false, inlineError: null };
    }
  };
}
