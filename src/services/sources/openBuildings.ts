import { type Building } from "../../types.ts";
import { type NearbyRooftop } from "./lod2Rooftop.ts";

/** A map viewport centre — the point the open-building bbox is grown around. */
export interface MapCentre {
  lat: number;
  long: number;
}

/** Floor for the own-data anchor radius (m): even a single building pulls in open
 *  context within ~2 km. */
export const OPEN_BUILDINGS_RADIUS_M = 2000;

/** Ceiling for the own-data anchor radius (m): a spread portfolio fetches at most a
 *  ~20 km region around its centre (the wrapper caps dense results anyway). */
const OPEN_BUILDINGS_RADIUS_MAX_M = 20000;

/**
 * The **own-data anchor** for the open tier: a centre + radius covering the user's own
 * (and shared) buildings, so open data is fetched as *context around your data* (the
 * concentric `mine`→`open` ring), NOT around the free map viewport. The centre is the
 * bounding-box centre of the buildings that carry coordinates; the radius is the
 * half-diagonal to a bbox corner (+ a ~1 km margin), clamped to
 * `[{@link OPEN_BUILDINGS_RADIUS_M}, OPEN_BUILDINGS_RADIUS_MAX_M]`. `centre` is **null**
 * when no building has coordinates (no own data → no open context to anchor to).
 *
 * The centre is snapped to a ~110 m grid so small portfolio changes reuse the cached
 * fetch. Shared by the finders + the map (all pass `useSolidData().buildings`), so all
 * derive the SAME `{centre, radiusM}` → the SAME query key → one fetch.
 *
 * (A widely-spread portfolio is covered only out to the radius ceiling around its bbox
 * centre — multi-region/free browsing is a separate, future exploration mode.)
 */
export function ownDataAnchor(
  buildings: ReadonlyArray<{ lat?: number; long?: number }>,
): { centre: MapCentre | null; radiusM: number } {
  const pts = buildings.filter(
    (b): b is { lat: number; long: number } =>
      typeof b.lat === "number" && typeof b.long === "number",
  );
  if (pts.length === 0) return { centre: null, radiusM: OPEN_BUILDINGS_RADIUS_M };

  let minLat = Infinity, maxLat = -Infinity, minLong = Infinity, maxLong = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLong = Math.min(minLong, p.long);
    maxLong = Math.max(maxLong, p.long);
  }
  const lat = (minLat + maxLat) / 2;
  const long = (minLong + maxLong) / 2;
  // Half-diagonal of the bbox in metres (equirectangular approximation), + a 1 km margin.
  const latM = ((maxLat - minLat) / 2) * 111_320;
  const longM = ((maxLong - minLong) / 2) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const halfDiagM = Math.sqrt(latM * latM + longM * longM);
  const radiusM = Math.round(
    Math.min(
      OPEN_BUILDINGS_RADIUS_MAX_M,
      Math.max(OPEN_BUILDINGS_RADIUS_M, halfDiagM + 1000),
    ),
  );
  const snap = (n: number) => Math.round(n * 1000) / 1000;
  return { centre: { lat: snap(lat), long: snap(long) }, radiusM };
}

/** The open-data fetch radius (m) for a Leaflet zoom — wider view → bigger box, closer
 *  view → smaller — so an *exploration* fetch tracks how much map is shown. Clamped to a
 *  sane band (the wrapper caps dense results anyway). */
export function viewportRadiusForZoom(zoom: number): number {
  return Math.round(Math.min(20000, Math.max(500, 40_000_000 / 2 ** zoom)));
}

/**
 * The **viewport anchor** for the open tier's opt-in *exploration* mode (`?explore=1`):
 * a centre + radius read from the map's URL viewport (`?c` centre, `?z` zoom), so open
 * data is fetched around **wherever the user is looking** rather than their own buildings.
 * The deliberate, opt-in counterpart to {@link ownDataAnchor} (it re-introduces the
 * viewport anchoring the concentric default removed). The centre is snapped to a ~110 m
 * grid so micro-pans reuse the cached fetch; `centre` is `null` until the map has written
 * a `?c` (the finder then shows a "pan or search to choose an area" hint).
 */
export function viewportAnchor(
  params: URLSearchParams,
): { centre: MapCentre | null; radiusM: number } {
  const z = Number(params.get("z"));
  const radiusM = Number.isFinite(z) && z > 0
    ? viewportRadiusForZoom(z)
    : OPEN_BUILDINGS_RADIUS_M;
  const c = params.get("c");
  if (!c) return { centre: null, radiusM };
  const [lat, long] = c.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) {
    return { centre: null, radiusM };
  }
  const snap = (n: number) => Math.round(n * 1000) / 1000;
  return { centre: { lat: snap(lat), long: snap(long) }, radiusM };
}

/**
 * Adapt a LoD2 `NearbyRooftop` (the `linked-lod2-by` open-data rooftop summary) into
 * the finder's `Building`, flagged `isOpen` so it lands in the **open** source
 * tier — public, off-Pod, read-only. The wrapper gives an IRI + coordinates + the
 * installable rooftop-PV capacity, but **no name/address**, so no `label` is set: the
 * display layer renders an open-specific label (it must NOT parse meaning from the IRI
 * — the no-URI-magic rule). `uri` keeps the source IRI for the dev-mode source link and
 * the "open the source" navigation; `id` is the IRI (a stable React/list key, never
 * routed to the Pod-backed `/building/:id`). Pure → Tier-1 testable.
 */
export function openRooftopToBuilding(r: NearbyRooftop): Building {
  return {
    id: r.iri,
    uri: r.iri,
    type: "",
    isShared: false,
    isOpen: true,
    lat: r.lat,
    long: r.long,
    openKwp: r.installableKwp,
  };
}
