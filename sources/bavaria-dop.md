# Bavaria orthophoto (DOP20c) ↔ our model

The Bavarian aerial orthophoto **DOP20c** (Bayerische Vermessungsverwaltung),
served via WMS at `geoservices.bayern.de/od/wms/dop/v1/dop20`, is the
high-resolution base layer the app swaps in for buildings inside Bavaria's
coverage (`src/lib/orthophoto.ts`, the `inBavaria` check). A WMS raster service —
**not RDF** — its own source id alongside the nationwide `basemap.md`.

## What it is

A `<WMSTileLayer>` against the DOP service, layer `by_dop20c` (20 cm true-colour
orthophoto), `image/jpeg`. Used for detail maps where a building falls in
Bavaria; elsewhere the app stays on basemap.de.

## Relation to our model

Presentation only — a sharper backdrop for the same owned points and borrowed
region polygons. No entities, IRIs, or Pod writes. Its Bavaria-only coverage
mirrors the other Bavarian pilot sources (`energieatlas.md`, `lod2-by.md`): rich
where the pilot is, absent elsewhere.

## Provenance

Bayerische Vermessungsverwaltung, **CC BY 4.0**, **properly attributed** in the
Leaflet attribution control.
