import { type MessageId, type MessageParams, translate } from "../../../src/lib/messages.ts";
import type { Lang } from "../../../src/lib/language.ts";
import { roleLabel } from "../../../src/constants/roles.ts";
import { annualMetricLabel } from "../../../src/constants/annualMetrics.ts";
import { getEnv } from "../../config/env.ts";

/**
 * The language the SUITE renders + asserts in, chosen once by `E2E_LANG`
 * (`en` | `de` | `fr`, default `en`). The Playwright UI locale is derived from the
 * same var (`playwright.config.ts`), so the app renders this language and the
 * locators below resolve to its catalog strings — the whole suite runs end-to-end
 * in any supported language via `E2E_LANG=fr deno task e2e:local`. Unset ⇒ English
 * ⇒ the historical behaviour, unchanged.
 */
export const E2E_LANG: Lang = ((): Lang => {
  const v = getEnv("E2E_LANG");
  return v === "de" || v === "fr" || v === "en" ? v : "en";
})();

/**
 * A catalog message in the RUN's language (`E2E_LANG`) — the single source of truth
 * for spec assertions on app-chrome strings, so a catalog edit can never drift from
 * the specs AND the same spec runs in any supported language. Reuses the app's own
 * `translate` (handles named params + plurals), so a spec asserts
 * `getByText(t("contactsEmpty"))` instead of a hardcoded, English-only copy.
 *
 * This checks the WIRING (the right message id is used at the right place, and the
 * spec stays in lock-step with the catalog) — not the translation's correctness,
 * which is `src/lib/messages.test.ts`'s job. Prefer `t(...)` in new and converted
 * specs; `en`/`de`/`fr` remain for the few specs that assert a SPECIFIC language
 * regardless of the run (e.g. `i18n.spec.ts`'s before/after switch).
 */
export function t(id: MessageId, params?: MessageParams): string {
  return translate(E2E_LANG, id, params);
}

/**
 * The English form of a catalog message, regardless of `E2E_LANG`. Use only when a
 * spec must assert English specifically (e.g. the language switcher's "before"
 * state); locale-agnostic specs use {@link t}.
 */
export function en(id: MessageId, params?: MessageParams): string {
  return translate("en", id, params);
}

/**
 * A RegExp matching a catalog message in the run language with its `{param}`
 * placeholders left as wildcards — for an accessible name carrying a runtime value
 * the spec doesn't pin (e.g. "Add all {count} contributors", where the count
 * varies). Literal text is escaped; each unfilled `{param}` becomes `.+`.
 */
export function tPattern(id: MessageId): RegExp {
  const raw = translate(E2E_LANG, id);
  const escaped = raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\{[a-zA-Z]+\\}/g, ".*");
  return new RegExp(escaped);
}

/**
 * The Add/Import building dialog's submit button name — "Add Building" (manual) or
 * "Add {n} Buildings" (import, the plural form), matched in the run language. The
 * count is a wildcard since the spec doesn't pin how many the fixture imports.
 */
export function addBuildingSubmitRe(): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const manual = esc(translate(E2E_LANG, "addBuildingBtn"));
  const plural = esc(translate(E2E_LANG, "addBuildingsCount", { count: 7 }))
    .replace(/7/, "\\d+");
  return new RegExp(`^(${manual}|${plural})$`);
}

/**
 * Matches the "building(s) added" success toast in the run language — either the
 * singular ("Building added") or the plural ("{count} buildings added") form, with
 * the count wildcarded since the fixture's import size isn't pinned.
 */
export function buildingsAddedRe(): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const one = esc(translate(E2E_LANG, "addBuildingAddedCount", { count: 1 }));
  const many = esc(translate(E2E_LANG, "addBuildingAddedCount", { count: 7 }))
    .replace(/7/, "\\d+");
  return new RegExp(`(${one}|${many})`);
}

// ── Vocab-derived labels (the SECOND i18n path: field/role/metric names come from
// the `vocab/*.ttl` documents, not the chrome catalog). These resolve in the run's
// language too, so a spec locates them the same way it locates chrome strings. ──

/** A data-room membership role's vocab label in the run language (e.g. "User" →
 * "Utilisateur"); the role dropdown options are labelled this way. */
export function roleT(role: string): string {
  return roleLabel(role, E2E_LANG);
}

/** An annual energy metric's full vocab label with unit in the run language —
 * `"electricityConsumption"` → "Electricity consumption (kWh)" / "Consommation
 * d'électricité (kWh)". The energy-entry spinbutton labels use this. */
export function metricT(key: string): string {
  return annualMetricLabel(key, E2E_LANG);
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
