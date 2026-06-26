import type { Lang } from "../language.ts";

/** A message is one string per language, OR — for counts — one string per plural
 * category (selected via `Intl.PluralRules` on `{count}`). `other` is required. */
export type PluralForms = { other: string } & Partial<
  Record<Intl.LDMLPluralRule, string>
>;

/** One `{de,en,fr}` map (plain, or plural-form) keyed entry of the catalog. */
export type Message = Record<Lang, string> | Record<Lang, PluralForms>;
