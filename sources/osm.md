# OpenStreetMap (linked-osm) ↔ our model

`linked-osm` ("osmwrap") wraps OpenStreetMap over Overpass as RDF and JSON. This
registry id (`osm`) covers two OSM-derived reads: **building footprints** via the
wrapper (this note) and **address geocoding** via Nominatim (`nominatim.md`, the
`geo:Point` producer). **Not fetched by the app at runtime** — the footprint side
feeds the offline Logistikimmobilien **import pipeline** (its L1 candidate layer),
not the running webapp. Shares the LDP/RDF patterns catalogued in `mastr.md`.

## Entities and vocabulary

- **Building footprint** — an OSM `way`/`relation` tagged `building=*`, fetched as
  an Overpass feature (custom JSON, not an RDF capability helper), carrying the
  footprint polygon (→ GeoSPARQL geometry) plus OSM tags — notably `operator` /
  `brand` (the occupying company) and `addr:*` (the address parts the import reads).

The pipeline uses these as the **skeleton** an import starts from: the OSM
footprint + operator/address is the first-pass building candidate, then confirmed
or corrected against the authoritative INSPIRE/ALKIS cadastral layer where it
exists (`inspire.md`), and enriched with MaStR units by coordinate/AGS
(`mastr.md`).

## Correspondence to our model

The output lands as ordinary `rec:Building` master data (`building.ttl`): the OSM
polygon and `operator`/`brand` → the building's geometry and company name, `addr:*`
→ its address, with a `prov:wasDerivedFrom` link back to the OSM element so the
derivation stays traceable — the same provenance chaining the MaStR and INSPIRE
imports use. The geocoding half (`nominatim.md`) instead manufactures the owned
`geo:Point` every spatial source then joins against.

## Provenance

OSM data is **ODbL** (share-alike, attribution required); the obligation travels
with derived building data as `prov:wasDerivedFrom` / `dcterms:license` (see
`nominatim.md` for the geocoded-point case).

## Divergence

An **import-pipeline-only** source (like `inspire.md`), reached over Overpass's
custom JSON rather than a per-record deref surface — so it exposes none of the
`linked-*` discovery capabilities and the app never dereferences it at runtime.
