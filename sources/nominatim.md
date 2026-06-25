# Nominatim geocoding ↔ our model

OpenStreetMap **Nominatim** (`nominatim.openstreetmap.org`) is the geocoder the
app calls in `src/services/geocode.ts` to fill a building's missing coordinates
from its address. A plain HTTP/JSON service — **not RDF / Linked Data** — so it
sits outside the vocabulary-correspondence frame; documented here as its own
source id.

## What it is

`GET /search?q={query}&format=json&limit=1`, with a `User-Agent` identifying the
app (Nominatim policy), throttled to ≤1 req/s. The app runs a **progressive
fallback**: full street address → postcode + city → city, and tags the result
with the precision it succeeded at (`address` / `postcode` / `city`). Response is
a JSON array; the app reads `lat` / `lon`.

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
