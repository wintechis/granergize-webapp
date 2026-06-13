# notes/

Design notes for the Granergize-App. The unprefixed files describe **present state**
(matter-of-fact current behaviour + rationale); `plan-*` and `spec-*` files are
forward-looking design.

## Present-state notes

- [architecture.md](./architecture.md) — how `src/` is sliced into layers and which way imports flow.
- [queries-mutations.md](./queries-mutations.md) — the query/mutation (CQS) taxonomy, the two storage models, and the PUT-vs-POST rationale.
- [data-layout.md](./data-layout.md) — the on-Pod `granergize/` directory tree and the building load flow.
- [data-schema.md](./data-schema.md) — building provenance, import/export formats, and dispatch on data shape rather than role.
- [energy-model.md](./energy-model.md) — the unified `cons:EnergyDataset`, one per (building, year, granularity).
- [data-deref.md](./data-deref.md) — how a WebID becomes in-memory objects: what's fetched, in what order, joined in memory.
- [app-pod-state-sync.md](./app-pod-state-sync.md) — keeping React-Query caches fresh against Pod writes (the query-key coverage hazard).
- [sharing.md](./sharing.md) — bilateral WebID-to-WebID building/view sharing over append-only event logs.
- [room.md](./room.md) — data rooms: event-sourced membership + roles, used as a sharing directory.
- [aggregated-views.md](./aggregated-views.md) — saved aggregations: a private definition plus a shareable computed snapshot.
- [peer-benchmark.md](./peer-benchmark.md) — the benchmark-snapshot round-trip back to contributing owners.
- [attachments.md](./attachments.md) — arbitrary files attached to a building (the energy certificate is one of them).
- [building-pane.md](./building-pane.md) — what hangs off a building IRI and how the detail pane projects it.
- [ui-state.md](./ui-state.md) — which UI state is navigational (encoded in the URI hash) vs. ephemeral.

## Explorations

- [explore-client-boundary.md](./explore-client-boundary.md) — two not-adopted thought experiments (server-side intent layer; getting away from the SPA) and the shared credentials-in-the-browser constraint.
- [explore-intent-registry.md](./explore-intent-registry.md) — an explicit, enumerable app-intent catalog on top of the mutation hooks.

## Plans & specs

- [plan-iri-identifiers.md](./plan-iri-identifiers.md) — using resource IRIs as building identity (since merged).
- [plan-room-rules.md](./plan-room-rules.md) — replacing data-room roles with rules.
- [plan-mastr-import.md](./plan-mastr-import.md) — importing logistics buildings from open MaStR/OSM/INSPIRE sources.
- [plan-annual-energy-unification.md](./plan-annual-energy-unification.md) — one annual-energy view and energy reads through the data layer.
- [plan-dialog-write-unification.md](./plan-dialog-write-unification.md) — routing every dialog write through a mutation hook.
- [plan-sharing-fold-dedup.md](./plan-sharing-fold-dedup.md) — folding each sharing log once per load.
- [plan-bench-pair-trio.md](./plan-bench-pair-trio.md) — pair & trio benchmark UI.
- [plan-handbuch-videos.md](./plan-handbuch-videos.md) — videos for the three Praxishandbuch use cases.
- [spec-logistik-dataset-nuernberg.md](./spec-logistik-dataset-nuernberg.md) — the Nuremberg logistics-building dataset spec.
