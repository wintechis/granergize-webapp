/**
 * The Observations finder's **open** source tier: the *actually-settled* EEG generation
 * of renewable installations near the map viewport — read-only, off-Pod, sourced by
 * joining the MaStR nearby layer ({@link fetchNearbyInstallations}) to
 * `linked-netztransparenz` ({@link fetchPlantGenerationByYear}).
 *
 * The join is two derefs per installation (the `/see` unit for its EEG number, then the
 * netztransparenz plant for its settled kWh/year), so the viewport set is capped and the
 * whole thing is best-effort — a missing EEG number, an unsettled plant (404), or an
 * unreachable wrapper just drops that installation, never a toast.
 */
import { type MapCentre } from "./openBuildings.ts";
import {
  fetchEegNumber,
  fetchNearbyInstallations,
  type InstallationKind,
} from "./mastrNearby.ts";
import { fetchPlantGenerationByYear } from "./netztransparenz.ts";
import { mapPooled } from "../lib/pool.ts";
import { logError } from "../lib/logError.ts";

/** A nearby renewable installation's open settled generation (fetched, never stored). */
export interface OpenObservation {
  /** The MaStR unit IRI (`…/see/{id}#it`) — the Developer-mode source link. */
  iri: string;
  label: string;
  kind: InstallationKind;
  lat: number;
  long: number;
  /** Settled generation (kWh) per year, summed across disposal forms. */
  byYear: Map<number, number>;
}

/** How many nearby installations to resolve per viewport. Each costs TWO derefs, so
 *  this caps the fan-out; the result is cached an hour and fetched only when the Open
 *  tier is ticked. */
export const OPEN_OBSERVATIONS_LIMIT = 15;

/** Resolve one installation's settled generation, or null — no EEG number, no settled
 *  energy, or unreachable (all best-effort). */
export async function fetchInstallationGeneration(
  iri: string,
): Promise<Map<number, number> | null> {
  const eeg = await fetchEegNumber(iri);
  if (!eeg) return null;
  const byYear = await fetchPlantGenerationByYear(eeg);
  return byYear.size > 0 ? byYear : null;
}

/**
 * The open observations near a point: the renewable installations whose EEG plant has
 * settled generation, nearest first. Best-effort throughout — installations without
 * generation are dropped; a per-installation failure drops only that one.
 */
export async function fetchNearbyOpenObservations(
  centre: MapCentre,
  radiusM: number,
): Promise<OpenObservation[]> {
  const installations = await fetchNearbyInstallations(centre.lat, centre.long, {
    radiusKm: radiusM / 1000,
    limit: OPEN_OBSERVATIONS_LIMIT,
  });
  const resolved = await mapPooled(installations, 6, async (u) => {
    const byYear = await fetchInstallationGeneration(u.iri).catch((err) => {
      logError("fetch open observation generation", err);
      return null;
    });
    return byYear
      ? { iri: u.iri, label: u.label, kind: u.kind, lat: u.lat, long: u.long, byYear }
      : null;
  });
  return resolved.filter((o): o is OpenObservation => o != null);
}

/** The latest settled year's generation summed across nearby installations + how many
 *  contributed — for the StandortEnergieprofil card. Capped + best-effort: a non-OK or
 *  no-EEG installation drops out; null when none of them have settled data. */
export async function fetchNearbyGenerationTotal(
  installationIris: readonly string[],
): Promise<{ year: number; kwh: number; plants: number } | null> {
  const sample = installationIris.slice(0, OPEN_OBSERVATIONS_LIMIT);
  const maps = (await mapPooled(sample, 6, (iri) =>
    fetchInstallationGeneration(iri).catch((err) => {
      logError("fetch nearby generation total", err);
      return null;
    }))).filter((m): m is Map<number, number> => m != null);
  if (maps.length === 0) return null;
  // Sum kWh by year across plants, then report the latest year any plant settled.
  const byYear = new Map<number, { kwh: number; plants: number }>();
  for (const m of maps) {
    for (const [y, kwh] of m) {
      const e = byYear.get(y) ?? { kwh: 0, plants: 0 };
      byYear.set(y, { kwh: e.kwh + kwh, plants: e.plants + 1 });
    }
  }
  const year = Math.max(...byYear.keys());
  const e = byYear.get(year)!;
  return { year, kwh: e.kwh, plants: e.plants };
}
