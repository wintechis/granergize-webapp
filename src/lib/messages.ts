/**
 * App-chrome message catalog + translator (M5 app-chrome i18n, slice 2).
 *
 * The OTHER text population from the vocab-derived labels (`vocabLabels.ts`): the
 * UI strings with no ontology term — empty states, buttons, dialog titles, the
 * notification vocabulary. A bundled `{de,en,fr}` map keyed by a stable, language-
 * neutral id (English is the authoring baseline); no runtime fetch, mirroring the
 * vocab-label stance. Read through `useT()` (`context/I18nProvider`) so a locale
 * switch re-renders with no refetch; the active locale is the one shared signal
 * (`lib/language.ts`) that also drives the vocab label map.
 *
 * Pure (no React) so it stays hermetically testable. Interpolation is by NAMED
 * params (`{name}`), never positional, so word order can differ across languages;
 * a plural entry carries one string per `Intl.PluralRules` category, selected by
 * `{count}`.
 */
import { DEFAULT_LANG, getLanguage, type Lang } from "./language.ts";
import type { Message, PluralForms } from "./messages/messageTypes.ts";
import { navFinders } from "./messages/navFinders.ts";
import { buildingForms } from "./messages/buildingForms.ts";
import { energyRegional } from "./messages/energyRegional.ts";
import { buildingDetail } from "./messages/buildingDetail.ts";
import { cubeObservation } from "./messages/cubeObservation.ts";
import { shellAuth } from "./messages/shellAuth.ts";
import { detailRooms } from "./messages/detailRooms.ts";
import { dialogsShare } from "./messages/dialogsShare.ts";
import { notifications } from "./messages/notifications.ts";
import { landing } from "./messages/landing.ts";

/** Named interpolation params; `count` additionally drives plural selection. */
export type MessageParams = Record<string, string | number>;

/**
 * The catalog — assembled from the per-area slices in `./messages/` so no single
 * file is unwieldy. Add an id to the slice for its surface; the id is what code
 * references via `t(id)`, so a translator never touches the call sites.
 */
export const MESSAGES = {
  ...navFinders,
  ...buildingForms,
  ...energyRegional,
  ...buildingDetail,
  ...cubeObservation,
  ...shellAuth,
  ...detailRooms,
  ...dialogsShare,
  ...notifications,
  ...landing,
} satisfies Record<string, Message>;

export type MessageId = keyof typeof MESSAGES;

const isPlural = (v: string | PluralForms): v is PluralForms =>
  typeof v === "object";

/** Replace every `{name}` with `params[name]` (missing → left as-is, visible). */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(
    /\{(\w+)\}/g,
    (whole, key) => (key in params ? String(params[key]) : whole),
  );
}

/**
 * Resolve a message id to a string in `lang`. Falls back to the {@link DEFAULT_LANG}
 * string for a missing translation, and (for a plural entry) to the `other` form
 * when the selected category is absent. Pure — the active locale is passed in.
 */
export function translate(
  lang: Lang,
  id: MessageId,
  params?: MessageParams,
): string {
  const entry = MESSAGES[id] as Record<Lang, string | PluralForms>;
  const value = entry[lang] ?? entry[DEFAULT_LANG];
  if (isPlural(value)) {
    const count = typeof params?.count === "number" ? params.count : 0;
    const cat = new Intl.PluralRules(lang).select(count);
    const form = value[cat] ?? value.other;
    return interpolate(form, params);
  }
  return interpolate(value, params);
}

/**
 * Resolve a message id in the CURRENT active locale — the imperative counterpart
 * to `useT()`/`translate`. For one-shot strings fired outside render (notification
 * toasts in handlers/effects/`onSuccess`): it reads `getLanguage()` at call time,
 * so the toast shows in the locale active when it fires, no React/hook needed. Use
 * `useT()` for strings RENDERED in the tree (they must re-render on a locale switch).
 */
export function msg(id: MessageId, params?: MessageParams): string {
  return translate(getLanguage(), id, params);
}
