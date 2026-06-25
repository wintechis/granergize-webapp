# basemap.de map tiles ↔ our model

**basemap.de** (BKG — Bundesamt für Kartographie und Geodäsie), served via WMS at
`sgx.geodatenzentrum.de/wms_basemapde`, is the default base map under the Leaflet
maps (`ExplorePage.tsx`, `RegionalMetricsMap.tsx`, the locator/neighbourhood maps,
`src/lib/orthophoto.ts`). A WMS raster tile service — **not RDF** — documented
here as its own source id.

## What it is

A `<WMSTileLayer>` against `wms_basemapde`, layer
`de_basemapde_web_raster_farbe` (colour; `…_grau` for grey), `EPSG:3857`,
`image/png`. Leaflet requests tiles; the app does no processing — it is pure
cartographic backdrop.

## Relation to our model

Presentation only: it draws *where* our owned `geo:Point`s and the borrowed region
polygons (`nuts.md`/`lau.md`) sit. It contributes nothing to the data model — no
entities, no IRIs, no Pod writes. The nationwide fallback base map; Bavaria
buildings can swap in the higher-resolution orthophoto (`bavaria-dop.md`).

## Provenance

basemap.de / BKG, **properly attributed** in the Leaflet attribution control
(`© basemap.de / © BKG`). The one external service whose attribution the app
already surfaces correctly.
