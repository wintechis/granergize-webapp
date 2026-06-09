/// <reference lib="deno.ns" />
/**
 * Catalog task `add-building` (headless): single-account building lifecycle —
 * serialize → upload (into `buildings/`) → read back via the full
 * fetchAndParseData orchestration (which discovers it by listing the container) →
 * delete. Folds in the retired `it:live` create/access/delete coverage against a
 * real server.
 */
import { type TaskContext } from "../taskContext.ts";
import {
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import { fetchAndParseData } from "../../../src/services/TurtleParsingService.ts";

export const name = "add-building";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const id = `ab-${Date.now()}`;
  const uri = newBuildingUri(a.webId, id);
  const subjectUri = `${uri}#${id}`;

  try {
    const ttl = serializeBuildingToTurtle(
      { streetAddress: "Teststraße 1", locality: "Nürnberg", lat: "49.45", long: "11.08" },
      uri,
    );
    await uploadBuilding(a.session, uri, ttl, a.webId);
    check("uploadBuilding returned", true);

    const data = await fetchAndParseData(a.session);
    const found = data.buildings.find((x) =>
      x.sourceUri === uri || x.uri === subjectUri
    );
    check("fetchAndParseData discovers the new building", Boolean(found));
    check(
      "and parses its street address",
      found?.streetAddress === "Teststraße 1",
      found?.streetAddress,
    );

    await deleteBuilding(a.session, a.webId, uri);
    const after = await a.raw.fetch(`${uri}?t=${Date.now()}`);
    check("building file is gone after delete", after.status === 404, `HTTP ${after.status}`);
  } finally {
    await a.raw.fetch(uri, { method: "DELETE" }).catch(() => {});
  }
}
