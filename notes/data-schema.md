# Data schema — provenance, templates & graph shapes

What a building's provenance means, how the graph shape varies by producer, and how
the app dispatches on the data's own shape (not on a "role"). The imperative parsers
(`buildingParser.ts`, `energyDataParser.ts`, `userEnergyParser.ts`) are the source of
truth for those shapes. Membership roles are a separate concept — see
[`room.md`](./room.md).

## Three things `UserRole` is reused for

`UserRole = "dummy" | "investor" | "user" | "benchmark_service_provider"`
(`types/types.ts`) labels three *independent* concerns; **none of them gates
parsing / loading / rendering** — that dispatches on the data's own shape:

- **Provenance** — who produced a building's data. Recorded in the building file as a
  PROV-O qualified attribution: `<#b> prov:qualifiedAttribution [ a prov:Attribution ;
  prov:agent <webid> ; prov:hadRole gran:InvestorRole ]`. Read by `buildingParser.ts`
  into `BuildingType.provenance` / `attributedTo`. Legacy pods carry it instead as
  `<src> gran:dataSourceRole gran:InvestorRole` in `dataSources.ttl`;
  `TurtleParsingService.ts` reads that **only as a fallback** when the file has no
  attribution.
- **Membership role** — on an *agent* (WebID), in a room log (`as:Update` +
  `sioc:has_function`). Read by `dataRoom.ts` (`getMyRole`, `getMembersByRole`). Means
  "this person acts as an investor here". A sharing target.
- **Import/export template** — `parseCsvToFields(file, template)` /
  `buildingToWorkbook` pick the spreadsheet shape (investor row-label / BSP columns /
  generic) by category.

Category ↔ IRI maps live in `constants/roles.ts` (`PROVENANCE_TO_IRI` /
`IRI_TO_PROVENANCE`): `dummy`→`gran:DummyRole`, `investor`→`gran:InvestorRole`,
`user`→`gran:UserRoleInstance`, `benchmark_service_provider`→`gran:BenchmarkRole`.

## Open question: where does a building's provenance come from?

Two of the three concerns above are still entangled at **add time**. The Add dialog's
selector (`AddBuildingDialog.tsx`) is now a plain import **template** chooser, no longer
gated on a data-room role (decoupled 2026-06-05) — but the chosen template *also* supplies
the provenance category: `serializeBuildingToTurtle(…, { agent: webId, category: template })`.
So picking the "User" template to parse a spreadsheet silently attributes the building to
you *as a tenant*. Template is a property of **the file**; provenance is a property of
**you** — they shouldn't ride one dropdown.

The remaining step of PROBLEMS.md #1 / Handbuch HW5 ("role should be set per-user in
profile … applied automatically, not chosen in the add-data flow") is to **bind provenance
to the WebID profile**: declare your producing capacity once in your profile document and
have every building you add inherit it, leaving the template selector to do only one job
(pick the spreadsheet shape). Reading it would reuse `loadProfileStore`
(`profileDocument.ts`); the app already stores org identity in the WebID via W3C Org
(`org:memberOf`), so there's precedent, e.g. `<#me> gran:actsAs gran:InvestorRole`.

Before implementing, these need deciding:

- **Is a producer's capacity fixed per person, or per building?** An investor is always
  an investor — but a benchmark service provider may add data *about someone else's*
  building. If fixed → a single profile value is clean. If it can vary → keep a
  per-building override, *defaulted* from the profile rather than chosen blind.
- **One capacity or several?** A person may act in more than one producing capacity. Pick a
  single default and let the override handle the rest, or prompt when ambiguous?
- **Which predicate / vocabulary?** Reuse the W3C Org pattern (`org:memberOf` /
  `org:role`) already in the profile, or mint a dedicated `gran:actsAs`? The value should
  reuse the existing category IRIs (`PROVENANCE_TO_IRI`) for a trivial read.
- **Relation to the data-room membership role.** The profile *producing* capacity and the
  room *membership* role are different things (who made the data vs. a sharing target) and
  should stay separate fields — even though both currently draw from `UserRole`. Don't
  collapse them back into one.
- **Back-compat.** No migration: provenance already lives *in each building file*, so
  existing attributions stay valid. Profile binding only changes where the **default** for
  *new* buildings comes from.

## Graph shape varies by producer, but dispatch is data-driven

One session's `dataSources.ttl` aggregates files authored by different actors in
different vocabularies (own `buildings.ttl`, an investor's shared file, a tenant's
readings, a benchmark file) — structurally different graphs. The parser keys on
**predicate presence** (core + optional `investor:*` / `bench:*`), and energy
loading/rendering keys on the dataset's declared **granularity** — so the producer
category is never needed to read the data correctly.

Provenance travels with the data: `serializeBuildingToTurtle` writes the PROV
attribution into the building file on create, and a sharing recipient reads it
straight from the shared file. The legacy `gran:dataSourceRole` is no longer written
to the registry.

## What dispatches on data shape (not role)

- **Building predicates** — rendered whenever present (`hasInvestorDetails` in
  `Building.tsx`): core always, `investor:*` / `bench:*` when the subject carries
  them. No role gate.
- **Energy location** — separate file(s) (a daily series, or an annual file) vs.
  inline `sosa:Observation`s; read structurally.
- **When energy loads** — on the dataset's declared `gran:granularity` via
  `isSeriesGranularity()` (`durationUtils.ts`): a sub-hourly series (`PT15M`) is
  lazy-loaded on click; an aggregate is bulk-prefetched. A dataset with no declared
  granularity is treated as non-series.
- **Energy render** — `ExplorePage.tsx` / `Energy.tsx` dispatch on the presence of
  `annualData` (annual chart) vs. a declared series (time-series chart), never a role.

Code: `TurtleParsingService.ts` (granularity skip-prefetch), `durationUtils.ts`,
`energyDataParser.ts`; `ExplorePage.tsx` / `Building.tsx` rendering.

## Graph shapes per role

The shapes aren't formally specified — they're whatever the imperative parsers
read/write: `buildingConfig.ts`, `buildingParser.ts`, `energyDataParser.ts`,
`userEnergyParser.ts`. Conceptually there's a shared building core plus per-role
variants (dummy/user share one; investor and benchmark add namespace-specific
predicates), and energy is either categorical SOSA observations (dummy/bench/
investor) or a `uservoc:EnergyConsumptionReading` time series (user). The parsers
are the source of truth; there's no separate shape/validator layer.

> An earlier draft formalised these (and the app's on-Pod registry/view/sharing
> files) as ShEx in `roles.shex`, with n3 mirrors in `roleDetection.ts` /
> `shapeValidators.ts`. That was removed: ShEx engines don't run under Deno, role
> is now provenance, recorded as a PROV qualified attribution in the building file
> (not sniffed from shape), and the validators had no callers. The only survivor
> is `isSeriesGranularity` in `durationUtils.ts` (load-strategy helper).

## Two schemas: RDF graph ⇄ app objects

A building is described twice — as RDF triples on the Pod, and as a typed JS
object in the app — with a mapping layer between them. It's the usual object↔RDF
"impedance mismatch" (the same shape as an ORM between a DB schema and a class
model). The boundary is one-way at load time: RDF → typed object → React props
(see [`data-deref.md`](./data-deref.md)); the reverse runs only on save.

The building schema therefore lives across four artifacts that must agree:

- **RDF vocabulary** — predicate IRIs in
  [`vocabularies.ts`](../src/services/utils/vocabularies.ts).
- **App object type** — `BuildingType` (also `AgentType`, `EnergyType`) in
  `types/types.ts`.
- **Predicate ⇄ field mapping** — `predicateMap` / `objectPropertyMap` in
  [`buildingConfig.ts`](../src/services/utils/config/buildingConfig.ts).
- **Datatype/coercion** — `parsingFunctions` (read: literal → JS) in
  `buildingConfig.ts`, and separately `INTEGER_FIELDS`/`DECIMAL_FIELDS`/
  `BOOLEAN_FIELDS` + `xsdType()` (write: JS → typed literal) in
  [`buildingSerializer.ts`](../src/services/utils/buildingSerializer.ts).

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

Consequences:

- Adding a displayed/persisted field touches ~3 spots: `BuildingType`,
  `predicateMap` (+ a `parsingFunction` and the write-side datatype set if
  numeric/boolean).
- **Unmapped predicates are invisible** — the parser only copies predicates present
  in the maps; anything else in the Turtle is dropped on read and never written
  back. The RDF may legitimately carry more than the app model knows about.
- Drift between the four is otherwise silent.

**Done (descriptor table).** `BUILDING_FIELDS` in
[`buildingConfig.ts`](../src/services/utils/config/buildingConfig.ts) is now the
single source: one row per field (`{ field, iri, kind, type }`), from which
`predicateMap`, `objectPropertyMap`, `parsingFunctions`, and the serializer's
`INTEGER_FIELDS`/`DECIMAL_FIELDS`/`BOOLEAN_FIELDS` are all derived. `field` is
`keyof BuildingType` (compile-checked). Heavier consolidations (generate
`BuildingType` from SHACL/ShEx, or an RDF-object mapper like LDO/LDkit) stay out of
scope.

## ShEx cannot be the primary discriminator

- Shapes overlap on `<BuildingCore>`; open shapes match several roles, closed
  shapes reject routinely-partial data.
- **User and dummy are indistinguishable at the building-file level** — both are
  core + `gran:hasEnergyConsumptionDataset`; they diverge only in the referenced
  energy file's content. The role is unrecoverable from the building file alone.
- Fetching used to be gated on role (lazy-load user, synthesize investor), decided
  before the files are in hand. **This is no longer true** — fetching now dispatches
  on the dataset's declared `gran:granularity` (`isSeriesGranularity`), which *is* in
  hand from the building file, so the discriminator problem is moot.
- A ShEx match would be a structural guess that flips behaviour silently on sparse /
  malformed data; the declared granularity is an explicit assertion instead.

Historically the recommendation was "keep the source role authoritative". That role
is now **provenance only** (a PROV attribution), and behaviour keys on granularity, so
shapes are no longer needed as a behaviour discriminator at all — only, optionally, to
validate declared data.

## Detector vs. shapes (removed)

An earlier `roleDetection.ts` encoded the same signatures as an n3 detector
(`detectBuildingRole`, `detectEnergyShape`, `resolveRole`) for a "validate +
infer-on-missing" flow. It was never wired into the app and has been removed —
role comes from the declared `gran:dataSourceRole` IRI, and the only behaviour
that survived (the load-strategy split below) is now `isSeriesGranularity` in
`durationUtils.ts`.

## Decouple role from shape (DONE)

> **Status (current).** Energy load, synthesis, and render dispatch on the **data's
> declared shape/granularity**, not on a role. The producer category is now
> **provenance only**, recorded as a PROV qualified attribution in the building file
> (`BuildingType.provenance` / `attributedTo`); old pods fall back to the registry
> `gran:dataSourceRole`.
> - Datasets declare `gran:granularity` on write (`buildingSerializer.ts`;
>   user series → `"PT15M"`).
> - Load strategy follows granularity via `isSeriesGranularity()`
>   (`durationUtils.ts`): the prefetch-skip in `TurtleParsingService.ts` keys purely
>   on the declared period (series ⇒ lazy; no granularity ⇒ non-series). The old
>   `role === "user"` fallback is gone.
> - Inline-aggregate energy synthesis keys on **presence of `annualData`**, not
>   `role === "investor"` (so benchmark inline data is covered too).
> - `Building.tsx` renders investor/bench predicates whenever present
>   (`hasInvestorDetails`), with no role gate.
> - `ExplorePage.tsx` / `Energy.tsx` dispatch on `annualData` (annual chart) vs. a
>   declared series granularity (time-series `Energy`), never a role.
>
> Still open: naming first-class dataset-shape *types* and publishing a real vocab
> (see "Open vocab question"); these stayed out of scope.

### The problem (from the producers)

One "role" overloads three independent things: (a) building **predicate set**,
(b) energy **graph shape** + load strategy, (c) **provenance**. That breaks on real
data — two actors in the *same* role carry *different* data:

- BLG and Zufall are both **user** role, but Zufall supplies **quarter-hourly**
  load profiles while we otherwise model **annual** consumption.
- Even one actor (Mike/Zufall) has buildings at different granularities.

The role can't express this: "user" forces one energy shape (`uservoc:` 15-min
readings, lazy per-click), so an annual-data user, or a benchmark with 15-min data,
has nowhere to go. The real axis is the energy dataset's own shape (categorical
SOSA observations vs. a `uservoc:EnergyConsumptionReading` time series), but the
app collapses it back into the role label.

### Direction: make the data self-describing, role = provenance only

Split the three concerns that `role` conflates:

1. **Predicate set** — already additive and self-describing: a building just has
   whatever predicates it has (core + optional `investor:*` / `bench:*`). The
   parser can key on **predicate presence**, not role. (`buildingConfig` is already
   a flat map; nothing forces "investor fields only if role=investor" except the
   render gate in `Building.tsx`.)
2. **Energy shape + granularity** — make it explicit **on the data**, not inferred
   from role. Each energy dataset declares its own shape/period, e.g.
   `gran:hasEnergyConsumptionDataset` → a dataset node typed
   `gran:AnnualSeries | gran:QuarterHourSeries` (or a `gran:granularity` /
   `time:` resolution + an observation-shape type). The loader dispatches on that
   type, so any actor can mix annual + 15-min regardless of role. This generalises
   the existing `energyDataParser` (categorical) vs `userEnergyParser` (time
   series) split — pick the parser from the declared dataset type.
3. **Provenance** — `gran:dataSourceRole` stays, but means only "who produced
   this / which actor view" (investor / user / benchmark / demo). It no longer
   selects parsing or loading.

Net: the **template** Heike proposed maps cleanly — one superset of optional
predicates for master data; consumption as separate datasets that each *declare*
their granularity. A producer fills what they have; the app reads what's declared.

### Migration path (incremental, low-risk)

- **Step 1 — declare, keep dispatching on role.** Start writing the dataset
  shape/granularity type when serializing (`buildingSerializer`), and have the
  loader *prefer* the declared type but fall back to the role default. No behaviour
  change for existing data; new data is self-describing.
- **Step 2 — dispatch on the declared shape.** Switch `TurtleParsingService`'s
  `sourceRole === "user"` / `!== "investor"` branches (`:463`, `:566`) to dispatch
  on the declared dataset type/granularity (`isSeriesGranularity`, `durationUtils.ts`).
  Role stops gating energy.
- **Step 3 — predicate-driven render.** Drop the `sourceRole === "investor"` gate
  in `Building.tsx`; render whatever predicates are present. Role becomes a
  provenance label/badge only.
- **Step 4 — role = provenance.** Keep `dataSourceRole` for attribution + the
  data-room membership concept (`room.md`); remove its parsing/loading authority.

### Touch points & risks

- `TurtleParsingService.ts` (`:463`, `:566`), `energyDataParser.ts`,
  `userEnergyParser.ts`, `buildingSerializer.ts`, `Building.tsx` render gate.
- **Risk:** the load *strategy* (lazy per-click for big 15-min series vs. bulk
  prefetch for small annual) must follow the **granularity**, not role — keep that
  coupling, just drive it from the declared period.
- **Open vocab question:** name the dataset-shape terms (`gran:AnnualSeries`,
  `gran:QuarterHourSeries`, or a generic `gran:granularity "P1Y" | "PT15M"`); ties
  into the "publish a real vocab" point under FAU resources below.

### Concrete proposal

Today there are **three** incompatible energy encodings, picked by role:

- **dummy / benchmark** — building → `gran:hasEnergyConsumptionDataset` → blank
  node with `measurementYear` / `datasetLocation` / `type` (points at a separate
  file). Categorical, annual.
- **investor** — inline `sosa:Observation`s joined by `sosa:hasFeatureOfInterest`,
  `observedProperty gran:AnnualElectricityConsumption…`, year via
  `time:hasBeginning`. Annual.
- **user** — separate daily files of `uservoc:EnergyConsumptionReading` (15-min),
  same SOSA result/time structure. Sub-hourly.

They already share SOSA (`observedProperty` / `hasResult/hasSimpleResult` /
`phenomenonTime`). The only real differences are **period** (P1Y vs PT15M) and
**where the observations live** (inline vs separate file). So unify on **one
`gran:EnergyDataset` node that declares its period**, and make the *observation*
shape uniform:

```turtle
@prefix gran: <…/vocab.ttl#> .
@prefix sosa: <http://www.w3.org/ns/sosa/> .
@prefix qudt: <http://qudt.org/schema/qudt/> .

<#11> a rec:Building ;
  # master data: just the predicates it has (no role gate)
  vcard:locality "Bremen" ; gran:hasBuildingArea 4200 ;
  investor:hallArea 3800 ;                      # present ⇒ shown; absent ⇒ not
  gran:hasEnergyDataset <#ds-elec-2023>, <#ds-elec-2023-15min> .

# annual electricity (BLG-style) — value inline
<#ds-elec-2023> a gran:EnergyDataset ;
  sosa:observedProperty gran:ElectricityConsumption ;
  gran:granularity "P1Y" ;                      # xsd:duration — the discriminator
  gran:period [ time:hasBeginning "2023-01-01"^^xsd:date ] ;
  sosa:hasResult [ sosa:hasSimpleResult 412000 ; qudt:unit unit:KiloW-HR ] .

# quarter-hourly electricity (Zufall-style) — observations in a separate file
<#ds-elec-2023-15min> a gran:EnergyDataset ;
  sosa:observedProperty gran:ElectricityConsumption ;
  gran:granularity "PT15M" ;
  gran:observationsAt <energy/2023/> .          # LDP container of daily files
```

Both hang off the **same** building under the **same** predicate
(`gran:hasEnergyDataset`); a single building can carry annual *and* 15-min, any
role. `gran:granularity` (an `xsd:duration`) is the one value the loader switches
on — no role involved.

### Dispatch, by granularity not role

Replace the role branches (`TurtleParsingService.ts:463` skip-user-prefetch, `:566`
investor-only) with, per dataset:

```
period = dataset.granularity
if period ≤ ~PT1H        → "series": observations live at gran:observationsAt;
                            lazy-load on click (could be large)   [today's "user"]
else (P1M … P1Y)         → "aggregate": value inline on the dataset;
                            bulk-load with the building            [today's annual]
```

So **load strategy follows the period**, which is the thing that actually makes it
big or small — exactly the coupling to keep, now explicit. This is what
`isSeriesGranularity` (`durationUtils.ts`) reads from `gran:granularity` (falling
back to aggregate when none is declared).

### What each existing shape maps to

- dummy/benchmark `hasEnergyConsumptionDataset` + `measurementYear` →
  `EnergyDataset granularity "P1Y"` with inline result (drop the separate-file
  indirection, or keep it as `observationsAt` if multi-row).
- investor inline annual obs → `EnergyDataset granularity "P1Y"`, inline result
  (one per property/year).
- user 15-min files → `EnergyDataset granularity "PT15M"` +
  `observationsAt <…/energy/>`; the daily files keep today's
  `EnergyConsumptionReading` rows (or just `sosa:Observation`).

### Smallest first step

Don't migrate all three at once. **Add `gran:hasEnergyDataset` + `gran:granularity`
as the new write format in `buildingSerializer`**, teach the loader to read it
(preferring it over the legacy shapes), and convert one producer path (the user
15-min one, since it's already separate-file). Legacy dummy/investor/benchmark
reads keep working via the existing parsers until converted. This is the Step-1/2
from the migration path above, made concrete.

## Relation to Real Estate Core (REC)

[REC](https://w3id.org/rec#) is a published industry ontology for buildings/real
estate. Here it's used **thinly** — a veneer over the project's own `gran:` vocab:

- `rec:Building` — the building `rdf:type` (written `buildingSerializer.ts:380`,
  expected on read).
- `rec:nace-code`, `rec:operatedBy` — two core predicates (`buildingConfig.ts:24-25`).
- `rec#agent` — the agent type string (`agentParser.ts:12`).
- Everything else — areas, investor/benchmark fields, the whole energy model — is
  `gran:` / `investor:` / `bench:` / SOSA, **not** REC.

So REC supplies the top-level building/agent **type + two identifiers**; `gran:`
carries the actual domain data. REC is barely load-bearing, and not dereferenced
(same as `gran:`).

**Inconsistency to fix:** the type IRI is cased inconsistently — `rec:Building`
(serializer, `TurtleParsingService.test.ts`) vs. `rec#building`
(`buildingParser.ts:121`). REC's real class is **`rec:Building`** (capital); the
lowercase variant is a latent bug that only passes because building detection
keys on URL patterns, not the type.

**Bearing on the role/schema redesign above:** REC is the natural home for the
"self-describing master data, parse on predicate presence" direction — building
geometry / areas / spaces / NACE / operatedBy are REC's domain. Aligning
master-data predicates to REC (where they exist) makes the "superset template"
principled and interoperable, and shrinks the bespoke `gran:` vocab to its genuinely
project-specific parts: **energy (gran:/SOSA/QUDT — REC has no strong time-series
model) and roles**. It also reframes "publish a real vocab" — for *buildings* you
map to REC rather than mint your own; only energy + roles need own terms.

## Static FAU-hosted resources (`solid.ti.rw.fau.de/private/granergize/…`)

Everything the app hardcodes to the FAU pod, in two distinct kinds:

### A. Vocabulary namespaces — IRI prefixes, never fetched

Defined in `vocabularies.ts`; used only to build predicate/class IRI strings (the
`*_NS` constants). The app **does not dereference** them — they could be dangling
and the app would still work. They are *not* "static files" the app loads:

- `vocab.ttl#` (`GRAN_NS`) — core predicates + role instances (`gran:DummyRole`,
  `gran:dataSourceRole`, `gran:hasBuildingArea`, …). ~28 uses.
- `user-vocab.ttl#` (`USERVOC_NS`), `investor-vocab.ttl#` (`INVESTOR_NS`),
  `benchmark-vocab.ttl#` (`BENCH_NS`) — per-role predicate sets.

These are a **shared contract**: changing a prefix only matters because producers
serialize the same IRIs (`buildingSerializer.ts`) and the parser matches them
(`buildingConfig.ts`). "Removing" them = minting your own vocabulary IRIs and
re-keying both sides; it's not a file fetch to cut, it's an ontology decision. They
live under `/private/` and aren't publicly resolvable today — a real cleanup would
publish a dereferenceable vocab, independent of the app.

### B. Default data sources — fetched, but only as bootstrap defaults

Hardcoded in the bootstrap registry (`TurtleParsingService.ts:229-232`) when a pod
has no `dataSources.ttl` yet:

- `…/granergize/buildings.ttl` — demo buildings, seeded as `DummyRole`.
- `…/granergize/agents.ttl` — demo agents (see data-layout.md "External sources").

Unlike the vocab IRIs, these **are** fetched. They are *defaults*, not fixtures: a
real `dataSources.ttl` can list any pods' building/agent files, and once the
registry exists the FAU defaults aren't used. "Removing" them = changing what a
fresh registry seeds (e.g. empty, or the user's own files), in
`TurtleParsingService.ts`.

### Sketch: remove the bootstrap defaults

`getSourceRegistry` (`TurtleParsingService.ts:~216-250`) today, when no
`dataSources.ttl` exists, PUTs a registry pointing at the two FAU files. Downstream
already tolerates an empty registry (zero building/agent sources → empty arrays →
empty map, `:300-309`), so the demo URLs can go. Options, simplest first:

1. **Seed an empty registry.** Replace the `defaultBody` with a registry that has
   the user as `dcterms:creator` and **no** `hasBuildingDataSource` /
   `hasAgentDataSource` triples. A fresh pod loads to an empty map; the user
   populates it via Add Building (which calls `addBuildingToRegistry`) and by
   pasting/sharing sources. One-function change; nothing else moves.
2. **Don't create a registry on read at all.** Drop the PUT entirely; treat a
   missing `dataSources.ttl` as "no sources" (return empty). The registry is then
   created lazily on first write (`addBuildingToRegistry` already creates/updates
   it). Cleaner — reads stop having a write side effect — but verify every writer
   handles a missing registry (creates it), not just appends.
3. **Keep an opt-in demo.** Move the FAU URLs to a constant (e.g.
   `DEMO_SOURCES`) and only seed them behind a flag / first-run prompt ("load
   sample data?"), so the demo is recoverable but off by default.

Recommended: **(1)** now (smallest, safe — empty seed), with **(2)** as the
follow-up tidy (remove the read-path write). Keep the FAU URLs as a `DEMO_SOURCES`
constant if the sample data is still wanted for onboarding (option 3 on top of 1).

**Touch points:** `TurtleParsingService.ts` (`getSourceRegistry` bootstrap block);
fixtures in `TurtleParsingService.test.ts` that assume the FAU defaults; a quick
manual check that a brand-new pod loads to an empty map without console errors.
**Out of scope:** the per-role energy/agent *parsing* is unchanged — this only
changes what a fresh registry contains.

### Variant (4): seed two real, user-owned demo buildings

Instead of pointing the registry at external FAU files, **write two buildings to
the user's own pod on init** — owned by them, deletable like any other. Better
onboarding than option (1)'s empty pod (the map/pane/sharing have something to
show) without the FAU dependency.

Seed data (two Nürnberg addresses):
- **Nordostpark 84** — `49.4795, 11.1233` (approx)
- **Lange Gasse 20** — `49.4480, 11.0680` (approx)

Reuse the exact pipeline Add Building uses (`AddBuildingDialog` `handleSubmit`),
per building:

```
id  = newBuildingUri(webId, <id>)            // <root>/granergize/buildings/<id>.ttl
ttl = serializeBuildingToTurtle(fields, uri) // fields: streetAddress, locality,
uploadBuilding(session, uri, ttl, webId)     //   postalCode, region, lat, long
addBuildingToRegistry(session, webId, uri, "dummy")
```

(`fields` is the same `Record<string,string>` the dialog builds; minimal master
data + coords, no energy.) They land under the user's `granergize/buildings/` and
appear in `dataSources.ttl` as their own sources — so they're fully owned and the
existing per-building delete/hide/share works unchanged.

Where to run it: the bootstrap branch in `getSourceRegistry` creates the empty
registry (option 1), then a one-time `seedDemoBuildings(session, webId)` adds the
two. Guard so it runs **only on first init** (registry didn't exist) — never
re-add after the user deletes them.

**Caveats / decisions:**
- **Role:** seed as `dummy` (no data-room role needed) — unlike the live Add
  Building, which requires a role. Keep these role-light so a brand-new user (no
  room yet) still gets them.
- **Idempotence:** tie creation to the "registry was just bootstrapped" signal, not
  to "are there zero buildings" — otherwise deleting both would resurrect them on
  next load.
- **Coordinates** above are approximate; confirm exact lat/long (or geocode via the
  existing Nominatim helper at seed time).

**Touch points:** new `seedDemoBuildings` in `buildingSerializer.ts` (reuses its
own helpers); called once from `getSourceRegistry` bootstrap; offline-fixture test
that init creates two `buildings/*.ttl` + two registry entries, and that a second
load with the registry present does **not** re-seed.

## Files

`types/types.ts` (`UserRole`, `BuildingType`); `config/buildingConfig.ts`
(predicate → field maps); `buildingParser.ts`; `energyDataParser.ts`;
`userEnergyParser.ts`; `durationUtils.ts` (`isSeriesGranularity` load split);
`vocabularies.ts` (the `*_NS` prefixes above);
`TurtleParsingService.ts` (registry read, per-role orchestration, bootstrap
defaults); [`room.md`](./room.md) (membership role).
