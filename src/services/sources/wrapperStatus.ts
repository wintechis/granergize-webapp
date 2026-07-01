/**
 * Live **health** of an open-data wrapper, for the Data-sources view: is it reachable, and does
 * its response still carry the shape the app parses? A runtime, in-app cousin of the remote
 * contract tests (`test/headless/contract/`) — cheap enough to run on the credits page.
 *
 * Three states:
 *  - **down** — the probe request failed (network error / non-2xx / CORS): the wrapper is
 *    unreachable, so every layer it feeds is silently empty.
 *  - **available** — reachable (2xx), but the response did NOT match the schema the app parses
 *    (a shape drift — the field/route the app needs is gone, even though the host answers).
 *  - **conformant** — reachable AND the app's own parser extracted a well-formed result.
 *
 * Per-source probes are registered in {@link WRAPPER_PROBES}; a source with no probe returns
 * `null` (no badge). Starting with **mastr**.
 */
import type { SourceId } from "../../constants/dataSources.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { within } from "./capabilities.ts";
import { MASTR_ROUTES, parseInstallations } from "./mastrNearby.ts";

export type WrapperHealth = "down" | "available" | "conformant";

export interface WrapperStatus {
  health: WrapperHealth;
  /** A short human hint (why available-not-conformant, or the error), for a tooltip. */
  detail?: string;
  /** A representative domain-entity IRI pulled live from the probe (e.g. a MaStR `see/{id}#it`
   *  record) — a "see it for real" link on the Data-sources page. */
  exampleEntity?: string;
}

/** A small WGS84 box of half-width `km` around a point (~111 km/°; lon shrinks by cos). */
function boxAround(lat: number, lon: number, km: number) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return { w: lon - dLon, s: lat - dLat, e: lon + dLon, n: lat + dLat };
}

function shortErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 120 ? m.slice(0, 117) + "…" : m;
}

/**
 * Probe **linked-mastr** in two steps, tied to the SAME contract as the compile-time route check:
 *  1. **route manifest** (`/routes.json`, the option-C source) — must still list the routes the app
 *     depends on ({@link MASTR_ROUTES}); a missing one is a route drift → `available`.
 *  2. **response shape** — a tiny `within` query over central Nürnberg must parse to a well-formed
 *     installation via the app's own `parseInstallations` (`geo:lat`/`geo:long` + `mastr:Energietraeger`).
 * Any fetch failure → `down`; both pass → `conformant`.
 */
async function probeMastr(): Promise<WrapperStatus> {
  const base = sourceBase("mastr");

  // 1. Are the endpoints the app calls still deployed? (same routes as the generated contract.)
  let routes: string[];
  try {
    const res = await getSourceGateway().fetch(
      `${base}routes.json`,
      { headers: { Accept: "application/json" } },
      "mastr routes",
    );
    if (!res.ok) return { health: "down", detail: `routes.json → HTTP ${res.status}` };
    routes = ((await res.json()) as { routes?: string[] }).routes ?? [];
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const missing = Object.values(MASTR_ROUTES).filter((r) => !routes.includes(r));
  if (missing.length > 0) {
    return { health: "available", detail: `missing route(s): ${missing.join(", ")}` };
  }

  // 2. Does a live query still parse to the shape the nearby-installations layer reads?
  let store;
  try {
    store = await within(getSourceGateway(), "mastr", boxAround(49.4521, 11.0767, 3), { count: 25 });
  } catch (e) {
    return { health: "down", detail: shortErr(e) };
  }
  const u = parseInstallations(store)[0];
  return u && Number.isFinite(u.lat) && Number.isFinite(u.long)
    ? { health: "conformant", exampleEntity: u.iri }
    : { health: "available", detail: "reachable, but no installation matched the expected shape" };
}

/** Per-source probes. Extend as sources are added (starting with mastr). */
export const WRAPPER_PROBES: Partial<Record<SourceId, () => Promise<WrapperStatus>>> = {
  mastr: probeMastr,
};

/** Whether a live-health probe is registered for a source id (bundled/non-fetchable ids like
 *  `pvgis`/`basemap` never have one → no badge). Takes a bare string (the registry's `id`). */
export function hasWrapperProbe(id: string): boolean {
  return id in WRAPPER_PROBES;
}

/** Probe a source's live health, or `null` when no probe is registered for it. */
export function probeWrapper(id: string): Promise<WrapperStatus> | null {
  const probe = (WRAPPER_PROBES as Record<string, () => Promise<WrapperStatus>>)[id];
  return probe ? probe() : null;
}
