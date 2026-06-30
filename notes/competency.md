# Competency questions and tasks

Two evaluation lenses keep the design honest — one borrowed from ontology engineering, one
its app-level twin. Held as a running checklist, they are what reveals that a vocabulary
term, a finder facet, or an intent is missing — rather than discovering it only when a screen
can't answer a real question or finish a real job. Companion to
[`queries-mutations.md`](./queries-mutations.md) (the CQS split these mirror),
[`intents.md`](./intents.md) (the verb catalogue a task invokes),
[`object-model.md`](./object-model.md) (the objects a question reads) and
[`observation-cube.md`](./observation-cube.md) (the cube most questions slice).

## The two lenses

- **Competency questions (CQs)** — the *queries a user wants answered*. In ontology
  engineering a CQ validates the schema/vocab (can the terms even express the question?);
  here it additionally validates the **read surface** — the finders, the cube, comparison. A
  CQ the model can't answer is a missing term, a missing facet, or a missing slice.
- **Competency tasks (CTs)** — the app-level addition: the *things a user wants to
  accomplish*. A CT validates the **do surface** — that the navigation loop reaches the right
  node and the intent catalogue offers the right verb there. A CT that can't be completed is
  a missing intent, a dead end in the loop, or an unreachable collection.

They compose: a task is usually *navigate (reach the node) → answer some CQs on the way →
invoke an action*.

## The mapping — CQ ↔ query, CT ↔ mutation

CQ/CT is the CQS line ([`queries-mutations.md`](./queries-mutations.md)) drawn at the
*user-goal* altitude rather than the *operation* one. A **CQ is answered by composing the
query palette** (reads only — a finder *is* a composition of queries); a **CT is accomplished
by navigation (more queries) plus a mutation** — reach the target, then commit the change.
So a gap is concrete: a CQ that needs a query the catalogue lacks, or a CT that needs a
mutation it lacks. The verb catalogue both resolve against is [`intents.md`](./intents.md) —
CQs compose its read cores, CTs invoke its write cores with their supporting reads.

## The questions

Each names the design facet it exercises:

- *What was building X's electricity consumption in 2024?* — one instance, one metric/period
  (detail + temporal finder).
- *Which of my buildings have PV and a hall area over 5 000 m²?* — a facet over the in-hand
  collection (facets-from-schema).
- *Which buildings in this map area are visible to me but not mine?* — the spatial finder over
  the reachable set (partiality: "visible to me", never "all that exist").
- *How does X's 2024 consumption compare to the peer / regional average?* — a comparison slice
  (vary space, fix time + metric) against an internal or external rollup.
- *How did X's consumption track heating-degree-days last winter?* — a cross-layer question
  (energy × weather) on the shared time axis.
- *Who produced this figure, and was it measured or estimated?* — the provenance widget.
- *What is the 2024 total of the buildings shared into my benchmark, by NUTS-3 region?* — a
  rollup over space × time ([`observation-cube.md`](./observation-cube.md)).

## The tasks

Each names the loop / intent it exercises:

- *Add a building and enter its 2024 energy.* — create / import + write-energy-year.
- *Share building X — energy included, 2022–2024 only — with my investor.* — the scoped share
  intent.
- *Build a benchmark from the buildings shared with me and share it back.* — aggregate +
  share-snapshot ([`aggregations.md`](./aggregations.md) §Peer benchmark).
- *Find buildings near here I don't own, and ask their owners for data.* — federated discovery
  (the open tier, [`data-architecture.md`](./data-architecture.md)) + the data-request arrow.
- *Compare two buildings' energy over the same period.* — collection → two details → a
  fixed-period slice.
- *Pin this winter's weather beside X so my saved view reproduces.* — materialise an external
  layer ([`data-architecture.md`](./data-architecture.md)).
- *Join a data room and self-assign a role.* — room membership ([`room.md`](./room.md)).

## How they anchor the tests

Each e2e spec is named for the CQ/CT it embodies, so a test encodes *what the user wants to
find out or do*, not just a widget's mechanics. The cube CQs are anchored by the
`cube-*.spec.ts` specs (`cube-time-cut`, `cube-space-cut`, `cube-metric-selector`,
`cube-calendar-weather`, the trend lens). The test foundation
([`test/README.md`](../test/README.md)) already keys its catalog on the Praxishandbuch (≈ the
**CT** side — the `test/headless/tasks/` modules and the e2e catalog specs); the **CQ**
("find out") half, supplied by the data-browsing views, is the under-tested one. A CQ/CT with
no passing spec is a visible coverage gap.

The split mirrors the two surfaces: **CQs test the finders + comparison (and, behind them, the
vocab); CTs test the navigation loop + the action profile.**
