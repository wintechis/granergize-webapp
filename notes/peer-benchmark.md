# Peer energy benchmark (BSP round-trip)

## Purpose

A building owner compares their energy figures against a *real* peer benchmark — an
industry average a third party aggregates across many owners' buildings — instead of
a self-referential local mean. (This is a domain benchmark of energy consumption, not
a performance benchmark of the software.) The energy view distinguishes three
comparisons: a **portfolio average** — the honest mean over the user's own
buildings — an **operator average** (Betreiber-Durchschnitt) — the mean over
buildings of one operator — and a **benchmark** that comes from outside the user's
own portfolio. See *Three comparison cases* below for how they relate.
The benchmark is supplied by a **Benchmark Service Provider (BSP)**: not a server,
but another Solid user (a third role alongside Alice and Bob) running the same app
in a benchmark-provider capacity. Owners share their energy with the BSP; the BSP
aggregates across everyone who shared and returns the averages; each owner sees the
returned figures alongside their own.

## Design

The benchmark is an aggregated-view snapshot the BSP computes over the buildings
shared to it and shares back. This reuses the existing aggregation and sharing
machinery rather than introducing a parallel subsystem, and it inherits exactly the
privacy property a benchmark needs: a snapshot carries only the computed values and
a building count, never the list of contributing buildings. The view *definition*
(which holds the building IRIs) stays private to the BSP; only the *snapshot*
travels.

The round-trip has four movements, each resting on existing machinery.

An owner shares a building — including its energy datasets — with the BSP's WebID.
This is the ordinary building-share path, with energy included and optionally scoped
to specific years; the BSP is simply a recipient WebID.

The BSP computes the benchmark. The aggregation engine averages a chosen metric
across a set of buildings; the BSP metrics are annual electricity, heat, water and
wastewater consumption. The benchmark's building list is populated from the roster
of buildings shared *to* the BSP, so the BSP's create-view flow sources its
candidates from the shared-with-me fold rather than from owned buildings (received
buildings carry the *sharer's* provenance, not a benchmark-provider one). The result
is persisted as a snapshot, additionally typed as a benchmark result that records
the computing agent and the period covered.

The BSP shares the snapshot back to each contributing owner. The view-sharing path —
grant read access, post an inbox event, append to the outgoing log under the view
kind — does this, fanned out to every contributor in one step.

The owner consumes the returned benchmark. The energy view prefers a received BSP
benchmark for the comparison figure when one is available for the metric, then the
operator average when same-operator figures exist, and otherwise falls back to the
portfolio mean. The annual energy table shows the building's own (Ist) figure, the
portfolio average, the operator average, and a benchmark column that stays blank
until a benchmark has been received; only the four annual-consumption metrics can
carry a benchmark, so the other rows leave the benchmark cell empty. The computing
BSP is surfaced as an agent reference, routed through the in-app contact detail
view.

## Three comparison cases

The three comparison figures are one idea — "how does my building sit against a
peer mean?" — varied by **who already holds the peer data**, which dictates how
much sharing machinery the figure needs:

- **Portfolio average** — the peers are the user's *own* buildings. The data is
  already on the user's Pod; no second agent, no sharing. Computed in the bulk
  energy fold.
- **Operator average (Betreiber-Durchschnitt)** — the peers are the buildings of
  one *operator*. The operator, by operating them, already has the numbers; no
  inbound data acquisition is needed before aggregating. The app today covers the
  single-Pod form of this: the bulk energy fold groups the user's own buildings by
  their `operatedBy` agent link (each contributing its latest actual annual year)
  and surfaces the per-operator mean in the annual energy views. The full
  cross-owner form — the operator computes over the buildings it operates and
  shares the result to each building's owner — is structurally the BSP round-trip
  below with its first movement already satisfied.
- **BSP benchmark** — the peers span *other owners'* portfolios, and the
  aggregating agent starts with nothing: participants must first share their
  buildings (with energy) *to* the BSP before it can aggregate and share the
  snapshot back. This is the full four-movement round-trip this note describes.

So the operator benchmark is a variant of the peer benchmark distinguished by data
acquisition — the operator holds the numbers already, the BSP has to collect them.
Both cross-agent forms return their result the same way (an aggregated-view
snapshot shared by WebID, see [`aggregated-views.md`](./aggregated-views.md)); the
energy view's preference order (benchmark, then operator average, then portfolio
mean) ranks them by how far outside the user's own data the peer set reaches.

## Vocabulary

A returned snapshot is self-describing as a benchmark rather than a generic view: the
benchmark vocabulary carries a benchmark-result class (a specialisation of the
aggregated-view snapshot), a predicate naming the computing agent, and a predicate
for the metric period. These are owned terms, so the versioned vocabulary and its
conformance test move together with the code, keeping the published vocabulary and
the app in step.

## Verification

The round-trip is verified at the integration tier (the real data-layer functions
over three client-credential sessions: two owners share energy, the BSP computes and
shares back, an owner reads the returned averages) and end-to-end in the browser tier
as its own benchmarking spec (two owners contribute, the BSP's picker offers both,
the share-back fans out, and the owner sees the benchmark column). The
shared-with-me→building-list helper and the prefer-benchmark-over-local selector
each carry offline-fixture unit tests.

## Boundaries

The benchmark exposes only aggregate values and a contributor count, so a recipient
cannot reconstruct another owner's building from it; this is the same
definition/snapshot split the aggregation feature enforces, and it is preserved.
Replay of the sharing log stays same-Pod, as elsewhere. The regional/district
energy-mix breakdown by generation source, its administrative data files and backend,
and the query-service surface are separate from benchmarking and out of scope here.
