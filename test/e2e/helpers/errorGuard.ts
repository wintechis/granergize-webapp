import { expect, type Page } from "@playwright/test";

/**
 * Surface app errors to Playwright. The app mirrors error-severity notifications
 * to the console as `[notify] <message>` (see NotificationContext), and uncaught
 * exceptions arrive as page errors. Without this, a failure like
 * "Failed to read your inbox: …" only flashes a transient snackbar — the test
 * then just times out waiting for an element, hiding the real cause.
 *
 * Attach right after creating the page (before login). Call `assertNoAppErrors()`
 * at a point where you expect success (e.g. before a long "wait for X" assertion)
 * so a regression fails fast with the actual message instead of a mystery timeout.
 */
export function watchAppErrors(page: Page): { assertNoAppErrors: () => void } {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("[notify]")) {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return {
    assertNoAppErrors: () =>
      expect(
        errors,
        `app raised error notification(s):\n${errors.join("\n")}`,
      ).toEqual([]),
  };
}
