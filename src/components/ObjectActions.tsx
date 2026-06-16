import { type ReactNode, useMemo } from "react";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import IconAction from "./IconAction.tsx";
import { applicableIntents, type IntentObject } from "../intents/applicable.ts";
import { intentLabelKey } from "../intents/labels.ts";
import { useDevMode } from "../hooks/devMode.ts";
import { useT } from "../context/I18nProvider.tsx";
import type { MessageId } from "../lib/messages.ts";

/**
 * The per-object action menu, driven by the canonical intent catalog
 * (`intents/catalog.ts` + `affordances.ts`, composed by
 * {@link applicableIntents}). Given the object it renders and a map of click
 * handlers (keyed by the intent's stable `name`), it asks the resolver which verbs
 * apply — the affordance `applies()` guards + the catalog's dev-mode exposure
 * decide, not inline conditionals — and renders each as the shared
 * {@link IconAction} icon-button, label localised via the app's i18n
 * ({@link intentLabelKey}). One ordered, state-filtered action vocabulary reused
 * across the finders (and the ⌘K palette reads the SAME resolver — `commandPalette.ts`).
 *
 * Each intent maps to its icon here; the handler (dialog/confirm/notify) stays the
 * surface's own, keyed by `name`. A `pending(name)` predicate disables a verb's
 * button while its mutation is in flight (no inline spinner — UI policy). A verb
 * surfaces only when (1) it applies, (2) it has an i18n label key, and (3) the
 * caller supplied a handler for it.
 */
const ICONS: Record<string, ReactNode> = {
  DeleteBuilding: <DeleteIcon fontSize="small" />,
  ShareBuilding: <ShareIcon fontSize="small" />,
  ToggleVisibility: <VisibilityOffIcon fontSize="small" />,
  RefreshAggregation: <RefreshIcon fontSize="small" />,
  ShareAggregation: <ShareIcon fontSize="small" />,
  DeleteAggregation: <DeleteIcon fontSize="small" />,
};

/** Verbs rendered with the destructive (error) colour. */
const DESTRUCTIVE = new Set(["DeleteBuilding", "DeleteAggregation"]);

/** Per-intent click handlers, keyed by the intent's stable `name`. */
export type IntentHandlers = Record<string, () => void>;

export interface ObjectActionsProps {
  /** The object the verbs act on (own/shared building, aggregation, …). */
  object: IntentObject;
  /** Per-intent click handlers, keyed by the intent's stable `name`. */
  handlers: IntentHandlers;
  /** Is the verb's mutation in flight? (Disables its button — no spinner.) */
  pending?: (name: string) => boolean;
  /** Extra leading actions the catalog doesn't model (e.g. navigate-to-detail). */
  leading?: ReactNode;
}

export default function ObjectActions(
  { object, handlers, pending, leading }: ObjectActionsProps,
) {
  const devMode = useDevMode();
  const t = useT();
  // The ordered, filtered, labelled action set: applicable (affordance guard +
  // dev-mode exposure) ∧ has a label key ∧ a handler was supplied.
  const actions = useMemo(() => {
    return applicableIntents(object, { devMode })
      .map((entry) => {
        const key = intentLabelKey(entry.name);
        const onClick = handlers[entry.name];
        if (!key || !onClick) return null;
        return { name: entry.name, label: t(key as MessageId), onClick };
      })
      .filter((a): a is { name: string; label: string; onClick: () => void } =>
        a != null
      );
  }, [object, devMode, handlers, t]);

  return (
    <>
      {leading}
      {actions.map((a) => (
        <IconAction
          key={a.name}
          label={a.label}
          icon={ICONS[a.name]}
          color={DESTRUCTIVE.has(a.name) ? "error" : undefined}
          onClick={a.onClick}
          disabled={pending?.(a.name) ?? false}
        />
      ))}
    </>
  );
}
