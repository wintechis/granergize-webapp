import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { openBuildingsMap } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the space-time-cube **time-cut slider** (Step 1 of
 * `plans/plan-cube-ui.md`; the CQ-anchored e2e half of
 * `explore/explore-presentation.md` §"Competency questions and tasks").
 *
 * CQ "How did building X's consumption track over the years?" and the sibling CQ
 * "Which buildings were inefficient in 2022 vs 2024?" — both answered on the in-shell
 * Buildings → Map surface with the Energy lens up and the year slider moved. The spec
 * DRIVES the slider and asserts the answer is *shown*: the markers re-tier per year and
 * the chosen year is encoded in the URI (`?y=`) so a reload keeps the cut.
 *
 * Seed (the standard investor demo `ensureDemoBuildings`): three annual buildings span
 * the years **2022–2024** at distinct floor-area intensities, plus the small office that
 * carries annual **2023–2024** only — so the selectable year range is the *union*
 * (2022, 2023, 2024) and at least one building has data in some years but not others
 * (the office is uncategorised → neutral in 2022, the "no-data-that-year" partiality the
 * CQ exercises). The intensity/tercile maths itself is proved in the Tier-1
 * `energyTimeCut.test.ts`; this is the UI proof that scrubbing the year re-cuts the cube
 * and the cut is a shareable URI.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/cube-time-cut.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/cube-time-cut.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube time-cut slider (track consumption over the years)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the cube-time-cut e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-time-cut");
    await login(page, ACC);
    await assertCleanStart(page);
    // The investor demo seeds the multi-year (2022-2024) annual buildings the
    // slider cuts across.
    await ensureDemoBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-time-cut");
    await page.close();
  });

  /**
   * Open the Map, switch the colour lens to Energy, and wait until the per-year
   * energy cube has loaded enough for the slider (≥2 selectable years) to render —
   * retrying the whole open because the bulk energy load is read through the
   * buildings query and can take a couple of load cycles to flow in (the standard
   * Tier-3 write-read convergence pattern, mirrored from map-energy-lens.spec.ts).
   */
  async function openEnergyMapWithSlider(page: Page): Promise<void> {
    await expect(async () => {
      await page.goto("/");
      await openBuildingsMap(page);
      await expect(page.locator(".leaflet-marker-icon").first())
        .toBeVisible({ timeout: T.action });
      await page.getByRole("button", { name: "Energy", exact: true }).click();
      // The energy markers paint (the lens recoloured) and the year slider appears
      // once ≥1 reachable year is loaded (≥2 enables the slider/animation).
      await expect(page.locator(".energy-marker").first())
        .toBeAttached({ timeout: T.action });
      await expect(page.getByRole("slider", { name: "Energy year" }))
        .toBeVisible({ timeout: T.action });
    }).toPass({ timeout: T.setup, intervals: [2_000] });
  }

  test("moving the year slider re-tiers the markers and the year is in the URI", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMapWithSlider(page);

    const slider = page.getByRole("slider", { name: "Energy year" });

    // Step the slider to its minimum (the earliest reachable year, 2022) via the
    // keyboard — keyboard ArrowKeys commit (fire onChangeCommitted), so the year is
    // written to the URI without needing a precise pixel drag.
    await slider.focus();
    await slider.press("Home");
    // The cut is now the earliest year: the URI carries ?y=2022 and the slider's
    // committed value followed.
    await expect.poll(() => new URL(page.url()).searchParams.get("y"), {
      timeout: T.action,
    }).toBe("2022");
    await expect(slider).toHaveAttribute("aria-valuenow", "2022");
    // The year readout beside the slider shows the selected year.
    await expect(page.getByText("2022", { exact: true }).first())
      .toBeVisible({ timeout: T.action });

    // Step to the maximum (the latest year, 2024) — the markers re-cut and the URI
    // follows. The energy markers stay attached across the re-tier (the lens never
    // drops).
    await slider.press("End");
    await expect.poll(() => new URL(page.url()).searchParams.get("y"), {
      timeout: T.action,
    }).toBe("2024");
    await expect(slider).toHaveAttribute("aria-valuenow", "2024");
    await expect(page.locator(".energy-marker").first())
      .toBeAttached({ timeout: T.action });

    // Across the demo's three distinct annual intensities the terciles give at
    // least one efficient (green) and one inefficient (red) marker in 2024 — the
    // categorisation reaches the DOM via the className (the energy-lens precedent).
    await expect(page.locator(".energy-marker.energy-efficient").first())
      .toBeAttached({ timeout: T.action });
    await expect(page.locator(".energy-marker.energy-inefficient").first())
      .toBeAttached({ timeout: T.action });
  });

  test("the year cut survives a reload (shareable URI)", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMapWithSlider(page);

    // Pin a specific earlier year, then reload cold: ?y= restores the same cut
    // (clampYear keeps it, since 2022 is in the seed's selectable range).
    const slider = page.getByRole("slider", { name: "Energy year" });
    await slider.focus();
    await slider.press("Home");
    await expect.poll(() => new URL(page.url()).searchParams.get("y"), {
      timeout: T.action,
    }).toBe("2022");

    await page.reload();
    // After the reload the URI still carries the year (navigational state lives in
    // the URI — notes/ui-state.md).
    await expect.poll(() => new URL(page.url()).searchParams.get("y"), {
      timeout: T.action,
    }).toBe("2022");
    // And the restored view re-shows the energy lens at that year: the slider
    // returns at 2022 once the energy cube reloads.
    await expect(page.getByRole("button", { name: "Energy", exact: true }))
      .toBeVisible({ timeout: T.action });
    await page.getByRole("button", { name: "Energy", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Energy year" }))
      .toHaveAttribute("aria-valuenow", "2022", { timeout: T.action });
  });
});
