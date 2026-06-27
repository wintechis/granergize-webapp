/// <reference lib="deno.ns" />
/**
 * Catalog task `aggregation-timeline` (headless): the DATA path behind the
 * aggregations timeline guise. A seeds two buildings with annual electricity
 * datasets across several years (one carries an extra year the other lacks),
 * defines an aggregation over them, and computes the per-year series with the
 * real `computeAggregationSeries` over the live Pod transport — the same call
 * `AggregationsTimeline` charts as a Recharts line.
 *
 * Bisects the `aggregations.spec.ts:297` e2e: if THIS passes (the series resolves
 * over a real server) but the browser spec flakes, the failure is UI/render
 * timing, not the aggregation compute or the Pod interop.
 */
import { type TaskContext } from "../taskContext.ts";
import {
  deleteBuilding,
  deleteEnergyYear,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeEnergyYear,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { mintBuildingSubject } from "../../../src/services/rdf/building/buildingId.ts";
import { computeAggregationSeries } from "../../../src/services/aggregation/aggregationComputer.ts";
import type { AggregationDefinition } from "../../../src/types.ts";
import type { EnergyDataset } from "../../../src/services/energy/energyDataset.ts";

export const name = "aggregation-timeline";

/** electricityConsumption (kWh) per building per year. Building 2 lacks 2021, so
 *  that year must aggregate to building 1 alone — the "years a building lacks
 *  simply don't contribute" rule. */
const SERIES: Record<number, [number, number | undefined]> = {
  2021: [500, undefined],
  2022: [1000, 2000],
  2023: [1100, 2100],
  2024: [1200, 2200],
};
const METRIC = "electricityConsumption";

function annual(subjectUri: string, year: number, kwh: number): EnergyDataset {
  return {
    building: subjectUri,
    year,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: kwh },
  };
}

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const stamp = Date.now();
  const files = [
    newBuildingUri(a.webId, `aggts-1-${stamp}`),
    newBuildingUri(a.webId, `aggts-2-${stamp}`),
  ];
  const subjects = files.map(mintBuildingSubject);

  // Track what we wrote so the finally can unlink each dataset + delete the file.
  const written: Array<{ file: string; subject: string; year: number }> = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const ttl = serializeBuildingToTurtle(
        { streetAddress: `Aggregatstraße ${i + 1}`, locality: "Nürnberg", lat: "49.45", long: "11.08" },
        files[i],
      );
      await uploadBuilding(a.session, files[i], ttl, a.webId);
      for (const [yearStr, kwh] of Object.entries(SERIES)) {
        const v = kwh[i];
        if (v === undefined) continue;
        const year = Number(yearStr);
        await writeEnergyYear(a.session, files[i], subjects[i], annual(subjects[i], year, v));
        written.push({ file: files[i], subject: subjects[i], year });
      }
    }

    const definition: AggregationDefinition = {
      id: `aggts-${stamp}`,
      name: "Timeline E2E",
      buildingUris: subjects,
      aggregationType: "sum",
      metrics: [METRIC],
      createdAt: new Date(stamp).toISOString(),
    };

    const series = await computeAggregationSeries(a.session, definition, METRIC);

    // One point per year present in ANY member, sorted ascending.
    check(
      "series covers every year, sorted ascending",
      JSON.stringify(series.map((p) => p.year)) === JSON.stringify([2021, 2022, 2023, 2024]),
      JSON.stringify(series.map((p) => p.year)),
    );
    const byYear = new Map(series.map((p) => [p.year, p.value]));
    // 2021: only building 1 carries it → its value alone (missing-year tolerance).
    check("2021 = building 1 alone (500)", byYear.get(2021) === 500, `${byYear.get(2021)}`);
    // Summed across both members for the shared years.
    check("2022 = sum 1000+2000 = 3000", byYear.get(2022) === 3000, `${byYear.get(2022)}`);
    check("2023 = sum 1100+2100 = 3200", byYear.get(2023) === 3200, `${byYear.get(2023)}`);
    check("2024 = sum 1200+2200 = 3400", byYear.get(2024) === 3400, `${byYear.get(2024)}`);
  } finally {
    for (const w of written) {
      await deleteEnergyYear(a.session, w.file, w.subject, {
        year: w.year,
        granularity: "P1Y",
        scenario: "actual",
      }).catch(() => {});
    }
    for (const file of files) {
      await deleteBuilding(a.session, a.webId, file).catch(() => {});
    }
  }
}
