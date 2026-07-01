# LAU regions (linked-lau) ↔ our model

`linked-lau` (`~/projects/linked-lau`) publishes the EU LAU level — German
Gemeinden — as SKOS
Linked Data with GeoSPARQL geometry. The app reads it through
`src/services/regionGeometry.ts`: `/geojson?parent={nuts3}` or `?bbox=…` (scoped,
since the whole Gemeinde layer is ~149 MB), and `/contains?lat=&lon=` to resolve
a coordinate to its Gemeinde. Companion to `nuts.md` (same family, finer level);
shares the LDP/RDF patterns catalogued in `mastr.md`.

## Entities and vocabulary (SKOS + GeoSPARQL)

- **Gemeinde = external `skos:Concept`** at `lau/{GISCO_ID}#it`
  (`GISCO_ID = DE_{8-digit AGS}`), carrying `skos:notation` (the 8-digit AGS),
  `skos:prefLabel`, `skos:inScheme` (per-country scheme).
- **Flat within a country** — unlike NUTS there is no hierarchy *among*
  Gemeinden; each links **up** to its containing NUTS-3 by `skos:broader`.
- **Wrapper-coined attributes** on the concept: `vocab#population2024`,
  `vocab#populationDensity2024`, `vocab#areaKm2`.
- **Geometry** via GeoSPARQL on demand; bulk `/geojson` serves AGS-keyed
  `FeatureCollection`s, always scoped (by parent Kreis or bbox).

## Correspondence to our model

The finest rung of the **borrowed spatial axis**. A building references its
Gemeinde as an external LAU `skos:Concept` (8-digit AGS) — the most precise
region it rolls into — while keeping its own `geo:Point`. The MaStR import joins
to this level too (a unit's `dcterms:spatial` AGS resolves to a LAU concept). The
Gemeinde→Kreis step is `skos:broader` into NUTS, so traversal upward leaves LAU
and continues in `nuts.md`.

## Patterns

Same as `mastr.md`: thing-vs-document split; **controlled vocab as borrowed
SKOS**; **place modelled twice** (owned point vs borrowed 8-digit code); bulk
scoped `/geojson` as a **materialised projection**.

## Divergence

Two LAU-specific points. The layer is **scope-only** (no whole-country fetch),
so the app always asks within a parent Kreis or bbox. And LAU is **flat with an
upward `skos:broader`** rather than a self-contained tree — the hierarchy it
participates in is owned by `nuts.md`, with LAU as its leaf level.
