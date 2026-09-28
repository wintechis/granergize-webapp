import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { importExampleBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the space-time-cube **time-cut slider** (Step 1 of
 * `plans/plan-cube-ui.md`; the CQ-anchored e2e half of the competency questions in
 * `notes/competency.md`).
 *
 * CQ "How did building X's consumption track over the years?" and the sibling CQ
 * "Which buildings were inefficient in 2022 vs 2024?" — both answered on the in-shell
 * Buildings → Map surface with the Energy lens up and the year slider moved. The spec
 * DRIVES the slider and asserts the answer is *shown*: the markers re-tier per year and
 * the chosen year is encoded in the URI (`?y=`) so a reload keeps the cut.
 *
 * Seed (the core example file, `importExampleBuildings`): six annual buildings spanning
 * the years **2022–2024** at distinct floor-area intensities — so the selectable year
 * range is 2022–2024 and the terciles re-cut as the slider moves. The intensity/tercile
 * maths itself is proved in the Tier-1
 * `energyTimeCut.test.ts`; this is the UI proof that scrubbing the year re-cuts the cube
 * and the cut is a shareable URI.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/cube-time-cut.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/cube-time-cut.spec.ts
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
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-time-cut e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-time-cut");
    await login(page, ACC);
    await assertCleanStart(page);
    // The core example file brings the multi-year (2022-2024) annual buildings
    // the slider cuts across.
    await importExampleBuildings(page);
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
      // The Observations Map view IS the energy map (no lens toggle); the markers
      // paint by energy band and the year slider appears with the cube.
      await openObservationsView(page, "map");
      await expect(page.locator(".leaflet-marker-icon").first())
        .toBeVisible({ timeout: T.action });
      // The energy markers paint and the year slider appears once ≥1 reachable year
      // is loaded (≥2 enables the slider/animation).
      await expect(page.locator(".energy-marker").first())
        .toBeAttached({ timeout: T.action });
      const slider = page.getByRole("slider", { name: t("cubeYearAria") });
      await expect(slider).toBeVisible({ timeout: T.action });
      // The bulk energy load can deliver the EARLIEST seed year (2022) a cycle
      // after the slider first renders with only the later years, leaving the
      // slider min transiently at 2023 — so a `Home` press would commit 2023,
      // not 2022. Gate on the full seed range (min=2022, max=2024) having
      // converged before returning; the enclosing toPass re-opens until it does.
      // (Tier-3 bulk-energy read-after-write convergence — see plans/flakes.md.)
      await expect(slider).toHaveAttribute("aria-valuemin", "2022", {
        timeout: T.action,
      });
      await expect(slider).toHaveAttribute("aria-valuemax", "2024", {
        timeout: T.action,
      });
    }).toPass({ timeout: T.setup, intervals: [2_000] });
  }

  test("moving the year slider re-tiers the markers and the year is in the URI", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMapWithSlider(page);

    const slider = page.getByRole("slider", { name: t("cubeYearAria") });

    // Step the slider to its minimum (the earliest reachable year, 2022) via the
    // keyboard — keyboard ArrowKeys commit (fire onChangeCommitted), so the year is
    // written to the URI without needing a precise pixel drag. Retry the
    // press+assert as a unit: under Tier-3 eager refetch (staleTime:0) the energy
    // fold can flap, briefly dropping 2022 out of the loaded set so a single Home
    // press commits the then-minimum (2023). Re-pressing until 2022 is both loaded
    // and committed keeps the spec honest. (App-level fold stability is the
    // LDP-query-layer plan; see plans/flakes.md.)
    await slider.focus();
    await expect(async () => {
      await slider.press("Home");
      expect(new URL(page.url()).searchParams.get("y")).toBe("2022");
    }).toPass({ timeout: T.poll, intervals: [1_000] });
    await expect(slider).toHaveAttribute("aria-valuenow", "2022");
    // The year readout beside the slider shows the selected year.
    await expect(page.getByText("2022", { exact: true }).first())
      .toBeVisible({ timeout: T.action });

    // Step to the maximum (the latest year, 2024) — the markers re-cut and the URI
    // follows. The energy markers stay attached across the re-tier (the lens never
    // drops). Same flap-tolerant retry as the Home step.
    await expect(async () => {
      await slider.press("End");
      expect(new URL(page.url()).searchParams.get("y")).toBe("2024");
    }).toPass({ timeout: T.poll, intervals: [1_000] });
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
    const slider = page.getByRole("slider", { name: t("cubeYearAria") });
    await slider.focus();
    // Flap-tolerant Home press (see the sibling test): re-press until the
    // earliest year (2022) is loaded and committed.
    await expect(async () => {
      await slider.press("Home");
      expect(new URL(page.url()).searchParams.get("y")).toBe("2022");
    }).toPass({ timeout: T.poll, intervals: [1_000] });

    await page.reload();
    // After the reload the URI still carries the year (navigational state lives in
    // the URI — notes/ui-state.md).
    await expect.poll(() => new URL(page.url()).searchParams.get("y"), {
      timeout: T.action,
    }).toBe("2022");
    // And the restored Observations Map view re-shows the slider at that year: it
    // returns at 2022 once the energy cube reloads (no lens toggle — the map is
    // always the energy map).
    await expect(page.getByRole("slider", { name: t("cubeYearAria") }))
      .toBeVisible({ timeout: T.setup });
    await expect(page.getByRole("slider", { name: t("cubeYearAria") }))
      .toHaveAttribute("aria-valuenow", "2022", { timeout: T.action });
  });
});
