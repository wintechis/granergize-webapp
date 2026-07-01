# Detailed data vs. statistics — decomposability and the benchmark join

A number reaches the app in one of two conditions, and the difference is not the
vocabulary (SOSA vs. `qb:`) or the source ring (`mine`/`shared`/`open`) but
**decomposability**: can you drill the figure down to the members that make it up?

detailed data (decomposable)
: a cell the app **owns or can compute**, still holding — or able to re-derive — its
  constituents. A building's measured energy (`cons:EnergyDataset` SOSA readings),
  its rooftop-PV *potential* computed from LoD2 roof geometry (`rooftopPv.ts` →
  `installableKwp`/`annualKwh`), its installed PV nameplate on the `<#pv>` system node
  (`systems[kind="pv"].capacityKW`). These are drillable: you can split, refine, or
  recompute them at a finer grain because the inputs are present.

statistic (non-decomposable)
: a cell that **arrives already rolled up to an official grain, with its members
  discarded**. Regionalstatistik `qb:Observation`s at Land/Kreis grain; the
  Energie-Atlas Bayern per-Gemeinde `AreaPotential` (`standortEnergieprofil.ts`). The
  producer summed the addends and threw them away, so the app consumes the cell as-is
  — it cannot drill down, re-slice, or refine it.

This is the same shape as our **own** privacy-flattened aggregation *snapshot* (drop
the members, keep the aggregate + `n`) — reached by a different motive (official grain
vs. k-anonymity), identical consequence. Decomposability is orthogonal to
serialization: a statistic is non-decomposable whether it is served as SOSA or `qb:`,
and both converge at the app-level series either way (see
[observation-cube.md](./observation-cube.md)).

## The relationship runs one way

You **cannot decompose a statistic downward** — the Gemeinde total will not divide
into its buildings, because the buildings were dropped. But you **can roll detail
upward and set it beside the statistic** as a benchmark / denominator. The statistic
then plays exactly the role a received peer benchmark plays beside our own
aggregations ([aggregations.md](./aggregations.md)): a fixed context, not a thing you
refine. This is the granularity-lens view of "a benchmark is a cell one level up"
([observation-cube.md](./observation-cube.md) §Aggregation is a cube operation).

The join is spatial, by **AGS**. A building carries its Gemeinde as an 8-digit AGS
(`regionAgs`, the `dcterms:spatial` LAU `skos:Concept`); the Gemeinde statistic is
keyed by the same AGS. Same grain, clean join — the building's *own* cell and the
*containing region's* statistic meet on the place hierarchy
([data-architecture.md](./data-architecture.md)).

## Concrete: a building against its Gemeinde's PV figures

The Energie-Atlas serves, per Gemeinde (8-digit AGS), among others:

- `pvPotentialCapacityMWp` — total installable rooftop-PV capacity of the Gemeinde;
- `installedCapacityMWp` — already installed;
- `remainingPotentialMWp` and `developmentDegreePct` — the headroom and the
  installed÷potential ratio, **pre-computed region-side**;
- `pvPotentialYieldMWh` — the potential annual yield;
- the local renewable-electricity mix (`eeSharePvPct`, `eeShareWindPct`, …) and
  `renewableElectricitySharePct`.

Each has a **detailed, building-level counterpart the app owns or computes**:

- Gemeinde `pvPotentialCapacityMWp` ↔ the building's `installableKwp`
  (`rooftopPv.computePotential`, or the cached open-tier `openKwp`);
- Gemeinde `installedCapacityMWp` ↔ the building's installed `systems[kind="pv"].capacityKW`;
- Gemeinde `pvPotentialYieldMWh` ↔ the building's computed `annualKwh` (or its
  *measured* generation, once metered);
- the Gemeinde mix ↔ this building's own generation mix.

So the comparisons that fall out are benchmarks, not decompositions (mind the
MWp↔kWp factor of 1000):

- **Realization.** building `capacityKW ÷ installableKwp` vs. the Gemeinde's own
  `developmentDegreePct` — "this roof has realized 0 of its ~40 kWp; the Gemeinde
  overall sits at 35 %." The statistic even ships its own realization ratio, so the
  region-side benchmark is ready-made.
- **Headroom share.** the building's `installableKwp` as a fraction of the Gemeinde's
  `remainingPotentialMWp` — turns an abstract MWp into "your roof is a fraction of
  what's left here."
- **Mix context.** `eeSharePvPct` says how PV-saturated the local mix already is —
  whether more rooftop PV is additive or redundant in this Gemeinde.

The same pattern generalises to the other statistics: a building's measured
consumption benchmarked against a regionalstatistik per-capita/per-area cell for its
Kreis, joined by the 5-digit AGS.

## Present state

The app fetches and renders the Gemeinde `AreaProfile` today (the
Standort-Energieprofil panel, `standortEnergieprofil.ts`) and the building's own
detail separately. The **composition** — placing the building's own installed/potential
PV beside the containing Gemeinde's, as a realization/headroom benchmark — is
supported by the model (the AGS join and both levels' data already exist) but is **not
currently surfaced**: the two sit on the page without being related. Regionalstatistik
and Energie-Atlas metrics reach the per-building surface through
`useRegionalContext(building)` at Land/Kreis grain; a Gemeinde (8-digit) grain is the
missing rung for the PV comparison.
