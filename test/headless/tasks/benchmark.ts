/// <reference lib="deno.ns" />
/**
 * Catalog task `benchmark` (headless): the BSP round-trip over THREE actors.
 * A and B are contributing owners, C is the benchmark service provider. A and B
 * each share an annual `_bsp_*` building (with energy) to C; C folds the
 * shared-with-me roster into a benchmark view, computes it (the average across the
 * contributors), and shares the snapshot back; A reads the returned benchmark.
 *
 * This proves the data-layer round-trip "in principle": the contributor fold, the
 * benchmark marking (isBenchmark / computedBy / metricPeriod), the average over two
 * pods, and the share-back — all over real sessions against the local Pod server.
 */
import { type Actor, restore, snapshot, type TaskContext } from "../taskContext.ts";
import {
  shareAggregatedView,
  shareBuildingData,
} from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  createViewDefinition,
  deleteView,
  getReceivedBenchmarks,
} from "../../../src/services/aggregation/viewManager.ts";
import {
  computeAndStoreSnapshot,
  sharedContributorBuildings,
} from "../../../src/services/aggregation/viewComputer.ts";
import { CONSUMPTION_METRIC_KEYS } from "../../../src/constants/annualMetrics.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

import {
  buildingFileUri,
  mintBuildingSubject,
} from "../../../src/services/rdf/building/buildingId.ts";

export const name = "benchmark";

const BSP_METRICS = CONSUMPTION_METRIC_KEYS;

/** Seed an annual `_bsp_*` building (with energy) owned by `actor`; returns its URI. */
async function seedBspBuilding(
  actor: Actor,
  id: string,
  elec: number,
): Promise<string> {
  const uri = newBuildingUri(actor.webId, id);
  const subjectUri = mintBuildingSubject(uri);
  const fields: Record<string, string> = {
    streetAddress: "Benchmarkweg 1",
    locality: "Nürnberg",
    companyName: `Contributor ${actor.slot}`,
    _bsp_year: "2024",
    _bsp_elec: String(elec),
    _bsp_heat: "500",
    _bsp_water: "100",
    _bsp_wastewater: "80",
  };
  const links = await writeBuildingEnergy(actor.session, uri, subjectUri, fields);
  const ttl = serializeBuildingToTurtle(fields, uri, links, {
    agent: actor.webId,
  });
  await uploadBuilding(actor.session, uri, ttl, actor.webId);
  return uri;
}

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, c, check } = ctx;
  const stamp = Date.now();
  const aUri = newBuildingUri(a.webId, `bench-a-${stamp}`);
  const bUri = newBuildingUri(b.webId, `bench-b-${stamp}`);

  // Snapshot the logs we touch, to restore the pods to as-found afterwards.
  const cSharedIn = podResources(c.webId).sharedIn;
  const aSharedIn = podResources(a.webId).sharedIn;
  const cSharedInSnap = await snapshot(c.raw, cSharedIn);
  const aSharedInSnap = await snapshot(a.raw, aSharedIn);

  let viewId = "";
  try {
    // 1. A and B each contribute an annual _bsp_* building (electricity 1000 / 2000
    //    → the benchmark average is 1500).
    await seedBspBuilding(a, `bench-a-${stamp}`, 1000);
    await seedBspBuilding(b, `bench-b-${stamp}`, 2000);

    // 2. Both share their building (incl. energy) with C, the BSP.
    await shareBuildingData(aUri, c.webId, a.session, { includeEnergyData: true });
    await shareBuildingData(bUri, c.webId, b.session, { includeEnergyData: true });
    await drainInbox(c.session); // archive both grants into C's shared-in/

    // 3. C folds the shared-with-me roster into the benchmark's building list.
    const { buildingUris, contributors } = await sharedContributorBuildings(c.session);
    check(
      "C's contributor roster holds both shared buildings",
      [aUri, bUri].every((u) =>
        buildingUris.some((x) => buildingFileUri(x) === buildingFileUri(u))
      ),
      `roster=[${buildingUris.join(", ")}]`,
    );
    check(
      "C's contributor set holds both owners' WebIDs",
      [a.webId, b.webId].every((w) => contributors.includes(w)),
      `contributors=[${contributors.join(", ")}]`,
    );

    // 4. C creates the benchmark view (the flag lives ON the definition, so
    // every recompute keeps the benchmark typing) and computes the snapshot;
    // the covered year is derived from the aggregated data (both seeds: 2024).
    const view = await createViewDefinition(
      c.session,
      `Benchmark 2024 ${stamp}`,
      buildingUris,
      "average",
      BSP_METRICS,
      { benchmark: true },
    );
    viewId = view.id;
    const { snapshot: snap, snapshotUri } = await computeAndStoreSnapshot(
      c.session,
      view.id,
    );
    check(
      "benchmark averages electricity across both contributors (1500)",
      snap.values.electricityConsumption === 1500,
      `got ${snap.values.electricityConsumption}`,
    );
    check(
      "snapshot exposes only a building count, not the contributors (2)",
      snap.buildingCount === 2,
      `buildingCount=${snap.buildingCount}`,
    );

    // 5. C shares the benchmark snapshot back to contributor A.
    await shareAggregatedView(snapshotUri, a.webId, c.session);
    await drainInbox(a.session); // archive the grant into A's shared-in/

    // 6. A reads the returned benchmark.
    const received = await getReceivedBenchmarks(a.session);
    const mine = received.find((s) => s.values.electricityConsumption === 1500);
    check("A receives the benchmark snapshot", Boolean(mine), `received=${received.length}`);
    check("the received snapshot is marked a benchmark", mine?.isBenchmark === true);
    check(
      "the benchmark records C as the computing agent",
      mine?.computedBy === c.webId,
      `computedBy=${mine?.computedBy}`,
    );
    check(
      "the benchmark records the metric period (derived from the data: 2024)",
      mine?.metricPeriod === "2024",
      `metricPeriod=${mine?.metricPeriod}`,
    );
  } finally {
    if (viewId) await deleteView(c.session, viewId).catch(() => {});
    await deleteBuilding(a.session, a.webId, aUri).catch(() => {});
    await deleteBuilding(b.session, b.webId, bUri).catch(() => {});
    await restore(c.raw, cSharedIn, cSharedInSnap);
    await restore(a.raw, aSharedIn, aSharedInSnap);
  }
}
