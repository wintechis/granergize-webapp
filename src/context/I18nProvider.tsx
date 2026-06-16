import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useLanguage } from "../hooks/language.ts";
import {
  type MessageId,
  type MessageParams,
  translate,
} from "../lib/messages.ts";

/** Translate an app-chrome message id in the active locale. */
export type TFn = (id: MessageId, params?: MessageParams) => string;

const I18nContext = createContext<TFn | null>(null);

/**
 * Provides `t()` bound to the active locale. Re-renders consumers on a locale
 * switch (it reads `useLanguage`), with no refetch — text is a presentation fact.
 * Mount once near the top of the provider stack.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useLanguage();
  const t = useMemo<TFn>(
    () => (id, params) => translate(lang, id, params),
    [lang],
  );
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** Read the locale-bound translator. Must be used within {@link I18nProvider}. */
// Provider + its hook colocated (the standard context pattern, as in
// NotificationContext/ConfirmContext); the hook isn't a component.
// eslint-disable-next-line react-refresh/only-export-components
export function useT(): TFn {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT must be used within an I18nProvider");
  return t;
}
