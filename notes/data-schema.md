# Data schema — data-source roles & graph shapes

What a "role" means, why it is per data source, and the graph shape each role
implies. Shapes are drafted in [`roles.shex`](../roles.shex); an n3 detector mirrors
them in [`roleDetection.ts`](../src/services/utils/roleDetection.ts). Membership
roles are a separate concept — see [`room.md`](./room.md).

## Two meanings of "role"

`UserRole = "dummy" | "investor" | "user" | "benchmark_service_provider"`
(`types/types.ts`) is reused for:

- **Source role** — on a data-source *file*. Stored `<src> gran:dataSourceRole
  gran:InvestorRole` in `dataSources.ttl`. Read by `TurtleParsingService.ts`
  (`getSourceRegistry`). Means "this file is in the investor shape".
- **Membership role** — on an *agent* (WebID). Stored as `as:Update` +
  `sioc:has_function` in a room log. Read by `dataRoom.ts` (`getMyRole`,
  `getMembersByRole`). Means "this person acts as an investor here".

IRI mapping (both): `dummy`→`gran:DummyRole` (`vocab.ttl#`),
`investor`→`gran:InvestorRole` (`investor-vocab.ttl#`),
`user`→`gran:UserRoleInstance` (`user-vocab.ttl#`),
`benchmark_service_provider`→`gran:BenchmarkRole` (`benchmark-vocab.ttl#`).

## Source role = per-file schema selector

One session's `dataSources.ttl` aggregates files authored by different actors in
different vocabularies (own `buildings.ttl` as `DummyRole`, an investor's shared
file, a tenant's readings, a benchmark file) — structurally different graphs. The
role selects the parser per source.

It travels with the data: sharing writes it into the shared registry (`share.ts`)
and copies it to the recipient's `dataSources.ttl` (`inbox.ts`,
`sharingManager.ts`); own imports write it (`buildingSerializer.ts`,
`addBuildingDataSource`). Unannotated sources default to `dummy`
(`TurtleParsingService.ts:283`) — the main weak spot.

## What the role gates

- **Building predicates** — dummy/user: core; benchmark: core + `bench:*`;
  investor: core + `investor:*`.
- **Energy location** — dummy/benchmark: separate file(s); user: separate **daily**
  file(s); investor: **inline** observations.
- **Energy graph** — dummy/benchmark/investor: `sosa:Observation` (investor via
  `hasFeatureOfInterest`); user: `uservoc:EnergyConsumptionReading`.
- **When energy loads** — dummy/benchmark: bulk prefetch; user: lazy on click;
  investor: synthesized from inline obs.
- **Parsed into** — dummy/benchmark: 7 `EnergyType` categories; investor:
  `InvestorAnnualData` → `energyNeed`; user: `timeSeries.electricityConsumption`.

Code: `TurtleParsingService.ts:465` (skip user prefetch), `:568` (synthesize
investor energy); `energyDataParser.ts`; `Map.tsx` / `Building.tsx` rendering.

## Shapes (`roles.shex`)

One shape per role, reverse-engineered from `buildingConfig.ts`,
`buildingParser.ts`, `energyDataParser.ts`, `userEnergyParser.ts`:
`<BuildingCore>`; per-role `<DummyBuilding>`/`<UserBuilding>`/`<BenchmarkBuilding>`/
`<InvestorBuilding>`; energy `<CategoricalObservation>` (dummy/bench)/`<UserReading>`/
`<InvestorObservation>`; supporting `<OperatingCosts>`/`<Certification>`/
`<EnergyDatasetRef>`/`<TimeInterval>`/`<SimpleResult>`. The imperative parsers
remain the source of truth.

## ShEx cannot be the primary discriminator

- Shapes overlap on `<BuildingCore>`; open shapes match several roles, closed
  shapes reject routinely-partial data.
- **User and dummy are indistinguishable at the building-file level** — both are
  core + `gran:hasEnergyConsumptionDataset`; they diverge only in the referenced
  energy file's content. The role is unrecoverable from the building file alone.
- The role gates *fetching* (lazy-load user, synthesize investor), decided before
  the files are in hand — a post-fetch conformance check is too late.
- `gran:dataSourceRole` is a declared assertion; a ShEx match is a structural guess
  that flips behaviour silently on sparse/malformed data.

Recommended: keep `gran:dataSourceRole` authoritative; use shapes to **validate**
declared roles and to **infer only when the annotation is missing** (replace the
`?? "dummy"` fallback, `TurtleParsingService.ts:283`). Inference from shape is sound
only while shape ⟺ role stays bijective.

## Detector vs. shapes

ShEx JS engines don't run under Deno, so `roles.shex` can't be validated in the
test harness. [`roleDetection.ts`](../src/services/utils/roleDetection.ts) encodes
the same signatures:

- `detectBuildingRole(store)` — investor/benchmark certain; dummy/user →
  `{ role: "dummy", certain: false }`.
- `detectEnergyShape(store)` — `user-readings` vs `categorical-observations`.
- `resolveRole(buildingStore, energyStore?)` — end-to-end decision.

Tested offline (`roleDetection.test.ts`, `deno task test`) incl. the user/dummy
ambiguity and a drift guard against `roles.shex`. **Not yet wired into the app** —
intended first use is the `:283` fallback.

## Proposed: decouple role from shape (design — not yet built)

### The problem (from the producers)

One "role" overloads three independent things: (a) building **predicate set**,
(b) energy **graph shape** + load strategy, (c) **provenance**. That breaks on real
data — two actors in the *same* role carry *different* data:

- BLG and Zufall are both **user** role, but Zufall supplies **quarter-hourly**
  load profiles while we otherwise model **annual** consumption.
- Even one actor (Mike/Zufall) has buildings at different granularities.

The role can't express this: "user" forces one energy shape (`uservoc:` 15-min
readings, lazy per-click), so an annual-data user, or a benchmark with 15-min data,
has nowhere to go. `roleDetection.ts` already *names* the real axis separately —
`detectEnergyShape` → `user-readings | categorical-observations` — but the app
collapses it back into the role label.

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
  on the dataset type via `detectEnergyShape`/the declared type. Role stops gating
  energy. `roleDetection.ts` is the seam — it already returns the shape.
- **Step 3 — predicate-driven render.** Drop the `sourceRole === "investor"` gate
  in `Building.tsx`; render whatever predicates are present. Role becomes a
  provenance label/badge only.
- **Step 4 — role = provenance.** Keep `dataSourceRole` for attribution + the
  data-room membership concept (`room.md`); remove its parsing/loading authority.

### Touch points & risks

- `roles.shex` / `roleDetection.ts` — reframe shapes around **energy-dataset
  types** (annual vs sub-hourly) rather than role; the detector already does most
  of this.
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
big or small — exactly the coupling to keep, now explicit. `detectEnergyShape`
becomes `granularityOf(dataset)` reading `gran:granularity` (falling back to: has
`gran:observationsAt` ⇒ series; inline result ⇒ aggregate).

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

**Inconsistency to fix:** the type IRI is cased three ways — `rec:Building`
(serializer, `TurtleParsingService.test.ts`), `rec#building`
(`buildingParser.ts:121`), `rec:building` (`roleDetection.test.ts`). REC's real
class is **`rec:Building`** (capital); the lowercase variants are latent bugs that
only pass because building detection keys on URL patterns, not the type.

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

`roles.shex`; `roleDetection.ts` (+`.test.ts`); `types/types.ts` (`UserRole`,
`BuildingType`); `config/buildingConfig.ts` (predicate → field maps);
`buildingParser.ts`; `energyDataParser.ts`; `userEnergyParser.ts`;
`vocabularies.ts` (the `*_NS` prefixes above);
`TurtleParsingService.ts` (registry read, per-role orchestration, bootstrap
defaults); [`room.md`](./room.md) (membership role).
