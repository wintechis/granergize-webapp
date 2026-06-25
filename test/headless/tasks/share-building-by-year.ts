/// <reference lib="deno.ns" />
/**
 * Catalog task `share-building-by-year` (headless): the Pod-level twin of the
 * `palette-share-building` e2e — a DIRECT WebID share (no room/role) carrying a
 * YEAR-SCOPED energy grant. It exists to falsify the "palette-share-building:54 is a
 * Pod-level cross-Pod inbox-listing failure" hypothesis: if that failure were in the
 * data layer, this headless flow (the same share → drainInbox → shared-in fold, minus
 * the browser/palette/timing) would reproduce it deterministically.
 *
 * Differs from `share-building` (which shares by ROLE, energy excluded) in exactly the
 * two ways the palette spec does: the recipient is a bare WebID, and the grant is
 * `includeEnergyData` restricted to specific years — so it also asserts B can READ each
 * per-year dataset (the year-scoped ACL projection), not just the building file.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { shareBuildingData } from "../../../src/services/interop/share.ts";
import { drainInbox } from "../../../src/services/interop/inbox.ts";
import { getSharedWithMe } from "../../../src/services/interop/sharingManager.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeEnergyYear,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { parseBuildings } from "../../../src/services/rdf/building/buildingParser.ts";
import {
  buildingFileUri,
  mintBuildingSubject,
} from "../../../src/services/rdf/building/buildingId.ts";
import { podResources } from "../../../src/services/pod/solidUtils.ts";
import { Parser } from "n3";

export const name = "share-building-by-year";

const YEARS = [2022, 2023, 2024];
const VALUE: Record<number, number> = { 2022: 10000, 2023: 11000, 2024: 12000 };

export async function run(ctx: TaskContext): Promise<void> {
  const { a, b, check } = ctx;
  const id = `sby-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const fileUri = buildingFileUri(uri);
  const subjectUri = mintBuildingSubject(uri);
  const bSharedIn = podResources(b.webId).sharedIn;
  const bSharedInSnap = await snapshot(b.raw, bSharedIn);

  try {
    // A creates a building, then three annual energy years (the per-year grant
    // targets these datasets — each must exist before sharing, as in the spec).
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Palette Share Weg 7", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
      undefined,
      { agent: a.webId },
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    for (const year of YEARS) {
      await writeEnergyYear(a.session, fileUri, subjectUri, {
        building: subjectUri,
        year,
        granularity: "P1Y",
        scenario: "actual",
        metrics: { electricityConsumption: VALUE[year] },
      });
    }

    // DIRECT WebID share (no room), energy restricted to the three years.
    await shareBuildingData(uri, b.webId, a.session, {
      includeEnergyData: true,
      years: YEARS,
    });
    await drainInbox(b.session); // archive the grant into B's shared-in/

    // THE failure point of palette-share-building:54 — does B's fold list it?
    const shared = await getSharedWithMe(b.session);
    const seen = shared.some((s) => buildingFileUri(s.buildingUri) === fileUri);
    check(
      "B sees the year-shared building under 'shared with you'",
      seen,
      `shared=[${shared.map((s) => s.buildingUri).join(", ")}]`,
    );

    // B can READ the building file (ACL enforcement, not just the log).
    const bRead = await b.raw.fetch(fileUri, { headers: { "Cache-Control": "no-cache" } });
    check("B can READ the building (ACL)", bRead.ok, `HTTP ${bRead.status}`);

    // The year-scope distinguisher: B reads the building, finds its linked datasets,
    // and can fetch each — the per-year ACL projection actually grants all three.
    const links = bRead.ok
      ? (parseBuildings(new Parser().parse(await bRead.text())).get(subjectUri)
        ?.energyDatasets ?? [])
      : [];
    check("B sees all 3 energy-year datasets linked", links.length === 3, `n=${links.length}`);
    let readable = 0;
    for (const d of links) {
      const r = await b.raw.fetch(d.uri.split("#")[0], {
        headers: { "Cache-Control": "no-cache" },
      });
      if (r.ok) readable++;
    }
    check("B can READ all 3 year-scoped energy datasets (ACL)", readable === 3, `${readable}/3`);
  } finally {
    await deleteBuilding(a.session, a.webId, uri).catch(() => {});
    await restore(b.raw, bSharedIn, bSharedInSnap);
  }
}
