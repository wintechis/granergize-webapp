/// <reference lib="deno.ns" />
/**
 * Invariant task `grant-projection` (headless): the WAC `.acl`s are a derived
 * projection of the `shared-out/` log — so a recipient must be able to read
 * exactly what the folded log says they may read (see
 * `notes/app-pod-state-sync.md` §write-side, `notes/read-write-operations.md`
 * §model 3). Checked recipient-side with real GETs, the enforcement truth:
 *
 * 1. At share time the projection is exact: B reads the building AND every
 *    dataset existing when the all-years grant was applied.
 * 2. The write path keeps it exact: a year written through the app's energy
 *    mutation (writeEnergyYear + reconcileBuildingGrants, the composition the
 *    `useWriteEnergyYear` hook runs) is readable by B immediately — the
 *    formerly-pinned QUESTIONS.md gap, fixed by the write-path reconciliation.
 * 3. The repair still covers the residual drift class: the reconcile is
 *    best-effort (a saved year must not fail on a throttled ACL write), so a
 *    bare `writeEnergyYear` — simulating a failed reconcile — drifts, and
 *    `reissueGrants` re-enumerates the CURRENT datasets and closes it.
 *
 * Each leg is double-checked owner-side by `auditGrants`, the dry-run diffing
 * twin of the repair (full pair coverage, where the GETs sample): clean after
 * the app write path, exactly the one missing-grant while drifted, clean after
 * repair.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import {
  auditGrants,
  reconcileBuildingGrants,
  reissueGrants,
  shareBuildingData,
} from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeEnergyYear,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { datasetFileUrl } from "../../../src/services/rdf/energyDataset.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";

export const name = "grant-projection";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `gp-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const fileUri = uri.split("#")[0];
  const subjectUri = `${uri}#${id}`;
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  /** One annual actual year, shorthand. */
  const year = (y: number, kwh: number) =>
    ({
      building: subjectUri,
      year: y,
      granularity: "P1Y",
      scenario: "actual" as const,
      metrics: { electricityConsumption: kwh },
    });

  try {
    // A creates a building with one annual year, then shares it ALL-YEARS with B.
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Projektionsweg 3", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    await writeEnergyYear(a.session, fileUri, subjectUri, year(2023, 100_000));
    await shareBuildingData(uri, b.webId, a.session, { includeEnergyData: true });
    await drainInbox(b.session);

    // 1. Projection exact at share time: B reads the building + the 2023
    //    dataset, and the dry-run audit agrees (full pair coverage, not a sample).
    const ds2023 = datasetFileUrl(fileUri, 2023, "P1Y", "actual");
    const bBuilding = await b.raw.fetch(`${fileUri}?t=${Date.now()}`);
    check("B reads the shared building", bBuilding.ok, `HTTP ${bBuilding.status}`);
    const b2023 = await b.raw.fetch(`${ds2023}?t=${Date.now()}`);
    check("B reads the dataset existing at share time (2023)", b2023.ok, `HTTP ${b2023.status}`);
    const atShare = await auditGrants(a.session);
    check(
      "auditGrants finds no drift at share time",
      atShare.drift.length === 0 && atShare.checked > 0,
      JSON.stringify(atShare),
    );

    // 2. The app's write path (the useWriteEnergyYear composition): write the
    //    year, then reconcile — B reads the new year immediately, no repair.
    await writeEnergyYear(a.session, fileUri, subjectUri, year(2024, 90_000));
    await reconcileBuildingGrants(fileUri, a.session);
    const ds2024 = datasetFileUrl(fileUri, 2024, "P1Y", "actual");
    const b2024 = await b.raw.fetch(`${ds2024}?t=${Date.now()}`);
    check(
      "year written through the app's write path IS readable by B (write-path reconciliation)",
      b2024.ok,
      `HTTP ${b2024.status}`,
    );
    const afterWrite = await auditGrants(a.session);
    check(
      "auditGrants finds no drift after the app write path",
      afterWrite.drift.length === 0,
      JSON.stringify(afterWrite.drift),
    );

    // 3. Residual drift class: the reconcile is best-effort, so a bare service
    //    write (= a failed reconcile) still drifts — detected by the audit,
    //    closed by the repair.
    await writeEnergyYear(a.session, fileUri, subjectUri, year(2025, 80_000));
    const ds2025 = datasetFileUrl(fileUri, 2025, "P1Y", "actual");
    const b2025drift = await b.raw.fetch(`${ds2025}?t=${Date.now()}`);
    check(
      "a bare write without the reconcile drifts (B 403s on the new dataset)",
      b2025drift.status === 403,
      `HTTP ${b2025drift.status}`,
    );
    const drifted = await auditGrants(a.session);
    check(
      "auditGrants pinpoints the drift (missing-grant for B on the 2025 dataset)",
      drifted.drift.length === 1 &&
        drifted.drift[0].kind === "missing-grant" &&
        drifted.drift[0].grantee === b.webId &&
        drifted.drift[0].resource === ds2025,
      JSON.stringify(drifted.drift),
    );
    const result = await reissueGrants(a.session);
    check(
      "reissueGrants replays the building grant",
      result.buildings >= 1,
      JSON.stringify(result),
    );
    const b2025healed = await b.raw.fetch(`${ds2025}?t=${Date.now()}`);
    check(
      "after the replay B reads the drifted year (projection caught up to the log)",
      b2025healed.ok,
      `HTTP ${b2025healed.status}`,
    );
    const healed = await auditGrants(a.session);
    check(
      "auditGrants verifies the repair (diff empty)",
      healed.drift.length === 0,
      JSON.stringify(healed.drift),
    );
  } finally {
    // deleteBuilding revokes recipients first, so B's side is withdrawn too.
    await deleteBuilding(a.session, a.webId, uri).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
