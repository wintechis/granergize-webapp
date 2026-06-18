import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { en } from "../helpers/i18n.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { openBuildingsList } from "../helpers/manage.ts";
import { openPalette, paletteInput } from "../helpers/palette.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * CT "paste-and-launch" — the ⌘K palette's **dev-mode JSON input mode**
 * (`plan-intent-core.md` §10). A pasted, fully-specified `{ name, params }` is the
 * launcher's pre-filled input: the palette parses it, resolves the effect from the
 * catalog, and dispatches through the SAME entry pick-a-verb uses
 * (`invokeByName`/`queryByName`). This is the launcher, not an interpreter — there
 * is no language to interpret.
 *
 * Two cases, both deterministic (no peer, no Pod state to assert beyond the
 * dispatch outcome):
 *   1. an UNKNOWN intent name → the launcher shows its parse/resolve reason inline
 *      and does NOT close (nothing dispatched);
 *   2. a valid param-less WRITE (`CreateRoom`) → the palette closes and the shared
 *      success toast ("Done") fires — proof the JSON reached the real dispatch.
 *
 * The JSON box is dev-gated, so the spec enables Developer mode first; a query that
 * does NOT start with `{` stays an ordinary command filter (unchanged behaviour).
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/palette-launch-json.spec.ts
 *
 * Runs against Alice (account A). Self-cleaning (verifyAndReset wipes the
 * collection). Skipped when account env vars are absent.
 */

const ACC = account("A");

test.describe.configure({ mode: "serial" });

test.describe("palette: paste-and-launch a JSON intent", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the paste-and-launch e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "palette-launch-json");
    await login(page, ACC);
    await assertCleanStart(page);
    // The JSON paste-and-launch input mode is a Developer-mode affordance.
    await setDevMode(page, true);
  });

  test.afterAll(async () => {
    test.setTimeout(T.afterAll);
    await verifyAndReset(page, "palette-launch-json");
    await page.close();
  });

  test("an unknown intent name → inline error, palette stays open", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await openBuildingsList(page);

    await openPalette(page);
    // A query starting with `{` flips the palette into paste-and-launch mode: the
    // launch hint replaces the command list.
    await paletteInput(page).fill('{"name":"FlyToTheMoon"}');
    await expect(page.getByText(en("paletteLaunchHint"))).toBeVisible({
      timeout: T.visible,
    });

    await paletteInput(page).press("Enter");
    // parseLaunch rejects the unknown name; the reason shows inline and the field
    // stays (nothing was dispatched, the palette did not close).
    await expect(page.getByText(/Unknown intent/i)).toBeVisible({
      timeout: T.action,
    });
    // Nothing was dispatched, so the palette stays open. (The next test reloads
    // via page.goto, which resets the palette — no explicit close needed here.)
    await expect(paletteInput(page)).toBeVisible();
  });

  test("a valid param-less write (CreateRoom) → palette closes + success toast", async () => {
    test.setTimeout(T.testSolo);
    await page.goto("/");
    await openBuildingsList(page);

    await openPalette(page);
    await paletteInput(page).fill('{"name":"CreateRoom"}');
    await expect(page.getByText(en("paletteLaunchHint"))).toBeVisible({
      timeout: T.visible,
    });

    await paletteInput(page).press("Enter");
    // The write dispatches through the same path the param-less verbs use: the
    // palette closes and the shared success toast ("Done") fires.
    await expect(paletteInput(page)).toBeHidden({ timeout: T.action });
    await expect(page.getByText(en("paramFormSuccess"))).toBeVisible({
      timeout: T.action,
    });
  });

  test("NL → translate (mocked LLM) → review JSON → launch", async () => {
    test.setTimeout(T.testSolo);
    // Stub the OpenAI-compatible endpoint so the spec is hermetic (no real LLM):
    // a `>`-prefixed NL request returns a fixed intent JSON.
    await page.route("**/chat/completions", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [
            { message: { content: '{"name":"CreateRoom","params":{}}' } },
          ],
        }),
      }));

    await page.goto("/");
    await openBuildingsList(page);

    await openPalette(page);
    // A `>` prefix is NL mode (dev-gated): the translate hint replaces the list.
    await paletteInput(page).fill("> create a data room");
    await expect(page.getByText(en("paletteNlHint"))).toBeVisible({
      timeout: T.visible,
    });

    // Enter translates: the box is filled with the returned JSON, flipping the
    // palette into review (jsonMode) — the translator never auto-fires.
    await paletteInput(page).press("Enter");
    await expect(page.getByText(en("paletteLaunchHint"))).toBeVisible({
      timeout: T.action,
    });

    // A second Enter launches the reviewed JSON: palette closes + success toast.
    await paletteInput(page).press("Enter");
    await expect(paletteInput(page)).toBeHidden({ timeout: T.action });
    await expect(page.getByText(en("paramFormSuccess"))).toBeVisible({
      timeout: T.action,
    });
  });
});
