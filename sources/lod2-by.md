# LoD2 roof geometry (linked-lod2-by) ↔ our model

`linked-lod2-by` (`~/projects/linked-lod2-by`) publishes the LDBV LoD2-BY 3D
building model (CityGML LoD2, **Bavaria-only** pilot) as RDF. The app reads it
through `src/services/lod2Rooftop.ts` and computes rooftop-PV potential in
`src/services/rooftopPv.ts` (with `pvgis.md`). Shares the LDP/RDF patterns
catalogued in `mastr.md`.

## Entities and vocabulary

Namespace `wunderfacts.com/lod2-by/vocab#` (self-hosted alongside the data,
dereferenceable at `…/lod2-by/vocab`, like `mastr/vocab#`).

- **`lod2:Building`** at `building/{id}#it` (LoD2 `gml:id`, e.g. `DEBY_LOD2_…`),
  carrying `geo:lat`/`geo:long`, `geo:hasGeometry → geo:asWKT` (footprint
  polygon), `lod2:buildingHeight`, and `skos:notation` (its Gemeinde AGS).
- **`lod2:RoofSurface`** — one per homogeneous roof part, a hash-fragment
  sub-resource on the building document, with `lod2:tilt`, `lod2:azimuth`
  (0=N/90=E/180=S/270=W) and `lod2:area` (m²). Linked by `lod2:hasRoofSurface`.
- The wrapper serves **measured geometry only — no derived figures.**

The app fetches in two steps (`point?lon=&lat=&r=` → nearest building, then
dereference its IRI) and parses into roof surfaces.

## Correspondence to our model

This feeds a building's **`<#pv>` system node** (`building.ttl`: `pvCapacityKW`
etc.). Crucially, the **kWp/kWh calculation lives in the app, not the wrapper**
(`rooftopPv.ts`): per roof surface it screens by suitability (drops walls
tilt>80°, strongly north-facing pitched roofs; reclassifies flat roofs to a 30°
racked array), multiplies usable area × module density (~0.20 kWp/m²) → installable
kWp, then × specific yield from the PVGIS grid (`pvgis.md`) → annual kWh. So the
wrapper supplies the *owned-style geometry*; the app derives the system metric.

## Patterns

Same as `mastr.md`: thing-vs-document split (`building/{id}#it` +
`foaf:primaryTopic`); **subordinate hash-fragment nodes** (`lod2:RoofSurface` on
the building doc — the same shape as our `<#pv>`); GeoSPARQL geometry;
AGS-keyed `skos:notation`; PROV / CC BY 4.0 (LDBV); a dump-based per-record store.

## Divergence

The data is **raw geometry, deliberately figure-free** — the headline number
(kWp/kWh) is *not* served and is computed app-side, the opposite of the
statistics/energieatlas sources that arrive pre-aggregated. Join is by
**proximity** (`point?` nearest building to the building's coordinate), and scope
is **Bavaria-only**.
