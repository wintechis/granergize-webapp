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
