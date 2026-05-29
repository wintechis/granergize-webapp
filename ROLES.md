# GRANERGIZE Roles & Graph Shapes

What a "role" means in the app, why it is attached **per data source**, the graph
shape each role implies, and how ShEx fits in. The shapes are drafted in
[`roles.shex`](./roles.shex); a detector that mirrors them lives in
[`roleDetection.ts`](./src/services/utils/roleDetection.ts).

> Data-room *membership* roles are a separate, agent-level use of the same enum —
> see [`ROOM.md`](./ROOM.md). This document is about the *data-shape* role used by
> the parsing pipeline.

## Two things are called "role"

The enum `UserRole = "dummy" | "investor" | "user" | "benchmark_service_provider"`
(`types/types.ts`) is reused for two independent purposes:

| | **Source role** (this doc) | **Membership role** ([`ROOM.md`](./ROOM.md)) |
|---|---|---|
| Attached to | a data source **file** | an **agent** (WebID) |
| Stored as | `<src> gran:dataSourceRole gran:InvestorRole` in `dataSources.ttl` | `as:Update` with `sioc:has_function → gran:InvestorRole` in a room log |
| Read by | `TurtleParsingService.ts` (`getSourceRegistry`) | `dataRoom.ts` (`getMyRole`, `getMembersByRole`) |
| Means | "this file is written in the investor shape" | "this person acts as an investor here" |

Both use the same IRI mapping:

| `UserRole` | role IRI | vocabulary |
|---|---|---|
| `dummy` | `gran:DummyRole` | `gran:` — `vocab.ttl#` |
| `investor` | `gran:InvestorRole` | `investor-vocab.ttl#` |
| `user` | `gran:UserRoleInstance` | `user-vocab.ttl#` |
| `benchmark_service_provider` | `gran:BenchmarkRole` | `benchmark-vocab.ttl#` |

## Why the source role is per data source

One logged-in user aggregates buildings from many heterogeneous Pod files, each
authored by a different actor in a different vocabulary. A single session's
`dataSources.ttl` can list your own `buildings.ttl` (`DummyRole`), an investor's
shared file (`InvestorRole`), a tenant's readings (`UserRoleInstance`), and a
benchmark provider's file (`BenchmarkRole`) at once.

These files are structurally different graphs — different predicates, different
ways of attaching energy, different blank-node structures. So the role is really
a **per-file schema selector and provenance tag**: it must be per source because
the normal case is one viewer rendering investor, tenant, and benchmark buildings
on the same map, each parsed by its own origin schema.

The role travels with the data:

- **Sharing** — the producer's role is written into the shared registry
  (`share.ts`) and copied into the recipient's `dataSources.ttl` (`inbox.ts`,
  `sharingManager.ts`).
- **Own imports** — `buildingSerializer.ts` (`addBuildingDataSource`) writes it.
- **Bootstrap / fallback** — a fresh registry seeds `buildings.ttl` as
  `DummyRole`; any unannotated source silently defaults to `dummy`
  (`TurtleParsingService.ts:283`). **That silent default is the real weak spot —
  see below.**

## What the role changes

`sourceRole` gates fetch strategy and rendering, not just parsing:

| Concern | dummy | benchmark | investor | user |
|---|---|---|---|---|
| Building predicates | core | core + `bench:*` | core + `investor:*` | core |
| Energy location | separate file(s) | separate file(s) | **inline** observations | separate **daily** file(s) |
| Energy graph | `sosa:Observation` | `sosa:Observation` | `sosa:Observation` via `hasFeatureOfInterest` | `uservoc:EnergyConsumptionReading` |
| When energy loads | bulk prefetch | bulk prefetch | synthesized from inline obs | **lazy, on click** |
| Parsed into | 7 `EnergyType` categories | 7 categories | `InvestorAnnualData` → `energyNeed` | `timeSeries.electricityConsumption` |

Code: `TurtleParsingService.ts:465` (skip user prefetch), `:568` (synthesize
investor energy); `energyDataParser.ts` (categorical vs. time series);
`Map.tsx` / `Building.tsx` (per-role rendering).

## The shapes (`roles.shex`)

`roles.shex` drafts one shape per role, reverse-engineered from `buildingConfig.ts`,
`buildingParser.ts`, `energyDataParser.ts`, and `userEnergyParser.ts`:

- `<BuildingCore>` — predicates shared by all roles.
- `<DummyBuilding>`, `<UserBuilding>`, `<BenchmarkBuilding>`, `<InvestorBuilding>`
  — the per-role building-file shapes.
- `<CategoricalObservation>` (dummy/bench), `<UserReading>` (user),
  `<InvestorObservation>` (investor inline) — the energy-graph shapes.
- `<OperatingCosts>`, `<Certification>`, `<EnergyDatasetRef>`, `<TimeInterval>`,
  `<SimpleResult>` — supporting structures.

The shapes are the **spec**; the imperative parsers remain the source of truth.

## Can ShEx determine the role from a file?

Only partly, and not as the primary discriminator:

1. **Shapes overlap.** All roles share `<BuildingCore>`; discriminators are a
   small predicate subset. Open shapes match several roles; closed shapes reject
   the routinely-partial real data.
2. **User and dummy are indistinguishable at the building-file level.** Both are
   core + `gran:hasEnergyConsumptionDataset`; they diverge only in the *content
   of the referenced energy file* (`uservoc:EnergyConsumptionReading` vs.
   `sosa:Observation`). The role cannot be recovered from the building file alone.
3. **The role gates fetching, not just parsing.** "Lazy-load user energy" /
   "synthesize investor energy" must be decided *before* the relevant files are in
   hand; a post-fetch conformance check is too late.
4. **Declared ≠ inferred.** `gran:dataSourceRole` is the producer *asserting*
   provenance; a ShEx match is a structural guess that flips behavior silently on
   sparse or malformed data. In a decentralized setting the declared signal is the
   more trustworthy one.

### Recommended use

- Keep `gran:dataSourceRole` **authoritative**.
- Use shapes to **validate**: confirm a source that claims a role conforms to it;
  flag malformed shared data at ingest instead of mis-rendering it.
- Use shapes to **infer only when the annotation is missing**, replacing the blind
  `?? "dummy"` fallback (`TurtleParsingService.ts:283`) with a real best match.
- Treat the shapes as the **contract** producers serialize against
  (`buildingSerializer.ts`) and the sharing handshake checks.

### Caveat: "role" is overloaded

A source role conflates (a) graph shape, (b) energy-loading strategy, and
(c) actor identity — plus the separate per-agent data-room `sioc:Role`. ShEx
captures only (a); inferring (b)/(c) from it is sound **only while shape ⟺ role
stays bijective**. Make that assumption explicit rather than discovering it breaks.

## Tooling: shapes vs. detector

The ShEx JS engines (`npm:shex`, `@shexjs/*`) do not run under Deno, so we can't
validate `roles.shex` directly in the test harness. Literal ShEx conformance has
to run where shex.js works (browser/Vite, or a Node CI step).

In the meantime [`roleDetection.ts`](./src/services/utils/roleDetection.ts) is a
small n3-based detector that encodes the same signatures the shapes formalize:

- `detectBuildingRole(store)` — investor/benchmark are certain; dummy/user return
  `{ role: "dummy", certain: false }`.
- `detectEnergyShape(store)` — `user-readings` vs `categorical-observations`.
- `resolveRole(buildingStore, energyStore?)` — the decision logic above, end to end.

It is tested offline against per-role Turtle fixtures
([`roleDetection.test.ts`](./src/services/utils/roleDetection.test.ts),
`deno task test`), including the user-vs-dummy ambiguity and a guard that keeps
the detector and `roles.shex` from drifting. The detector is **not yet wired into
the app** — the intended first use is the `:283` fallback.

## Files

| File | Role |
|---|---|
| `roles.shex` | the role shapes (spec) |
| `src/services/utils/roleDetection.ts` | n3 detector mirroring the shapes |
| `src/services/utils/roleDetection.test.ts` | offline-fixture tests |
| `types/types.ts` | `UserRole` enum, `BuildingType` fields |
| `src/services/utils/config/buildingConfig.ts` | predicate → field maps |
| `src/services/utils/buildingParser.ts` | building + blank-node parsing |
| `src/services/utils/energyDataParser.ts` | energy graph shapes |
| `src/services/utils/userEnergyParser.ts` | user time-series parsing |
| `src/services/TurtleParsingService.ts` | registry read, per-role orchestration |
| `ROOM.md` | the *other* (membership) role concept |
