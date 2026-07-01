# Nominatim geocoding ↔ our model

OpenStreetMap **Nominatim** is the geocoder the app calls in
`src/services/sources/geocode.ts` to fill a building's missing coordinates from
its address — reached **through the `linked-osm` proxy** (`nominatim/search`, via
`sourceBase("osm")`), not the public `nominatim.openstreetmap.org` host directly.
So it is the geocoding half of the `osm` source id (`osm.md`) and its transport
(base + `VITE_OSM_API_URI`) lives in the registry under `osm`; `nominatim.openstreetmap.org`
survives only as the upstream origin recorded in provenance (below). A plain
HTTP/JSON service — **not RDF / Linked Data** — so it sits outside the
vocabulary-correspondence frame; documented here as its own source id.

## What it is

`GET nominatim/search.json?q={query}&limit=1` on the `linked-osm` base, with a
`User-Agent` identifying the app (Nominatim policy) and a ≤1 req/s throttle paid
**only on a miss** (a first-try hit adds no delay). The app runs a **progressive
fallback**: full street address → postcode + city → city, tagging the result with
the precision it succeeded at (`Address` / `Postcode` / `City`). The proxy returns
a **GeoJSON `FeatureCollection`**; the app reads `features[0].geometry.coordinates`
(`[lon, lat]`).

## Relation to our model

It produces the building's **owned** `geo:Point` (and the precision feeds
`bldg:geocodePrecision`, a controlled vocab in `building.ttl`) during address
import — i.e. it manufactures the owned point that every spatial source then joins
against. It has no entities, vocabulary, or persistence of its own.

## Provenance

OSM data is **ODbL** (share-alike, attribution required). This is now recorded in
the building Turtle: a geocoded `geo:Point` carries `prov:wasDerivedFrom` a source
`prov:Entity` with `foaf:name "© OpenStreetMap contributors"`, `dcterms:source`
the Nominatim service, and `dcterms:license` the ODbL — so the obligation travels
with shared building data. The trigger is the presence of `bldg:geocodePrecision`,
which only the Nominatim geocoder sets; coordinates from other sources (a partner
file, a MaStR/LoD2 import, manual entry) carry neither the precision nor this
attribution. (Surfacing the attribution in the map UI is a separate, still-open
step.)
