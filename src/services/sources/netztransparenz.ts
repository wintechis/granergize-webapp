/**
 * Read `linked-netztransparenz` as Linked Data: a renewable plant's actually-settled
 * EEG generation (`vocab:strommengeKWh`, kWh) per year. The wrapper reuses linked-mastr's
 * `eeg/{number}` scheme, so a MaStR unit's `mastr:EegMaStRNummer` number dereferences
 * straight here (see {@link import("./mastrNearby.ts").fetchEegNumber}).
 *
 * Off-Pod, read-only, **best-effort**: a plant registered in MaStR but absent from the
 * settled dump returns 404 → no generation (an empty map), never an error — an open layer
 * must degrade quietly, and this runs once per nearby installation. Settlements are one
 * per (year × Veräußerungsform), so a year's generation is the SUM of `strommengeKWh`
 * across its disposal forms. The parse is split out pure for offline unit-testing.
 */
import type { Store } from "n3";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { deref } from "./capabilities.ts";

/** Matched by suffix so they're independent of the (configurable) wrapper base. */
const STROMMENGE_SUFFIX = "#strommengeKWh";
const YEAR_SUFFIX = "#year";

/** The per-plant document IRI for an EEG number — dereferenced, and the source link. */
export function plantUrl(eegNumber: string): string {
  return `${sourceBase("netztransparenz")}eeg/${eegNumber}`;
}

/**
 * Parse a plant document into total settled generation (kWh) per year — summed across
 * disposal forms (one `vocab:Settlement` per (year, Veräußerungsform)). Pure: the
 * network-free half, unit-tested with a fixture. Each settlement node carries one
 * `strommengeKWh`; its `year` is read off the same node.
 */
export function parsePlantSettlements(store: Store): Map<number, number> {
  const byYear = new Map<number, number>();
  for (const q of store.getQuads(null, null, null, null)) {
    if (!q.predicate.value.endsWith(STROMMENGE_SUFFIX)) continue;
    const kWh = Number.parseInt(q.object.value, 10);
    if (Number.isNaN(kWh)) continue;
    let year = Number.NaN;
    for (const yq of store.getQuads(q.subject, null, null, null)) {
      if (yq.predicate.value.endsWith(YEAR_SUFFIX)) {
        year = Number.parseInt(yq.object.value, 10);
        break;
      }
    }
    if (Number.isNaN(year)) continue;
    byYear.set(year, (byYear.get(year) ?? 0) + kWh);
  }
  return byYear;
}

/**
 * Fetch a plant's settled generation per year. Any non-OK response — notably the **404**
 * for a plant in MaStR but not in the settled dump — yields an empty map rather than
 * throwing, so one missing plant never aborts a nearby-installations batch.
 */
export async function fetchPlantGenerationByYear(
  eegNumber: string,
): Promise<Map<number, number>> {
  try {
    const store = await deref(
      getSourceGateway(),
      plantUrl(eegNumber),
      "plant generation (netztransparenz)",
    );
    return parsePlantSettlements(store);
  } catch {
    // A plant in MaStR but absent from the settled dump 404s — empty, not an error.
    return new Map();
  }
}
