# Weather (linked-wetterdienst) ↔ our model

`linked-wetterdienst` (`~/projects/linked-wetterdienst`) publishes Deutscher
Wetterdienst (DWD) observations as Linked Data (Turtle). The app reads it through
`src/services/sources/linkedWeather.ts` and aligns it to a building's energy in
`src/services/energy/energyWeather.ts`. It shares the LDP/RDF patterns catalogued
in `mastr.md`; this note records what is weather-specific.

## Entities and vocabulary

DWD data is **SOSA, the same shape as our energy** (which is why it slots in as a
sibling series):

- **Station** — `dwd:WeatherStation` / `sosa:Sensor`, with `geo:lat`/`geo:long`
  and station metadata. The `near?` endpoint returns stations ranked by
  `schema:distance`.
- **Observation** — `sosa:Observation` with `sosa:resultTime`,
  `sosa:madeBySensor` → the station, `sosa:observedProperty` → a `dwd:{parameter}`
  IRI (e.g. annual mean temperature, sunshine duration, precipitation), and
  `sosa:hasResult` → a `qudt:QuantityValue` (`qudt:numericValue` + `qudt:unit`).
  The `values?` endpoint returns a station's series.

## Correspondence to our model

Our energy is `cons:EnergyDataset ⊑ sosa:ObservationCollection` with
`cons:EnergyConsumptionReading ⊑ sosa:Observation` (`consumption.ttl`). Weather
uses the **same SOSA observation-series shape**, so both project to the common
`(period → value + unit)` series the app charts, and weather overlays the energy
chart on a shared year axis. Where it differs:

- **Feature of interest is a station, not a building.** Energy hangs off the
  building (`cons:ofBuilding`); a weather observation is `sosa:madeBySensor` a
  station, joined to the building only by **proximity** (nearest station to the
  building's `geo:Point`), never containment or ownership.
- **Result shape.** Weather uses `qudt:QuantityValue` (nested numeric+unit);
  our energy uses `sosa:hasSimpleResult` + `ssn:hasUnit`. Same information, two
  conventions — reconciled at the parsed-series edge.
- **Queried, not owned.** Weather is fetched on demand from the wrapper and never
  written to the Pod; energy is owned Pod data.

## Patterns

Same as `mastr.md`: thing-vs-document split (`station/{id}#it` +
`foaf:primaryTopic`); subordinate hash-fragment nodes (the PROV `#activity` /
`#agent` / `#producer` sub-resources); PROV provenance + `dcterms:license` (DWD)
travelling with the data; grouping containers (`near?` / `values?` list members
via `rdfs:member`).

## Divergence

Two notable ones. The join is **proximity (nearest sensor)**, the only one of our
sources joined that way rather than by containment/identity. And controlled terms
are **not SKOS here** — observed properties are `dwd:` IRIs and units are QUDT
IRIs, not `skos:Concept`s in a scheme (unlike the AGS/codelist sources). So weather
is the SOSA sibling of our energy, minus the SKOS-controlled-vocab convention.
