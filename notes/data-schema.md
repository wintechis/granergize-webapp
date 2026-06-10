# Data schema — provenance, formats & graph shapes

What a building's provenance records (the producing *agent* only), how the graph shape
varies by producer, and how the app dispatches on the data's own shape — never on a
"role". A role never attaches to a building or its energy data; it exists only as
data-room membership. The imperative parsers (`buildingParser.ts`, `energyDataset.ts`,
`userEnergyParser.ts`) are the source of truth for those shapes. Membership roles are a
separate concept — see [`room.md`](./room.md). Companion to
[`data-layout.md`](./data-layout.md) (where these files live) and
[`energy-model.md`](./energy-model.md) (the energy graph).

## Two things `UserRole` is reused for

`UserRole = "dummy" | "investor" | "user" | "benchmark_service_provider" |
"facility_manager" | …` (`src/types.ts`) labels two *independent* concerns; **neither
gates parsing / loading / rendering** — that dispatches on the data's own shape:

- **Membership role** — on an *agent* (WebID), in a room log (`as:Update` +
  `sioc:has_function`). Read by `dataRoom.ts` (`getMyRole`, `getMembersByRole`); means
  "this person acts as an investor here". A sharing target. Role↔IRI maps live in
  `constants/roles.ts` (`MEMBERSHIP_ROLE_TO_IRI`/`IRI_TO_MEMBERSHIP_ROLE`; `dataRoom.ts`
  is their only consumer).
- **Import file-format / export style** — a *spreadsheet layout*, not a role:
  `parseCsvToFields` auto-detects it on upload (`detectSpreadsheetFormat`: row-label /
  table / generic), and `buildingToXlsx(b, style)` takes a user-chosen layout at download.

## Provenance is the producing agent only

A building file records **who** produced the data as a PROV-O qualified attribution —
`<#b> prov:qualifiedAttribution [ a prov:Attribution ; prov:agent <webid> ]` — with **no
`prov:hadRole`** and no producing-role category. `buildingParser.ts` reads `prov:agent`
into `BuildingType.attributedTo` (which drives the producer-logo marker and the "Data
source" row); a legacy `prov:hadRole` on an older Pod is read and ignored. There is no
`BuildingType.provenance`, no `gran:dataSourceRole` fallback, and no "company kind"
(`org:classification`) — a user declares no organisation role, and adding a building is
never gated on one. The attribution travels with the data, so a sharing recipient reads
the producing agent straight from the shared file.

## Graph shape varies by producer, but dispatch is data-driven

One session loads building files authored by different actors in different
vocabularies (the user's own files under `buildings/`, an investor's shared file, a
tenant's readings, a benchmark file) — structurally different graphs. The parser keys
on **predicate presence** (core + optional `bldg:*`), and energy
loading/rendering keys on the dataset's declared **granularity**, so the producer
category is never needed to read the data correctly.

Provenance travels with the data: `serializeBuildingToTurtle` writes the PROV
attribution into the building file on create, and a sharing recipient reads it straight
from the shared file.

## What dispatches on data shape (not role)

- **Building predicates** — rendered whenever present (`hasInvestorDetails` in
  `Building.tsx`): core always, `bldg:*` when the subject carries
  them. No role gate.
- **Energy load + render** — keyed on the dataset's declared `cons:granularity`
  (`isSeriesGranularity()`, `durationUtils.ts`) and on the presence of `annualData`,
  never on a role. The dataset model is owned by [`energy-model.md`](./energy-model.md).

Code: `TurtleParsingService.ts` (granularity skip-prefetch), `durationUtils.ts`,
`energyDataParser.ts`; `ExplorePage.tsx` / `Building.tsx` rendering.

## Graph shapes (by producer's vocabulary, not a stored role)

The shapes aren't formally specified — they're whatever the imperative parsers
read/write (`buildingConfig.ts`, `buildingParser.ts`, `energyDataParser.ts`,
`userEnergyParser.ts`); there's no separate shape/validator layer. Conceptually there's
a shared building core plus optional detail predicates (`bldg:*`) carried by whatever
a producer authored — read whenever present, with no role gate — and energy is either
annual SOSA observations or a `cons:EnergyConsumptionReading` time series.

> An earlier draft formalised these (and the on-Pod registry/view/sharing files) as
> ShEx in `roles.shex`, with n3 mirrors in `roleDetection.ts` / `shapeValidators.ts`.
> Removed: ShEx engines don't run under Deno, role is now provenance (a PROV
> attribution, not sniffed from shape), and the validators had no callers. The only
> survivor is `isSeriesGranularity` (`durationUtils.ts`).

## Two schemas: RDF graph ⇄ app objects

A building is described twice — as RDF triples on the Pod, and as a typed JS
object in the app — with a mapping layer between them: the usual object↔RDF
"impedance mismatch" (like an ORM between a DB schema and a class model). The
boundary is one-way at load time: RDF → typed object → React props (see
[`data-deref.md`](./data-deref.md)); the reverse runs only on save.

The building schema therefore lives across four artifacts that must agree:

- **RDF vocabulary** — predicate IRIs in
  [`vocabularies.ts`](../src/services/rdf/vocabularies.ts).
- **App object type** — `BuildingType` (also `AgentType`, `EnergyType`) in
  `types/types.ts`.
- **Predicate ⇄ field mapping** — `predicateMap` / `objectPropertyMap` in
  [`buildingConfig.ts`](../src/services/rdf/building/buildingConfig.ts).
- **Datatype/coercion** — `parsingFunctions` (read: literal → JS) in
  `buildingConfig.ts`, and separately `INTEGER_FIELDS`/`DECIMAL_FIELDS`/
  `BOOLEAN_FIELDS` + `xsdType()` (write: JS → typed literal) in
  [`buildingSerializer.ts`](../src/services/rdf/building/buildingSerializer.ts).

What's single-sourced vs. duplicated:

- **Predicate ⇄ field is single-sourced.** The serializer doesn't keep its own
  copy — it *inverts* `predicateMap`/`objectPropertyMap` at runtime
  (`fieldToPredicate = Object.fromEntries(...)`). Read and write share one table.
- **Field names are type-checked.** `predicateMap` is typed
  `{ [iri]: keyof BuildingType }`, so a value that isn't a real `BuildingType` key
  (or a rename) is a compile error — keeps the type and the map from drifting on
  names.
- **Datatypes are duplicated.** Read coercion (`parsingFunctions`) and the
  write-side datatype sets must agree, but nothing enforces it.
- **Coordinates are the one structured exception to the flat map.** `lat` / `long`
  appear in `predicateMap` (so a *legacy* flat `geo:lat` / `geo:long` still parses), but
  are no longer written or normally read that way. The current shape is a `geo:Point`
  blank node hung off the building by `geo:location`: `<#b> geo:location [ a geo:Point ;
  geo:lat … ; geo:long … ; bldg:geocodePrecision bldg:Address|bldg:Postcode|bldg:City ]`.
  The serializer (`addGeoPoint` / `replaceGeoPoint`) skips `lat`/`long` in the generic
  field loop and emits this point instead (editing a legacy building migrates it);
  `buildingParser.ts` reads the point and **prefers it over** any flat fallback.
  `bldg:geocodePrecision` records *how exact the geocode was* (street address vs. postcode
  vs. just the city), surfaced as `BuildingType.geocodePrecision` (`"address" | "postcode"
  | "city"`); a coarser pin can still be mapped, just less precisely placed.

Consequences:

- Adding a displayed/persisted field touches ~3 spots: `BuildingType`,
  `predicateMap` (+ a `parsingFunction` and the write-side datatype set if
  numeric/boolean).
- **Unmapped predicates are invisible** — the parser only copies predicates present
  in the maps; anything else in the Turtle is dropped on read and never written
  back. The RDF may legitimately carry more than the app model knows about.
- Drift between the four is otherwise silent.

**Done (descriptor table).** `BUILDING_FIELDS` in
[`buildingConfig.ts`](../src/services/rdf/building/buildingConfig.ts) is now the
single source: one row per field (`{ field, iri, kind, type }`), from which
`predicateMap`, `objectPropertyMap`, `parsingFunctions`, and the serializer's
`INTEGER_FIELDS`/`DECIMAL_FIELDS`/`BOOLEAN_FIELDS` are all derived. `field` is
`keyof BuildingType` (compile-checked). Heavier consolidations (generate
`BuildingType` from SHACL/ShEx, or an RDF-object mapper like LDO/LDkit) stay out of
scope.

## Rejected: shape detection as the discriminator

ShEx/role-inference was considered and dropped. Shapes overlap on `<BuildingCore>`
(user and dummy are indistinguishable at the building-file level — both core +
`gran:hasEnergyConsumptionDataset`), so a match would be a structural *guess* that
flips behaviour silently on sparse/malformed data. Behaviour instead dispatches on
the dataset's **declared** `cons:granularity` (`isSeriesGranularity`), an explicit
assertion that's in hand from the building file. The earlier `roleDetection.ts` n3
detector (`detectBuildingRole`/`detectEnergyShape`/`resolveRole`) was never wired in
and is removed; shapes are now needed at most to *validate* declared data.

## Role is decoupled from shape

Energy load, synthesis, and render dispatch on the **data's declared
shape/granularity**, never on a role — and a building no longer carries a producing-role
category at all (provenance is the agent only, `attributedTo`). Concretely:

- Datasets declare `cons:granularity` on write (`buildingSerializer.ts`; user series →
  `"PT15M"`).
- Load strategy follows granularity via `isSeriesGranularity()` (`durationUtils.ts`):
  the prefetch-skip in `TurtleParsingService.ts` keys purely on the declared period
  (series ⇒ lazy; no granularity ⇒ non-series).
- Inline-aggregate energy synthesis keys on **presence of `annualData`**, not
  `role === "investor"` (so benchmark inline data is covered too).
- `Building.tsx` renders investor/bench predicates whenever present
  (`hasInvestorDetails`), with no role gate.
- `ExplorePage.tsx` / `Energy.tsx` dispatch on `annualData` (annual chart) vs. a
  declared series granularity (time-series `Energy`).

The reason for the split: one "role" used to overload three independent things —
building predicate set, energy graph shape + load strategy, and provenance — which
breaks on real data where two actors in the *same* role carry *different* shapes (both
BLG and Zufall are "user", but Zufall supplies quarter-hourly load profiles where we
otherwise model annual consumption; even one actor has buildings at different
granularities). Energy is therefore unified onto one self-describing `cons:EnergyDataset`
node that declares its own period (`cons:granularity`, an `xsd:duration`), so a building
carries annual *and* 15-min datasets regardless of role and the loader switches on the
period. That dataset model is owned by [`energy-model.md`](./energy-model.md).

## Import / export formats (XLSX)

A spreadsheet *layout*, not a role — purely a serialization concern, independent of data
and of data-shape dispatch. Three committed templates (partner-derived spreadsheets,
anonymized but keeping the column structure) plus a generic fallback: a **row-label**
layout (field labels down one column, a building per column — the former "investor"
shape), a **table** column-header layout (German headers — the former "BSP" shape), a
**15-minute load-profile** series, and a generic one keyed by `BuildingType` field names.

**Import** auto-detects the layout on upload — `detectSpreadsheetFormat` sniffs the
distinctive signatures (a column-B label like `Gebäude-Code` → row-label; the German
headers incl. `Schmutzwasser (m³)` → table; else generic / Lastgang) — with a manual
**File format** override in the "Autofill from file" sub-flow. It normalizes cells
(German `Ja`/`Nein` booleans, comma/percent numbers, enum coercion) into one flat field
map per building — annual figures as per-year energy fields, a load profile as parsed
readings. From there the **normal write path** takes over (no import-specific storage):
the energy fields become `cons:EnergyDataset` resources and the building file is
serialized and PUT, with the producing agent stamped as provenance. Import is just "fill
the same fields a manual edit would," then write — energy included.

**Export** is the inverse, and one subtlety drives it: since energy is no longer inline
in the building file, the exporter first **fetches each building's annual datasets and
re-attaches them** to the in-memory building so the (synchronous) workbook build has the
figures. The sheet layout is **chosen by the user at download** (`buildingToXlsx(b,
style)` + a Manage style menu), since the building carries no role — the same three
layouts, plus a flat one-row-per-building form for multi-building export, all re-importing
via the generic path.

Spreadsheets are read/written with the `xlsx` (SheetJS) library, pinned at **0.18.5** (a
SheetJS-CDN upgrade was declined for licensing — see CLAUDE.md / project notes).

## Relation to Real Estate Core (REC)

[REC](https://w3id.org/rec#) is a published industry ontology for buildings/real
estate. Here it's used **thinly** — a veneer over the project's own `gran:` vocab:

- `rec:Building` — the building `rdf:type` (written `buildingSerializer.ts:314`,
  expected on read; both sides use the `REC_BUILDING` constant).
- `rec:operatedBy`, `rec:nace-code` — two core predicates (`buildingConfig.ts:48-49`).
  Caveats: `rec:operatedBy` *is* a real REC term (a property on `rec:Architecture`,
  range an `Agent` — a WebID IRI), but we currently store it as an `xsd:string`
  **literal** (`kind: "literal"`), not as an IRI-valued object, so it doesn't match
  REC's range. `rec:nace-code` is **not confirmed** as a published REC term (REC 4.0
  uses camelCase, not `nace-code`); treat that IRI as likely non-standard /
  non-dereferenceable rather than canonical REC.
- `rec#agent` — the agent type string (`agentParser.ts:12`).
- Everything else — areas, investor/benchmark fields, the whole energy model — is
  `gran:`/`bldg:`/`cons:`/SOSA, **not** REC.

So REC supplies the top-level building/agent **type + two identifiers**; `gran:`
carries the actual domain data. REC is barely load-bearing, and not dereferenced
(same as `gran:`).

**Resolved:** an earlier casing inconsistency in the type IRI (`rec:Building` vs. a
lowercase `rec#building`) is fixed — serializer (`:314`) and parser (`:115`) now both
use the `REC_BUILDING` constant (`…#Building`, capital), so they agree on REC's real
class name.

**Bearing on the role/schema redesign above:** REC is the natural home for the
"self-describing master data, parse on predicate presence" direction — but only for
what REC actually models. REC is a *topology* ontology: building → storey → space,
plus `Agent`, `Address`, and GeoSPARQL `Geometry`. It deliberately does **not** define
quantitative master-data predicates (no building/land area, height, year-of-construction,
and no NACE predicate), so most of our numeric `bldg:` fields have no REC
equivalent and must stay bespoke. Aligning the predicates REC *does* cover (the building
type, agent/`operatedBy`, address, spaces) makes the "superset template" interoperable
where it can be, while the genuinely project-specific parts stay in own terms: **energy
(cons:/SOSA/QUDT — REC has no strong time-series model), roles, and all the quantitative
attributes REC omits**. So "publish a real vocab" is only partly reframed — for building
*topology/agent/address* you map to REC; for areas, energy, and roles you still mint
your own.

## Static FAU-hosted resources (`solid.ti.rw.fau.de/gra/…`)

Everything the app hardcodes to the FAU pod, in two distinct kinds:

### A. Vocabulary namespaces — IRI prefixes, never fetched

Defined in `vocabularies.ts`; used only to build predicate/class IRI strings (the
`*_NS` constants). The app **does not dereference** them — they could be dangling
and the app would still work. They are *not* "static files" the app loads:

- `vocab.ttl#` (`GRAN_NS`) — core app plumbing: role instances (`gran:DummyRole`,
  `gran:InvestorRole`, …), the sharing-log `gran:kind`, preferences, bookmarks.
- `building.ttl#` (`BUILDING_NS`) — building master data (`bldg:hasBuildingArea`,
  `bldg:shiftRegime`, …); a RealEstateCore extension profile.
- `consumption.ttl#` (`CONSUMPTION_NS`) — energy observations and what's derived
  from them (`cons:hasEnergyDataset`, `cons:granularity`, views, benchmarks).

These are a **shared contract**: changing a prefix only matters because producers
serialize the same IRIs (`buildingSerializer.ts`) and the parser matches them
(`buildingConfig.ts`). "Removing" them = minting your own vocabulary IRIs and
re-keying both sides; it's not a file fetch to cut, it's an ontology decision.

The ontologies themselves are versioned in [`vocab/`](../vocab/) — the repo is their
source of truth (one document per namespace), and `vocab.test.ts` asserts every owned
field-schema predicate, object-property range, and controlled-vocab instance is defined
there, so the code and the published vocab can't drift. The documents on the Pod (under
the public `gra/` base) are a publish target; the app never fetches them at runtime.

### B. Demo data — offered, not auto-seeded

A fresh Pod loads empty — nothing is silently seeded. Instead the UI **offers** demo
data via a banner (`useDemoSeedPrompt`); on accept, `seedDemoBuildings`
(`buildingSerializer.ts`) writes two real owned buildings (Nordostpark 84 and Lange
Gasse 20, Nürnberg) carrying energy at *different granularities* (one annual aggregate,
one PT15M series) so a new user immediately sees both shapes the app dispatches on. Pod
layout, own-building discovery, and the banner mechanics are owned by
[`data-layout.md`](./data-layout.md).
