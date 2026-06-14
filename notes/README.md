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
  (read / write)       BuildingType, … —        (display / edit)
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
[building-pane.md](./building-pane.md) shows the object→UI projection and its row
actions.

## Present-state notes

- [architecture.md](./architecture.md) — how `src/` is sliced into layers and which way imports flow; and the storage→typed-objects→UI data-shape pipeline.
- [queries-mutations.md](./queries-mutations.md) — the query/mutation (CQS) taxonomy, the two storage models, and the PUT-vs-POST rationale.
- [storage-layout.md](./storage-layout.md) — the storage layout: the on-Pod `granergize/` directory tree and the building load flow; frames the *schema* (shared vocabulary) at the centre with the app's *profiles* dancing around it, and defines the *resource profile* (storage layout · storage model · addressing).
- [data-schema.md](./data-schema.md) — building provenance, import/export formats, and dispatch on data shape rather than role.
- [object-model.md](./object-model.md) — inventory of the typed middle layer: which objects exist, how they're organised (object shape follows storage model), and the verbs on them.
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
