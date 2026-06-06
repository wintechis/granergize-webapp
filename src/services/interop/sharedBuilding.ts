import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser } from "n3";
import { fetchFresh } from "../utils/podFetch.ts";
import { parseBuildings } from "../utils/buildingParser.ts";
import type { BuildingType } from "../../../types/types.ts";

/** A shared-building entry as folded from the `shared-in/` log. */
export interface SharedBuildingEntry {
  buildingUri: string;
  sharedRole?: string;
}

/**
 * Load a building that was shared *with* the user as a typed {@link BuildingType}.
 *
 * Unlike the owner's own buildings (held in memory via `useSolidData`), shared
 * buildings aren't all resident — hidden ones are pruned — so the source document
 * is fetched and parsed on demand. The read goes through {@link fetchFresh}
 * (conditional GET / 304 revalidation + network-activity instrumentation), keeping
 * RDF parsing in the service layer rather than leaking into the page.
 *
 * Provenance comes from the shared file's PROV attribution; when the file carries
 * none, it falls back to the role the building was shared as. Throws on a non-ok
 * response (caller decides whether to surface or skip it).
 */
export async function loadSharedBuilding(
  entry: SharedBuildingEntry,
  session: Session,
): Promise<BuildingType | null> {
  const res = await fetchFresh(entry.buildingUri, session);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = parseBuildings(new Parser().parse(await res.text()));
  const found = [...parsed.values()].find((b) => b.uri === entry.buildingUri) ??
    [...parsed.values()][0];
  if (!found) return null;
  return {
    ...found,
    provenance: found.provenance ??
      (entry.sharedRole as BuildingType["provenance"]),
  };
}
