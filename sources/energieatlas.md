# Energie-Atlas Bayern (linked-energieatlas) ↔ our model

`linked-energieatlas` (`~/projects/linked-energieatlas`, served at
`wunderfacts.com/energieatlas/`, `VITE_LINKED_ENERGIEATLAS_API_URI`) publishes
the Bavarian Energie-Atlas as RDF — **Bavaria-only** (pilot scope). The app reads
it through `src/services/standortEnergieprofil.ts` (`area/{ags}`) to fill the
"Standort-Energieprofil" panel. Shares the LDP/RDF patterns catalogued in
`mastr.md`.

## Entities and vocabulary

- **`vocab#AreaPotential`** — one resource **per Gemeinde**, keyed by the 8-digit
  AGS (`skos:notation`). It is an *aggregate area profile*, not per-building.
- Coined `xsd:decimal`/`xsd:integer` predicates (`rdfs:domain :AreaPotential`),
  e.g. `vocab#pvPotentialCapacityMWp`, `vocab#installedCapacityMWp`,
  `vocab#groundPvPotentialCapacityMWp`, `vocab#renewableElectricitySharePct`,
  the carrier-mix shares (`eeSharePvPct`/`eeShareWindPct`/…), and biomass figures
  (`biogasPotentialElectricKWhPerYear`, `biomassInstalledCapacityMW`,
  `biomassInstallationCount`). A provisional SKOS `SuitabilityClass` exists.
- `dcterms:license` dl-de/by-2.0 (Bavarian open geodata) on the data.

The app parses one fetch into an `AreaProfile` of cards (rooftop / ground / green
/ biomass); a 404 outside Bavaria degrades to `null` (the panel simply omits it).

## Correspondence to our model

This is **regional context, not building data**. The figures are AGS-keyed area
aggregates — they sit on the *region* side of the model (the same borrowed-SKOS
place a building references), alongside the regionalstatistik cube, and feed a
location's surrounding-area energy picture. They do **not** land on the building's
`<#pv>` system node (that is `lod2-by.md` + `pvgis.md`); a building only *borrows*
the profile of the Gemeinde it sits in.

## Patterns

Same as `mastr.md`: thing-vs-document split; **AGS-keyed borrowed region**;
controlled vocab as SKOS (the provisional suitability classes); PROV/`dcterms:license`
on the data; a single fetch yielding a **pre-merged aggregate** (rooftop + ground
+ mix + biomass folded into one `AreaPotential`).

## Divergence

Like the statistics cube it is a **pre-aggregated, member-less area figure** —
non-decomposable, consumed as context. Its vocabulary is a flat coined
`vocab#AreaPotential` property bag (not SOSA, not `qb:`), and its scope is a
**single Bundesland** (Bavaria), so it is the one source that is silently absent
for most of Germany.
