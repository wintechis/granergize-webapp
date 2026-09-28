import { type MessageId, type MessageParams, translate } from "../../../src/lib/messages.ts";

/**
 * Video-spec language selection. The handbuch videos render the app in one
 * locale, chosen by `E2E_VID_LANG` (default `de`); every app locator resolves
 * through the message catalog via `vt(key)`, so the same specs produce a video
 * in any supported language:
 *
 *   deno task videos                       # German (default) → test-results/videos
 *   E2E_VID_LANG=fr deno task videos       # French          → test-results/videos-fr
 *   E2E_VID_LANG=en deno task videos       # English         → test-results/videos-en
 *
 * The on-screen CAPTIONS stay German regardless (a deliberate choice — the
 * overlay narration is German; only the app UI follows the locale).
 *
 * A handful of locators target VOCAB-generated text that carries no message id
 * (energy metric fields, the membership-role label, the benchmark row, the
 * "add all contributors" button) — those are resolved per language here.
 */

type Lang = "de" | "en" | "fr";

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;

export const VID_LANG: Lang = ((ENV?.E2E_VID_LANG as Lang) ?? "de");

/** The Playwright context locale that drives the app's `navigator.languages`. */
export const VID_LOCALE = ({ de: "de-DE", en: "en-US", fr: "fr-FR" } as const)[VID_LANG];

/** Output dir — German keeps the canonical `videos/`; others get a suffix so a
 *  French run can't overwrite the German deliverables. Mirrored by postprocess.sh. */
export const VID_OUT = VID_LANG === "de"
  ? "test-results/videos"
  : `test-results/videos-${VID_LANG}`;

/** The active-language form of a catalog message (the app renders in {@link VID_LOCALE}). */
export function vt(id: MessageId, params?: MessageParams): string {
  return translate(VID_LANG, id, params);
}

const pick = <T>(m: Record<Lang, T>): T => m[VID_LANG];

/** Energy metric field labels (vocab `consumption.ttl`). The French consumption
 *  label shares the "électricité" stem with *generation*, so match the fuller
 *  phrase to stay unambiguous. */
export const METRIC_ELEC = pick({
  de: /Stromverbrauch/,
  en: /Electricity consumption/,
  fr: /Consommation d'électricité/,
});
export const METRIC_HEAT = pick({
  de: /Wärmeverbrauch/,
  en: /Heat consumption/,
  fr: /Consommation de chaleur/,
});

/** The aggregation "Add all {count} contributors" button (has a count param). */
export const ADD_CONTRIBUTORS = pick({
  de: /Beitragenden hinzufügen/,
  en: /contributors/,
  fr: /contributeurs/,
});
