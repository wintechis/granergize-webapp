import type { AnnualMetrics } from "../../energy/energyDataset.ts";

/**
 * A demo building's master data and energy shape. The render/load paths key on
 * the data *shape* (the energy granularity), never a role. `annual`, when
 * present, holds the `_inv_*`/`_bsp_*` fields merged in for an
 * `energy: "annual"` (or `"both"`) building (turned into annual SOSA
 * observations); `"both"` carries annual aggregates AND a 15-minute series,
 * the shape that surfaces the Annual | Time series toggle.
 *
 * The demo set itself is generated from the L.Immo Nürnberg extract by
 * `scripts/genDemoBuildings.ts` → `demoBuildings.generated.ts`; the seeding
 * logic lives in `buildingSerializer.ts` (`seedDemoBuildings`).
 */
export interface DemoSpec {
  fields: Record<string, string>;
  energy: "annual" | "series" | "both";
  annual?: Record<string, string>;
  /** For a series-carrying shape: how many demo days (15-min) to synthesize. */
  seriesDays?: number;
  /**
   * Set `operatedBy` to the seeding user's own WebID at seed time. Two effects:
   * the agent-link → contact detail path resolves to a real profile out of the
   * box, and every self-operated building with annual data joins ONE operator
   * group — so the operator-average (Betreiber) benchmark shows on the demo data
   * without any extra setup (it needs ≥2 buildings sharing an operator).
   */
  selfOperated?: boolean;
  /**
   * Set `ownedBy` to the seeding user's own WebID at seed time — the
   * owner-occupier constellation. The agent links are independent axes: a demo
   * can be operated-but-not-owned or owned-and-operated.
   */
  selfOwned?: boolean;
  /**
   * An extra planned (Soll) annual dataset, so the demo shows a Soll-Ist pair
   * next to the actual figures of the same year out of the box.
   */
  planned?: { year: number; metrics: AnnualMetrics };
}
