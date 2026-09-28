# notes/

Design notes for the Granergize-App — **matter-of-fact about the current code**
(present behaviour + rationale). Two kinds of forward-looking material are
deliberately **not** here, each kept in its own **git-ignored** sibling directory:
speculative, not-adopted design sketches in `explore/`, and concrete *plans* (how
the code might change) in `plans/`. So the notes and CLAUDE.md stay about what the
code does now. **Nothing here links into `explore/` or `plans/`** — the dependency
runs one way: those may link back into these notes, never the reverse.

## The data-shape pipeline

The spine these notes hang off: app data lives in **three layers**, each
translating to its neighbour in **both directions** —

```
  RDF on the Pod   ⇄   typed app objects    ⇄   rendered UI
  (read / write)       Building, … —        (display / edit)
                       nouns + their verbs
                       (intents / actions)
```

**Reads** flow rightward — storage is fetched, parsed into objects, displayed;
**writes** flow back — an edit in the UI invokes a verb that serialises the object
and PUTs it to storage. So the middle layer is not data alone: each typed object is
a **noun** plus the **verbs** on it (intents / actions — present-state, the query &
mutation hooks), and those verbs *are* the write path.

The notes split along the pipeline: [architecture.md](./architecture.md) names it;
[storage-layout.md](./storage-layout.md) + [data-schema.md](./data-schema.md) own
the RDF layer (read and write); [data-deref.md](./data-deref.md) traces the
storage→object read translation; [object-model.md](./object-model.md) inventories
the typed objects **and** their verbs; [queries-mutations.md](./queries-mutations.md)
owns the verbs (the query/mutation taxonomy — the read/write split);
[building-detail.md](./building-detail.md) shows the object→UI projection and the
actions on it.

Orthogonal to this pipeline runs the **provenance** lens — the concentric
`mine`/`shared`/`open` rings (where data comes from and who controls it), the
data-architecture entry point: [data-architecture.md](./data-architecture.md).

## Present-state notes

- [architecture.md](./architecture.md) — how `src/` is sliced into layers and which way imports flow; and the storage→typed-objects→UI data-shape pipeline.
- [queries-mutations.md](./queries-mutations.md) — the query/mutation (CQS) taxonomy, the two storage models, and the PUT-vs-POST rationale.
- [storage-layout.md](./storage-layout.md) — the storage layout: the on-Pod `granergize/` directory tree and the building load flow; frames the *schema* (shared vocabulary) at the centre with the app's *profiles* dancing around it, and defines the *resource profile* (storage layout · storage model · addressing).
- [data-schema.md](./data-schema.md) — building provenance, import/export formats, and dispatch on data shape rather than role.
- [object-model.md](./object-model.md) — inventory of the typed middle layer: which objects exist, how they're organised (object shape follows storage model), and the verbs on them.
- [intents.md](./intents.md) — the intent layer as the object-model interface: the read/write core catalogue + one `query`/`invoke` dispatch, RDF-typed params + EntityQuery, and the front doors (affordance menus, the command palette form/JSON launcher, and the natural-language → intent translator).
- [competency.md](./competency.md) — the competency questions (queries a user wants answered → the read surface) and competency tasks (things a user wants to do → the do surface), their CQ↔query / CT↔mutation mapping, and how they anchor the e2e specs and the Praxishandbuch task catalog.
- [energy-model.md](./energy-model.md) — the unified `cons:EnergyDataset`, one per (building, year, granularity).
- [observation-cube.md](./observation-cube.md) — the one model behind the numbers: a `sosa:Observation` *is* a cube cell (feature × property × time → measure), SOSA and external `qb:` as two serializations of a cell converged at the app series, aggregation as a rollup, and every finder/number a projection/coordinate of the one cube.
- [detail-vs-statistics.md](./detail-vs-statistics.md) — the decomposability axis: detailed (owned/computed, drillable) data vs. non-decomposable statistics (fixed official grain, members dropped), why the relationship runs one way (roll detail up to benchmark against a statistic, never drill a statistic down), and the AGS join with concrete building↔Gemeinde PV examples.
- [data-deref.md](./data-deref.md) — how a WebID becomes in-memory objects: what's fetched, in what order, joined in memory.
- [query-layer.md](./query-layer.md) — the resource-oriented cache: IRI-keyed resource entries + containers-as-queries, the domain shapes derived at the edge by selectors, and how it's kept fresh against Pod writes (the per-resource invalidation that closes the query-key coverage hazard).
- [sharing.md](./sharing.md) — bilateral WebID-to-WebID building/aggregation sharing over append-only event logs.
- [room.md](./room.md) — data rooms: event-sourced membership + roles, used as a sharing directory.
- [aggregations.md](./aggregations.md) — saved aggregations: a private definition plus a shareable computed snapshot, and the peer-benchmark (BSP) round-trip back to contributing owners.
- [attachments.md](./attachments.md) — arbitrary files attached to a building (the energy certificate is one of them).
- [building-detail.md](./building-detail.md) — what hangs off a building IRI and how the detail page projects it.
- [weather.md](./weather.md) — the external, live, read-only DWD weather layer (nearest-station proximity join), outside the Pod data path.
- [data-architecture.md](./data-architecture.md) — the **data-architecture entry point**: the concentric `mine`/`shared`/`open` provenance model (where data comes from and who controls it), routing to the per-ring deep notes; the vocabulary story (one authored vocabulary for the inner rings, per-source foreign vocabularies bridged by standards for the open ring, the TS object model as the app-side interlingua); plus the open ring in full — its sources, in-app read-only details, and the precise discovery-query joins (`/point` · `/bbox` · constructed AGS IRIs, with numbers).
- [ui-state.md](./ui-state.md) — which UI state is navigational (encoded in the URI — the BrowserRouter path + query params) vs. ephemeral.
- [ux-overview.md](./ux-overview.md) — a coarse map of the UX surfaces (tabs · detail pages · dialogs) and the transitions between them, as a Graphviz/Mermaid overview above statechart detail.
- [i18n.md](./i18n.md) — the de/en/fr paths (build-time vocab labels vs. the in-app chrome catalog), the rolled-in-house `Intl`-based message layer, and why no i18n library.
