# NUTS regions (linked-nuts) ↔ our model

`linked-nuts` (`~/projects/linked-nuts`) publishes the EU NUTS statistical
regions as SKOS Linked
Data with GeoSPARQL geometry. The app reads it through
`src/services/sources/regionGeometry.ts`: `/geojson?level={1|3}&parent=DE` for choropleth
polygons, and `/contains?lat=&lon=` to resolve a coordinate to its containing
region. Shares the LDP/RDF patterns catalogued in `mastr.md`; this note records
the NUTS-specific part.

## Entities and vocabulary (SKOS + GeoSPARQL)

- **Region = external `skos:Concept`** at `nuts/{code}#it`, carrying
  `skos:notation` (the NUTS code), `skos:prefLabel`, `skos:inScheme`, and
  `owl:sameAs`/`skos:exactMatch` to data.europa.eu / GISCO.
- **Containment is `skos:broader`**: NUTS-0 (DE) ⊃ NUTS-1 (Bundesland) ⊃ NUTS-2
  (Regierungsbezirk) ⊃ NUTS-3 (Kreis), with `skos:narrower` down to LAU.
- **AGS** is a derived `skos:notation` (NUTS-1 ↔ 2-digit Land, NUTS-3 ↔ 5-digit
  Kreis) — the join key the statistics layer uses.
- **Geometry** is GeoSPARQL on demand (`geo:hasGeometry` → `geo:wktLiteral`
  boundary + centroid, from GISCO); the bulk `/geojson` endpoint serves an
  AGS-keyed `FeatureCollection` for the map.

## Correspondence to our model

This is the **borrowed spatial axis** in its NUTS half. A building's own location
is an owned `geo:Point` (`building.ttl`); the region it rolls up into is an
external NUTS `skos:Concept` referenced by IRI/notation, never minted or stored —
and an aggregation's `cons:spatialExtent` (`consumption.ttl`) is such a concept.
The hierarchy lives as `skos:broader` among *their* concepts — the spatial
counterpart to our owned temporal LDP container tree (borrowed where the index is
public, owned where the measured data lives).

## Patterns

Same as `mastr.md`: thing-vs-document split (`{code}#it` + `foaf:primaryTopic`);
**controlled vocab as borrowed SKOS** (here the authority itself); **place
modelled twice** (owned point vs borrowed classification code); the bulk
`/geojson` as a **materialised projection** (one pre-built FeatureCollection
instead of N concept dereferences).

## Divergence

The app joins by AGS **notation**, and at runtime consumes the `/geojson`
projection rather than dereferencing each `skos:Concept`. Geometry is
**classification first, topology on demand** — the region is identified by its
code and `skos:broader` place, with WKT boundaries fetched only when a map or a
containment test needs them.
