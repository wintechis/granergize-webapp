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

- **Provenance** — who produced a building's data. Recorded as a PROV-O qualified
  attribution in the building file: `<#b> prov:qualifiedAttribution [ a
  prov:Attribution ; prov:agent <webid> ; prov:hadRole gran:InvestorRole ]`, read by
  `buildingParser.ts` into `BuildingType.provenance` / `attributedTo`. This file is the
  **only** source — the old `gran:dataSourceRole` registry fallback is gone with the
  per-pod source registry.
- **Membership role** — on an *agent* (WebID), in a room log (`as:Update` +
  `sioc:has_function`). Read by `dataRoom.ts` (`getMyRole`, `getMembersByRole`); means
  "this person acts as an investor here". A sharing target.
- **Import/export template** — `parseCsvToFields(file, template)` /
  `buildingToWorkbook` pick the spreadsheet shape (investor row-label / BSP columns /
  generic) by category.

Category ↔ IRI maps live in `constants/roles.ts` (`PROVENANCE_TO_IRI` /
`IRI_TO_PROVENANCE`): `dummy`→`gran:DummyRole`, `investor`→`gran:InvestorRole`,
`user`→`gran:UserRoleInstance`, `benchmark_service_provider`→`gran:BenchmarkRole`.

## Provenance comes from the WebID profile (resolved 2026-06-05)

A building's provenance is **set once per user in the WebID profile**, not chosen at add
time — closing PROBLEMS.md #1 / Handbuch HW5. The decisions:

- **Fixed per person, not per building.** Provenance is the stable *capacity you produced
  the data in* — an investor produces "as investor", a BSP "as BSP" (even about another's
  building) — so one profile value applies to every building you add, no per-building
  override.
- **Stored as W3C `org:role`** on an `org:Membership`, beside the existing org modelling
  (`organizationManager.ts`): `<#me> org:hasMembership <#membership> . <#membership> a
  org:Membership ; org:member <#me> ; org:organization <#org> ; org:role gran:InvestorRole`.
  The role IRI reuses `PROVENANCE_TO_IRI` (read via `IRI_TO_PROVENANCE`).
- **Read at add time.** `AddBuildingDialog` calls `getProducingRole(session)` (cached
  `loadProfileStore`) and passes it as `serializeBuildingToTurtle(…, { agent, category })`.
  The Template selector is now spreadsheet-**shape only**; set the role in the
  **Organisation** dialog (`saveProducingRole`).
- **Unset → no attribution.** With no role set, the building is written without
  `prov:qualifiedAttribution` (the parser tolerates that), plus a non-blocking nudge in the
  Add dialog. No migration — existing attributions stay valid; only the *source* of the
  value for new buildings changed.
- **Separate from the data-room role.** The profile `org:role` (provenance) and the room
  `sioc:has_function` (sharing target) are different predicates in different places, so
  `UserRole`'s three jobs are now cleanly split (template / provenance / room role).

## Graph shape varies by producer, but dispatch is data-driven

One session loads building files authored by different actors in different
vocabularies (the user's own files under `buildings/`, an investor's shared file, a
tenant's readings, a benchmark file) — structurally different graphs. The parser keys
on **predicate presence** (core + optional `investor:*` / `bench:*`), and energy
loading/rendering keys on the dataset's declared **granularity**, so the producer
category is never needed to read the data correctly.

Provenance travels with the data: `serializeBuildingToTurtle` writes the PROV
attribution into the building file on create, and a sharing recipient reads it straight
from the shared file.

## What dispatches on data shape (not role)

- **Building predicates** — rendered whenever present (`hasInvestorDetails` in
  `Building.tsx`): core always, `investor:*` / `bench:*` when the subject carries
  them. No role gate.
- **Energy load + render** — keyed on the dataset's declared `gran:granularity`
  (`isSeriesGranularity()`, `durationUtils.ts`) and on the presence of `annualData`,
  never on a role. The dataset model is owned by [`energy-redesign.md`](./energy-redesign.md).

Code: `TurtleParsingService.ts` (granularity skip-prefetch), `durationUtils.ts`,
`energyDataParser.ts`; `ExplorePage.tsx` / `Building.tsx` rendering.

## Graph shapes per role

The shapes aren't formally specified — they're whatever the imperative parsers
read/write (`buildingConfig.ts`, `buildingParser.ts`, `energyDataParser.ts`,
`userEnergyParser.ts`); there's no separate shape/validator layer. Conceptually there's
a shared building core plus per-role variants (dummy/user share one; investor and
benchmark add namespace-specific predicates), and energy is either categorical SOSA
observations (dummy/bench/investor) or a `uservoc:EnergyConsumptionReading` time series
(user).

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
- **Coordinates are the one structured exception to the flat map.** `lat` / `long`
  appear in `predicateMap` (so a *legacy* flat `geo:lat` / `geo:long` still parses), but
  are no longer written or normally read that way. The current shape is a `geo:Point`
  blank node hung off the building by `geo:location`: `<#b> geo:location [ a geo:Point ;
  geo:lat … ; geo:long … ; gran:geocodePrecision gran:Address|gran:Postcode|gran:City ]`.
  The serializer (`addGeoPoint` / `replaceGeoPoint`) skips `lat`/`long` in the generic
  field loop and emits this point instead (editing a legacy building migrates it);
  `buildingParser.ts` reads the point and **prefers it over** any flat fallback.
  `gran:geocodePrecision` records *how exact the geocode was* (street address vs. postcode
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
  core + `gran:hasEnergyConsumptionDataset`, diverging only in the referenced energy
  file's content, so the role is unrecoverable from the building file alone.
- Fetching used to be gated on role (lazy-load user, synthesize investor), decided
  before the files are in hand. It now dispatches on the dataset's declared
  `gran:granularity` (`isSeriesGranularity`), which *is* in hand from the building file,
  so the discriminator problem is moot.
- A ShEx match would be a structural guess that flips behaviour silently on sparse /
  malformed data; the declared granularity is an explicit assertion instead.

The old recommendation to "keep the source role authoritative" no longer applies: role
is now provenance only, and behaviour keys on granularity, so shapes are needed at most
to validate declared data.

## Detector vs. shapes (removed)

An earlier `roleDetection.ts` encoded the same signatures as an n3 detector
(`detectBuildingRole`, `detectEnergyShape`, `resolveRole`) for a "validate +
infer-on-missing" flow. Never wired in and now removed; the only surviving behaviour
(the load-strategy split below) is `isSeriesGranularity` in `durationUtils.ts`.

## Decouple role from shape (DONE)

> **Status (current).** Energy load, synthesis, and render dispatch on the **data's
> declared shape/granularity**, not on a role. The producer category is now
> **provenance only** (`BuildingType.provenance` / `attributedTo`):
> - Datasets declare `gran:granularity` on write (`buildingSerializer.ts`;
>   user series → `"PT15M"`).
> - Load strategy follows granularity via `isSeriesGranularity()`
>   (`durationUtils.ts`): the prefetch-skip in `TurtleParsingService.ts` keys purely
>   on the declared period (series ⇒ lazy; no granularity ⇒ non-series).
> - Inline-aggregate energy synthesis keys on **presence of `annualData`**, not
>   `role === "investor"` (so benchmark inline data is covered too).
> - `Building.tsx` renders investor/bench predicates whenever present
>   (`hasInvestorDetails`), with no role gate.
> - `ExplorePage.tsx` / `Energy.tsx` dispatch on `annualData` (annual chart) vs. a
>   declared series granularity (time-series `Energy`).
>
> Still open: naming first-class dataset-shape *types* and publishing a real vocab
> (see "Open vocab question"); these stayed out of scope.

### Historical note: how the decoupling landed

The original motivation: one "role" overloaded three independent things — building
**predicate set**, energy **graph shape** + load strategy, and **provenance** — which
broke on real data where two actors in the *same* role carry *different* shapes (e.g.
both BLG and Zufall are "user", but Zufall supplies quarter-hourly load profiles while
we otherwise model annual consumption; even one actor has buildings at different
granularities). The fix unified all energy onto **one self-describing
`gran:EnergyDataset` node that declares its own period** (`gran:granularity`, an
`xsd:duration`, is the value the loader switches on), so a single building can carry
annual *and* 15-min datasets regardless of role, and load strategy follows the period
rather than the role. That dataset model is owned by
[`energy-redesign.md`](./energy-redesign.md).

Still open (out of scope): publishing a real, dereferenceable vocab for the
dataset-shape terms (see "Open vocab question" under FAU resources below).

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
  `gran:InvestorRole`, `gran:hasBuildingArea`, `gran:hasEnergyDataset`,
  `gran:granularity`, …).
- `user-vocab.ttl#` (`USERVOC_NS`), `investor-vocab.ttl#` (`INVESTOR_NS`),
  `benchmark-vocab.ttl#` (`BENCH_NS`) — per-role predicate sets.

These are a **shared contract**: changing a prefix only matters because producers
serialize the same IRIs (`buildingSerializer.ts`) and the parser matches them
(`buildingConfig.ts`). "Removing" them = minting your own vocabulary IRIs and
re-keying both sides; it's not a file fetch to cut, it's an ontology decision. They
live under `/private/` and aren't publicly resolvable today — a real cleanup would
publish a dereferenceable vocab, independent of the app.

### B. Demo data — offered, not auto-seeded

A fresh Pod loads empty — nothing is silently seeded. Instead the UI **offers** demo
data via a banner (`useDemoSeedPrompt`); on accept, `seedDemoBuildings`
(`buildingSerializer.ts`) writes two real owned buildings (Nordostpark 84 and Lange
Gasse 20, Nürnberg) carrying energy at *different granularities* (one annual aggregate,
one PT15M series) so a new user immediately sees both shapes the app dispatches on. Pod
layout, own-building discovery, and the banner mechanics are owned by
[`data-layout.md`](./data-layout.md).

## Files

`types/types.ts` (`UserRole`, `BuildingType`, `geocodePrecision`);
`config/buildingConfig.ts` (predicate → field maps); `buildingParser.ts`;
`buildingSerializer.ts` (`addGeoPoint`, `addProvenance`, `seedDemoBuildings`);
`energyDataset.ts` (unified dataset read/write); `energyDataParser.ts`;
`userEnergyParser.ts`; `durationUtils.ts` (`isSeriesGranularity` load split);
`vocabularies.ts` (the `*_NS` prefixes above);
`TurtleParsingService.ts` (own-building listing, shared-in folding, granularity
orchestration, `useDemoSeedPrompt`); [`room.md`](./room.md) (membership role).
