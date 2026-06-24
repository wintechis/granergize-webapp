import { expect, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { E2E_LANG, en } from "../helpers/i18n.ts";
import { translate } from "../../../src/lib/messages.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * App-chrome i18n e2e (M5 slice 2/3): the Account-menu language switcher flips a
 * migrated app-chrome string in place — no reload — proving the catalog + `t()` +
 * the shared active-locale signal end to end. Uses the Contacts finder's empty
 * state (a migrated string, visible on a clean start). Other chrome (nav tabs, …)
 * is not migrated yet, so it stays English — only the migrated string changes.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/i18n.spec.ts
 *
 * Runs against Alice (account A); self-cleaning, and resets the locale to English.
 */
const ACC = account("A");

test.describe("app-chrome i18n: language switcher", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the i18n e2e.`,
  );
  // This spec asserts a SPECIFIC English→German switch from an English start, so it
  // only makes sense when the run's base language is English. Under `E2E_LANG=fr|de`
  // the app seeds that language instead, so skip (the switcher itself is exercised by
  // every other spec running in its configured language).
  test.skip(
    E2E_LANG !== "en",
    `i18n switcher spec assumes an English base; E2E_LANG=${E2E_LANG}.`,
  );

  test("switching the UI language flips a migrated app-chrome string in place", async ({ browser }) => {
    test.setTimeout(T.setup); // login (IdP + consent) can be slow / retried
    const page = await newCapturedPage(browser, "i18n");
    await login(page, ACC);
    await assertCleanStart(page);
    try {
      // Contacts is empty on a clean start → its migrated empty-state shows. Assert
      // against the CATALOG (en form), not a hardcoded copy, so the spec can't drift
      // from the message — `en("agentsEmpty")` is the single source of truth.
      await page.getByRole("tab", { name: en("navAgents") }).click();
      const englishEmpty = page.getByText(en("agentsEmpty"));
      await expect(englishEmpty).toBeVisible({ timeout: T.action });

      // Switch the UI language to German via the Account-menu switcher.
      await page.getByRole("button", { name: /Account menu/ }).click();
      await page.getByRole("combobox", { name: "Language" }).click();
      await page.getByRole("option", { name: "Deutsch" }).click();
      await page.keyboard.press("Escape"); // close the Account menu

      // The empty state re-renders in German — no reload (context re-render). The
      // German form also comes from the catalog (`translate("de", …)`), so the
      // assertion follows any future copy edit.
      const germanEmpty = page.getByText(translate("de", "agentsEmpty"));
      await expect(germanEmpty).toBeVisible({ timeout: T.action });
      await expect(englishEmpty).toHaveCount(0);

      // The choice is persisted (localStorage) and survives a reload — on reload
      // the locale is re-seeded from storage, not the browser preference, so the
      // app comes back in German (the language is a per-device preference).
      expect(
        await page.evaluate(() =>
          globalThis.localStorage.getItem("granergize.language")
        ),
      ).toBe("de");
      await page.reload();
      // The locale persisted as German, so the NAV labels are German too now —
      // click the Contacts tab by its German label (`Kontakte`), not the en form.
      await page.getByRole("tab", { name: translate("de", "navAgents") }).click();
      await expect(page.getByText(translate("de", "agentsEmpty")))
        .toBeVisible({ timeout: T.login }); // reload re-runs the session restore
    } finally {
      // Reset the persisted locale so it can't bleed into other specs.
      await page.evaluate(() =>
        globalThis.localStorage.setItem("granergize.language", "en")
      ).catch(() => {});
      await verifyAndReset(page, "i18n");
      await page.close();
    }
  });
});
