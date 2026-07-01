# Energie-Atlas Bayern (linked-energieatlas) ↔ our model

`linked-energieatlas` (`~/projects/linked-energieatlas`) publishes
the Bavarian Energie-Atlas as RDF — **Bavaria-only** (pilot scope). The app reads
it through `src/services/sources/standortEnergieprofil.ts` (`area/{ags}`) to fill the
"Standort-Energieprofil" panel. Shares the LDP/RDF patterns catalogued in
`mastr.md`.

## Entities and vocabulary (Data Cube)

Served as an **RDF Data Cube** (`qb:`), one document per Gemeinde at `area/{ags}`, so
it shares regionalstatistik's `qb:` conventions (a `ds/area` DSD, a `cl/indicator`
codelist).

- **`qb:Observation`** — one cell per (Gemeinde, indicator): `#dim-geo` → the region
  resource `ags/{ags}`, `#dim-TIME_PERIOD` → `"2024"^^xsd:gYear` (the LfU vintage),
  `#dim-indicator` → a `cl/indicator#{local}` concept, `#measure-OBS_VALUE` → the value,
  `#unit` → its unit. One `area/{ags}` document holds **every** indicator for that
  Gemeinde (the indicator dimension distinguishes them).
- **Indicators** — the full Energie-Atlas metric set: rooftop-PV
  potential/installed/remaining/degree, ground-PV, the renewable share + carrier mix
  (`eeSharePvPct`/`eeShareWindPct`/…), biomass, and the building-use shares — one
  `cl/indicator` concept each (`skos:prefLabel@de` + unit).
- **Region descriptor** `ags/{ags}` — `skos:notation` (AGS), `rdfs:label` (name),
  **`owl:sameAs` the linked-lau Gemeinde concept** (geo authority deferred to `lau.md`),
  a representative `geo:Point`, and the installed-capacity `Stichtag`.
- PROV + `dcterms:license` dl-de/by-2.0 (Bavarian open geodata) on the document.

The app reads it through the shared `qb:` parser (`regionalCube.ts`
`parseCubeIndicatorValues`) into an `AreaProfile` of cards (rooftop / ground / green /
biomass); a 404 outside Bavaria degrades to `null` (the panel simply omits it). The
wrapper builds the cube from its bundled CSVs — the earlier flat `vocab#AreaPotential`
node is now an internal build intermediate, no longer served.

## Correspondence to our model

This is **regional context, not building data**. The figures are AGS-keyed area
aggregates — they sit on the *region* side of the model (the same borrowed-SKOS
place a building references), alongside the regionalstatistik cube, and feed a
location's surrounding-area energy picture. They do **not** land on the building's
`<#pv>` system node (that is `lod2-by.md` + `pvgis.md`); a building only *borrows*
the profile of the Gemeinde it sits in. A **read-time** PV benchmark sets a building's
own rooftop figures against this Gemeinde aggregate (`detail-vs-statistics.md`) without
persisting anything.

## Patterns

Shares regionalstatistik's `qb:` shape (a `ds/{id}` DSD, `cl/{scheme}` codelists,
`sdmx-dimension`/`sdmx-measure` terms) and, via `mastr.md`, the thing-vs-document split,
**AGS-keyed borrowed region**, and PROV/`dcterms:license` on the document. Both
statistical sources now converge twice — at the `qb:` serialization AND at the
app-level observation series (one parser; see `observation-cube.md`).

## Divergence

Still a **pre-aggregated, non-decomposable** statistic — one figure per Gemeinde with
the buildings that produced it dropped, consumed as context (`detail-vs-statistics.md`).
Two shape differences from regionalstatistik: it is **sharded per region** (one
`area/{ags}` document per Gemeinde, each holding all indicators on a `#dim-indicator`
dimension) rather than one whole-table document, and its measures ride that single
indicator dimension rather than a per-table measure with classifying dimensions. Scope
is a **single Bundesland** (Bavaria), so it is the one source silently absent for most
of Germany.
