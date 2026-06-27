import { type BuildingType } from "../../types.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { type EnergyMetricKey } from "../energy/energyDataset.ts";
import { type EnergyByBuildingYear } from "./energyTimeCut.ts";

export interface OverYearsChart {
  /** The reachable years across the set, ascending — the chart's x-axis. */
  years: number[];
  /** Recharts rows: `{ year, b0, b1, … }`. Per-building keys are sanitized (`b<i>`) —
   *  building ids are IRIs Recharts would mis-read as nested (dotted) paths. A null
   *  cell is a year that building has no figure for (the line connects across it). */
  data: Array<Record<string, number | null>>;
  /** One entry per building, in input order: its sanitized dataKey + display name
   *  (the legend label). The component pairs each with a palette colour. */
  series: Array<{ key: string; name: string }>;
}

/**
 * Pivot the per-building annual cube into a multi-line "over years" chart for the
 * selected metric — the **raw** figures (the facts themselves, e.g. kWh), one line
 * per building, time on the x-axis. Unlike `energyMatrix`/the map it does NOT derive
 * a per-m² intensity or band: the over-years view shows the measurements as recorded.
 * React/MUI-free → Tier-1 testable; colours + the chart element live in the component.
 */
export function buildOverYears(
  buildings: BuildingType[],
  energyByBuilding: EnergyByBuildingYear,
  metric: EnergyMetricKey,
): OverYearsChart {
  const yearSet = new Set<number>();
  for (const byYear of energyByBuilding.values()) {
    for (const y of byYear.keys()) yearSet.add(y);
  }
  const years = [...yearSet].sort((a, b) => a - b);
  const series = buildings.map((b, i) => ({
    key: `b${i}`,
    name: buildingDisplayName(b),
  }));
  const data = years.map((year) => {
    const row: Record<string, number | null> = { year };
    buildings.forEach((b, i) => {
      row[`b${i}`] = energyByBuilding.get(b.id)?.get(year)?.[metric] ?? null;
    });
    return row;
  });
  return { years, data, series };
}
