/**
 * React Query key prefixes for the **read-only external sources** (the source-facing
 * port: the geo/region wrappers, regionalstatistik, weather, the LfU area profile — not
 * the user's Pod). Kept separate from `hooks/queries.ts`' `queryKeys` on purpose: that
 * catalogue is the *invalidation contract* for Pod state (every key is invalidated by some
 * mutation), whereas these are **never write-invalidated** — the data is immutable or
 * slow-changing (a region's geometry, a concept's AGS, a Bundesland's statistics), so the
 * entries carry a long/`Infinity` `staleTime` and refresh only by time, never by a write.
 *
 * Each entry is keyed by the *source identifier* that follows the prefix (an IRI, an AGS,
 * a station id, …), e.g. `[...sourceKeys.regionAgs, conceptIri]`. Living in
 * `services/sources/` lets non-hook readers (the aggregation compute's region resolver)
 * share the same entries via an `ensureQueryData` accessor without importing the hooks.
 */
export const sourceKeys = {
  /** A LAU/NUTS concept IRI → its bare AGS (immutable). */
  regionAgs: ["regionAgs"] as const,
  /** Region boundary GeoJSON for a grain (± a bbox scope). */
  regionGeometry: ["regionGeometry"] as const,
  /** A regionalstatistik table's choropleth values, keyed by table id. */
  regionalChoropleth: ["regionalChoropleth"] as const,
  /** A regionalstatistik table for one AGS (the detail page). */
  regionalDataset: ["regionalDataset"] as const,
  /** A regionalstatistik table's full per-region year series, keyed by table id
   *  (the pivot's drill-across section — one GET serves every region). */
  regionalSeries: ["regionalSeries"] as const,
  /** The LfU/energy-atlas area profile for an AGS. */
  standortEnergieprofil: ["standortEnergieprofil"] as const,
  /** A building's joined Bundesland/Kreis regional figures (the context panel). */
  regionalContext: ["regionalContext"] as const,
  /** DWD weather stations near a point (the Weather page). */
  weatherStations: ["weatherStations"] as const,
  /** A station's weather values for a parameter (the Weather page). */
  weatherValues: ["weatherValues"] as const,
  /** The nearest station for the energy-weather overlay, keyed by coords. */
  overlayWeatherStation: ["overlayWeatherStation"] as const,
  /** The overlay station's annual temperature values, keyed by station id. */
  overlayWeatherValues: ["overlayWeatherValues"] as const,

  // ─── Open-tier building/installation reads (MaStR / OSM / LoD2 wrappers) ───
  /** MaStR installations near a point, keyed by coords. */
  mastrNearby: ["mastrNearby"] as const,
  /** Open (OSM/INSPIRE) buildings near a point, keyed by coords + radius. */
  openBuildings: ["openBuildings"] as const,
  /** One open building's detail, keyed by its IRI. */
  openBuildingDetail: ["openBuildingDetail"] as const,
  /** One open observation's detail (a MaStR unit deref), keyed by its IRI. */
  openObservationDetail: ["openObservationDetail"] as const,
  /** Open observations (MaStR units) near a point, keyed by coords + radius. */
  openObservations: ["openObservations"] as const,
  /** Nearby generation summary for a building sample. */
  nearbyGeneration: ["nearbyGeneration"] as const,
  /** A building's rooftop-PV potential (LoD2 + PVGIS), keyed by coords + address. */
  lod2Rooftop: ["lod2Rooftop"] as const,
  /** A building's LoD2 3D geometry, keyed by coords. */
  building3d: ["building3d"] as const,
  /** Nearby rooftop-PV potentials, keyed by coords. */
  lod2NearbyRooftops: ["lod2NearbyRooftops"] as const,
  /** Nearby rooftop roof-ring geometries, keyed by coords. */
  lod2NearbyRooftopGeom: ["lod2NearbyRooftopGeom"] as const,
} as const;
