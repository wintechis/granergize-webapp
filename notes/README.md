# notes/

Design notes for the Granergize-App — **matter-of-fact about the current code**
(present behaviour + rationale). Speculative, not-adopted thought experiments are
the `explore-*` files. Forward-looking *plans* (how the code might change) are
deliberately **not** here: they live in the separate, git-ignored `plans/`
directory, so the notes and CLAUDE.md stay about what the code does now, not what
it might do. Nothing here links into `plans/`.

## Present-state notes

- [architecture.md](./architecture.md) — how `src/` is sliced into layers and which way imports flow.
- [queries-mutations.md](./queries-mutations.md) — the query/mutation (CQS) taxonomy, the two storage models, and the PUT-vs-POST rationale.
- [storage-layout.md](./storage-layout.md) — the storage layout: the on-Pod `granergize/` directory tree and the building load flow; frames the *schema* (shared vocabulary) at the centre with the app's *profiles* dancing around it, and defines the *resource profile* (storage layout · storage model · addressing).
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
- [explore-resource-profile.md](./explore-resource-profile.md) — reifying the *resource profile* (storage facet) as declarative data that generates storage layout, paths and routes; the storage-side sibling of the action profile (intent registry) and presentation profile, all dancing around the schema.
- [explore-presentation-profile.md](./explore-presentation-profile.md) — rendering an instance from its class via a *presentation profile* (range-driven generic rows + rich-widget overrides); the third profile, with the resource and action profiles, around the schema.
