import { expect, type Page, test } from "@playwright/test";
import { t } from "../helpers/i18n.ts";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { assertCleanStart, verifyAndReset } from "../helpers/cleanSlate.ts";
import { importExampleBuildings } from "../helpers/seed.ts";
import { openObservationsView } from "../helpers/manage.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * Competency-question e2e for the cube's **metric selector** — the cross-cutting
 * "metric / observed-property selection" of `plans/plan-cube-ui.md` (NOT optional:
 * the measure axis is first-class, and a real generation-only dataset shows nothing
 * under a consumption lens). Every energy surface (the map's bands + slider, the
 * over-time heatmap) honours ONE selected metric, URI-encoded as `?m=` so the
 * choice is shareable and survives a reload.
 *
 * This spec proves, against the core example import (`importExampleBuildings`):
 *  - the selector appears on the Observations energy views (Map / Over time / Trend);
 *  - switching the metric (Electricity → Heat) rewrites `?m=` and keeps the view up;
 *  - `?m=` survives a cold reload (the legend stays in the chosen framing);
 *  - switching to **electricity generation** flips the legend to the NEUTRAL
 *    magnitude ramp ("Lower/Medium/Higher") with no efficient/inefficient verdict.
 *
 * SEED CAVEAT — the standard demo carries NO electricity *generation* energy (only
 * consumption: electricity/heat/water, plus PV *capacity* metadata). So the plan's
 * stronger generation claim — "generation surfaces buildings the consumption lens left
 * blank" — cannot be asserted against this seed: with no generation figures every
 * building reads "No data" under that metric. That assertion is `test.fixme`'d below
 * with the reason; it needs a seed building carrying `electricityGeneration` annual
 * figures (a generation fixture, or the Nuremberg logistik archive's generation data).
 * The framing FLIP (neutral magnitude legend, no good/bad labels) is verifiable from the
 * legend alone and IS asserted here.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/solo/cube-metric-selector.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/solo/cube-metric-selector.spec.ts
 *
 * Runs against Alice (account A). Skipped without creds.
 *
 * NOTE: authored-but-unrun (a live e2e session held the slot). Needs a
 * `deno task e2e:local` run when one is free.
 */

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("cube metric selector (the measure axis)", () => {
  test.skip(
    !hasAccount(ACC),
    `Set WEBID_A_USERNAME / WEBID_A_PASSWORD (a throwaway Solid Pod) to run the cube-metric-selector e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(T.setup);
    page = await newCapturedPage(browser, "cube-metric-selector");
    await login(page, ACC);
    await assertCleanStart(page);
    await importExampleBuildings(page);
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "cube-metric-selector");
    await page.close();
  });

  /** Open the Observations energy map and wait until the markers + the metric
   * selector have rendered (the selector shows on every energy view). */
  async function openEnergyMap(page: Page): Promise<void> {
    await expect(async () => {
      await page.goto("/");
      await openObservationsView(page, "map");
      await expect(page.locator(".leaflet-marker-icon").first())
        .toBeVisible({ timeout: T.action });
      await expect(page.locator(".energy-marker").first())
        .toBeAttached({ timeout: T.action });
      await expect(page.getByLabel(t("metricSelectLabel")))
        .toBeVisible({ timeout: T.action });
    }).toPass({ timeout: T.setup, intervals: [2_000] });
  }

  /** Choose a metric option from the MUI select (open it, click the option). */
  async function selectMetric(page: Page, optionLabel: string): Promise<void> {
    await page.getByLabel(t("metricSelectLabel")).click();
    await page.getByRole("option", { name: optionLabel, exact: true }).click();
  }

  test("switching the metric rewrites ?m= and keeps the energy view up", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMap(page);

    // Default is electricity consumption (the consumption framing → efficiency
    // tiers; the legend reads "More efficient" / "Less efficient").
    await expect(page.getByText(t("lensTierEfficient")))
      .toBeVisible({ timeout: T.action });

    // Switch to Heat: ?m= is rewritten to the heat consumption metric key, the
    // lens stays up (still a tier framing, so the efficiency legend persists).
    await selectMetric(page, t("metricHeatConsumption"));
    await expect.poll(() => new URL(page.url()).searchParams.get("m"), {
      timeout: T.action,
    }).toBe("heatConsumption");
    await expect(page.locator(".energy-marker").first())
      .toBeAttached({ timeout: T.action });
    await expect(page.getByText(t("lensTierEfficient")))
      .toBeVisible({ timeout: T.action });
  });

  test("?m= survives a cold reload", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMap(page);

    await selectMetric(page, t("metricWaterConsumption"));
    await expect.poll(() => new URL(page.url()).searchParams.get("m"), {
      timeout: T.action,
    }).toBe("waterConsumption");

    await page.reload();
    // The metric choice lives in the URI, so it survives the reload (clampMetric
    // keeps a known metric).
    await expect.poll(() => new URL(page.url()).searchParams.get("m"), {
      timeout: T.action,
    }).toBe("waterConsumption");
    // The reload restores the Observations Map view; the selector restores the
    // chosen metric from ?m= (no lens toggle — the map is always the energy map).
    await expect(page.getByLabel(t("metricSelectLabel")))
      .toHaveText(new RegExp(t("metricWaterConsumption")), { timeout: T.action });
  });

  test("switching to generation flips the legend to the neutral magnitude ramp", async () => {
    test.setTimeout(T.testSolo);
    await openEnergyMap(page);

    // Electricity generation is magnitude-framed: the legend swatches change from
    // the efficiency verdict (efficient/inefficient) to a NEUTRAL low/mid/high
    // ramp — no good/bad labels (the honest caveat: a tier judgement is
    // meaningless for generation).
    await selectMetric(page, t("metricElectricityGeneration"));
    await expect.poll(() => new URL(page.url()).searchParams.get("m"), {
      timeout: T.action,
    }).toBe("electricityGeneration");

    // The magnitude band labels show…
    await expect(page.getByText(t("lensMagnitudeLow")))
      .toBeVisible({ timeout: T.action });
    await expect(page.getByText(t("lensMagnitudeHigh")))
      .toBeVisible({ timeout: T.action });
    // …and the efficiency verdict labels are GONE (generation carries no judgement).
    await expect(page.getByText(t("lensTierEfficient"))).toHaveCount(0);
    await expect(page.getByText(t("lensTierInefficient"))).toHaveCount(0);
  });

  // The plan's stronger generation claim: switching to generation should surface
  // buildings the consumption lens left blank (recolour them by the magnitude ramp).
  // The example file's PV building (Steinauer Weg 7) carries annual `electricityGeneration`
  // from its 1200 kWp rooftop PV, so under this metric it gets a magnitude band where a
  // pure-consumption building reads "none".
  test(
    "generation recolours buildings the consumption lens left blank",
    async () => {
      await openEnergyMap(page);
      await selectMetric(page, t("metricElectricityGeneration"));
      // With a generation-bearing seed: at least one marker carries a magnitude
      // band (low/mid/high), not just "none" — the building the consumption lens
      // could not categorise becomes visible under generation.
      await expect(
        page.locator(
          ".energy-marker.energy-low, .energy-marker.energy-mid, .energy-marker.energy-high",
        ).first(),
      ).toBeAttached({ timeout: T.action });
    },
  );
});
