import { type MessageId, type MessageParams, translate } from "../../../src/lib/messages.ts";

/**
 * The English form of a catalog message — the single source of truth for spec
 * assertions on app-chrome strings, so a catalog edit can never drift from the
 * specs (the e2e locale is pinned to `en` in playwright.config, so the app renders
 * exactly this). Reuses the app's own `translate` (handles named params + plurals),
 * so a spec asserts `getByText(en("contactsEmpty"))` instead of a hardcoded copy.
 *
 * This checks the WIRING (the right message id is used at the right place, and the
 * spec stays in lock-step with the catalog) — not the translation's correctness,
 * which is `src/lib/messages.test.ts`'s job.
 */
export function en(id: MessageId, params?: MessageParams): string {
  return translate("en", id, params);
}

/**
 * The German form of a catalog message — for specs that render the app in German
 * (a context with `locale: "de-DE"`, e.g. the handbuch videos). Same lock-step
 * guarantee as {@link en}: locators resolve to whatever the catalog says in `de`,
 * so they match the rendered German UI.
 */
export function de(id: MessageId, params?: MessageParams): string {
  return translate("de", id, params);
}

/** The French form of a catalog message (for a `locale: "fr-FR"` context). */
export function fr(id: MessageId, params?: MessageParams): string {
  return translate("fr", id, params);
}
