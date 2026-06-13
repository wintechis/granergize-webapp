import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser } from "n3";
import { fetchFresh } from "../pod/podFetch.ts";
import { parseBuildings } from "../rdf/building/buildingParser.ts";
import { buildingFileUri } from "../rdf/building/buildingId.ts";
import { getStorageRoot } from "../pod/solidUtils.ts";
import type { BuildingType } from "../../types.ts";

/** A shared-building entry as folded from the `shared-in/` log. */
export interface SharedBuildingEntry {
  buildingUri: string;
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
 * Provenance comes from the shared file's PROV attribution (`prov:agent`; no
 * role travels with a share). Throws on a non-ok response (caller decides
 * whether to surface or skip it).
 * @operation query
 */
export async function loadSharedBuilding(
  entry: SharedBuildingEntry,
  session: Session,
): Promise<BuildingType | null> {
  const res = await fetchFresh(entry.buildingUri, session);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Resolve any relative refs against the document; derive ids against the
  // RECIPIENT's storage root, so a self-shared own building folds to the same
  // id as on the owner path — one identity per building, however it loaded.
  let ownRoot: string | undefined;
  try {
    ownRoot = session.info.webId ? getStorageRoot(session.info.webId) : undefined;
  } catch {
    ownRoot = undefined; // headless callers without a primed root cache
  }
  const parsed = parseBuildings(
    new Parser({ baseIRI: entry.buildingUri }).parse(await res.text()),
    ownRoot,
  );
  // The log records the shared RESOURCE (file) IRI; match on the document,
  // not text-equality with a `#it` subject.
  const fileUri = buildingFileUri(entry.buildingUri);
  const found = [...parsed.values()]
    .find((b) => buildingFileUri(b.uri) === fileUri) ?? [...parsed.values()][0];
  if (!found) return null;
  return found;
}
