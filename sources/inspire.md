# INSPIRE / ALKIS (linked-inspire) ↔ our model

`linked-inspire` (`~/projects/linked-inspire`, "inspirewrap") wraps regional
INSPIRE / ALKIS WFS layers as RDF. **Not fetched by the app at runtime** — it is
used by the offline Logistikimmobilien **import pipeline** (the script that
materialises buildings from open data); the registry still carries its
transport (`base`/`envKey`) and attribution entry because the imported archive's
industrial-park context derives from it. Listed here for completeness, one file
per source id. Shares the LDP/RDF patterns catalogued in `mastr.md`.

## Entities and vocabulary

Query grammar `/wfs{.json,.ttl}?s={upstream-service}&typenames=…&sw={lat,lon}&ne={lat,lon}`.
Two layer roles:

- **Park level** — ATKIS Basis-DLM `adv:AX_IndustrieUndGewerbeflaeche` polygons
  with stable `urn:adv:oid:…` identifiers; over the GVZ Nürnberg box this returns
  the "Güterverkehrszentrum Hafen" feature, used as the logistics-park grouping
  resource (a `dcterms:isPartOf` target for imported buildings).
- **Building level** — INSPIRE ALKIS `bu-core2d` building layers carrying the
  official cadastral building function (Lagergebäude group) — authoritative where
  coverage exists, a precision check on the OSM tagging elsewhere.

Geometry is GeoSPARQL (the WFS features carry boundary polygons).

## Correspondence to our model

It feeds the **import**, not the running app: the cadastral footprint/function
confirm or correct the OSM-derived building skeleton, and the industrial-area
polygon becomes the park grouping a building points at with `dcterms:isPartOf`.
The output lands as ordinary `rec:Building` master data (`building.ttl`) with a
`prov:wasDerivedFrom` link back to the ALKIS feature IRI, so the derivation stays
traceable — the same provenance chaining the MaStR import uses.

## Patterns

Same as `mastr.md`: thing-vs-document split; GeoSPARQL geometry; an external
**classification** referenced by IRI (the cadastral function code, the
`urn:adv:oid` park id). The import keeps the source IRIs as `prov:wasDerivedFrom`
rather than copying blobs.

## Divergence

The only **import-pipeline-only** source here (every other note is webapp
runtime), and the only **WFS-backed** one (queried by typenames + bbox against an
upstream service, not a per-record dump). The Bavarian *building* layer is a known
deploy gap — the LDBV ALKIS endpoints answer HTTP 401, so DE2 building footprints
fall back to OSM and the cadastral confirmation tier applies only where an open
building WFS exists (NRW, HH, …).
