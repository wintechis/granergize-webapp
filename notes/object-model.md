# Object model — the typed middle layer

The inventory of the **middle stage** of the data-shape pipeline
([`architecture.md`](./architecture.md) §The data-shape pipeline): the typed JS
objects the parsers project the merged RDF graph into, after which components see
no RDF. Where [`data-schema.md`](./data-schema.md) details the *building*
object↔RDF mapping (the four artifacts that must agree, the predicate→field
table), this note is the breadth view — *which* objects exist across the whole app
and how they are organised. The per-resource graph shapes are owned by the storage
notes ([`storage-layout.md`](./storage-layout.md), [`energy-model.md`](./energy-model.md),
[`sharing.md`](./sharing.md), [`room.md`](./room.md), [`aggregated-views.md`](./aggregated-views.md)).

The objects are plain data — `interface`/`type`, no methods; behaviour lives in the
services that produce and consume them, and the verbs on them are a separate axis
(§The verbs). None is a class.

## Where objects live — three tiers

The object layer mirrors the source-layer/import rule of
[`architecture.md`](./architecture.md): cross-cutting types in the leaf, domain
types beside the domain, composites one layer up.

1. **Central domain types** (`src/types.ts`, the leaf — imports nothing, imported
   by everything). The entities a screen renders, plus their nested sub-shapes:
   - `BuildingType` — the building, a flat bag of optional master-data fields
     (the deep dive is [`data-schema.md`](./data-schema.md)). Nests `AnnualData`,
     `InvestorOperatingCosts`, `InvestorCertification`, `AttachmentRef[]`
     ([`attachments.md`](./attachments.md)), and `EnergyDatasetRef[]` (the
     self-describing links to its energy resources).
   - `EnergyType` — the dashboard's energy object: per-building figures bucketed
     into the seven `EnergyCategoryKey` groups (`energyNeed`, `energyGeneration`, …).
     Within a group the figures are keyed by the **canonical** `EnergyMetricKey`
     (`electricityConsumption`, … — the same key space as the `cons:*` IRIs and the
     view snapshots); display labels are derived at render (`ANNUAL_METRICS`), not
     baked in. So the only residual reshaping vs the stored data is the category
     bucketing — it is otherwise a composite over several `EnergyDataset` resources
     (each building's latest actual year), not a mirror of one.
   - `WeatherType`, `Scenario` (`actual`|`planned`).
   - The aggregated-view trio: `AggregatedViewDefinition`,
     `AggregatedViewSnapshot`, `SharedAggregatedView` (+ `AggregationType`).
   - `UserRole` — the data-room membership role, and nothing else
     ([`data-schema.md`](./data-schema.md) §`UserRole`).

2. **Per-domain types** — each service folder owns the object form of the resource
   it parses:
   - energy (`rdf/energyDataset.ts`) — `EnergyDataset`, `AnnualMetrics`,
     `EnergyMetricKey` (the canonical metric key space).
   - agents (`services/agents/`) — `ResolvedAgent`, `ResolvedOrg`, `Appearance`.
   - interop/sharing (`services/interop/`) — `SharingEvent`, `ActiveGrant`,
     `SharingKind`, `SharedBuildingEntry`, `ReceivedView`, `GrantTarget`,
     `DataRoomMember`.
   - organization — `Organization`; contacts — `Contact`; prefs — `Preferences`.
   - aggregation — `PickedBenchmark`, `Contributors`.

3. **Composite / selector shapes** — assembled one layer up in the data-access
   hooks (`src/hooks/queries.ts`), not parsed from any single resource:
   - `SolidData` — the dashboard bundle (`buildings` + `energyNeed` +
     portfolio/operator averages + loading/error), returned by `useSolidData`.
   - `ViewDetail` — one view's standalone-page data (definition + snapshot).

## The organising axis — object shape follows storage model

The cleaner cut than "which folder" is **how the object relates to what's stored**,
which tracks the storage-model taxonomy of
[`queries-mutations.md`](./queries-mutations.md) one-to-one:

- **Resource objects** — a typed mirror of one *in-place* resource (GET → object →
  PUT). `BuildingType` ⇄ a building file, `EnergyDataset` ⇄ a dataset file,
  `Organization` ⇄ the org node, `Preferences` ⇄ `prefs.ttl`, `Contact` (entries)
  ⇄ `contacts.ttl`, `AggregatedViewDefinition`/`AggregatedViewSnapshot` ⇄ the view
  definition/snapshot files. One writer owns it; the object is the state.

- **Event & projection objects** — for an *event-sourced log*, two object kinds: the
  immutable **event** appended to the log, and the in-memory **projection** a fold
  derives from it. Sharing: `SharingEvent` (the event) → `ActiveGrant` /
  `SharedBuildingEntry` / `ReceivedView` (folds). Rooms: per-event `RoleEvent` /
  `MembershipEvent` (module-private in `dataRoom.ts`) → `DataRoomMember` (fold). The
  projection is never persisted (the one exception, the materialised `.acl`, is the
  `acl-projection` of [`queries-mutations.md`](./queries-mutations.md)).

- **Derived / resolved objects** — computed in memory, backing no single resource:
  `ResolvedAgent` / `ResolvedOrg` (resolved on demand from a *foreign* profile, so a
  reference renders with a name/logo — never a held map; resolution never throws),
  `Appearance` (a pure selector over already-loaded buildings), `PickedBenchmark` /
  `Contributors` (aggregation folds), `GrantTarget` (ACL-planning intermediate), and
  the hook composites `SolidData` / `ViewDetail`.

This is why a "where is the object for X?" question resolves quickly: an in-place
resource has exactly one resource object; a log has an event type plus its fold(s);
everything else is derived and owned by whichever service computes it.

## The verbs — the action axis

An object is a noun; the **operations on it are part of its model too**, held
separately because the types carry no methods. Every operation is a query or a
mutation (CQS — [`queries-mutations.md`](./queries-mutations.md)): reads that return
one of these objects, writes that change the resource behind it. The
**user-intent** verbs are funnelled through the mutation hooks in
`src/hooks/mutations.ts` — one per intent, each owning its busy state, error toast
and cache invalidation (CLAUDE.md Data flow §2) — so what you can *do* to a given
object (a building: edit, share, hide, attach a file, add an energy year, delete)
is enumerable as the hooks keyed to it.

So the verbs live beside the object, not on it — as the hooks keyed to its
resource: the noun is this note, the verbs are the query/mutation layer.

## A worked example — the Building object

One entity (`BuildingType`) threaded through both axes — the object you read and the
verbs you invoke — described by its parts, not its code.

**Reading it — the access interface.** Every object is reached through one uniform
read shape (`useWebIdQuery`, [`queries.ts`](../src/hooks/queries.ts)), never a
bespoke fetch. The shape has four parts:

- *identity of the read* — a query key led by the object kind and **namespaced by
  WebID** (`buildings · <webId> · …`), so a re-login can't serve another user's
  cache.
- *transport* — the authed session singleton; the caller passes no `fetch`.
- *gate* — the read stays disabled until its inputs resolve (for buildings: the
  shared-in fold + prefs, whose results also fingerprint the key).
- *result* — the typed object(s) **and** the load state together: the list as
  `BuildingType[]` plus `isLoading`/`isFetching`/`error`. The component sees the
  object, never RDF.

So "give me the buildings" (`useBuildings`) is a WebID-keyed, gated read returning
`BuildingType[]`; "give me the dashboard" (`useSolidData`) composes several such
reads into one selector object.

**Acting on it — the intent shape.** Each verb on the object is one named unit
([`mutations.ts`](../src/hooks/mutations.ts)) with four declared parts. Take "share
this building" (`useShareBuilding`):

- *name + label* — the human action (`"share the building"`), which the central
  error toast phrases as `"Failed to {action}: …"`; a verb whose dialog shows its
  own inline error is marked *silent* instead.
- *parameters* — a typed argument object: the building IRI, the recipient WebIDs,
  whether energy is included, which years. This is the intent's signature.
- *effect* — the Pod write it commits (here: a per-recipient grant + a `shared-out/`
  log append), reusing the service write with its optimistic locking.
- *invalidations* — the read keys it refreshes afterwards (here: the shared-out
  log), which the verb **owns** — no caller wiring.

The building's full verb set is the named intents keyed to it — edit, share, hide,
attach a file, add / delete an energy year, delete — each that same four-part unit.
That per-object set is enumerable today as those hooks; the taxonomy behind the parts
(query vs. mutation, which writes leave events) is
[`queries-mutations.md`](./queries-mutations.md).

## Reference vs. resolution

Cross-entity links are kept as **IRIs on the holder**, not as nested objects: a
building's agent fields (`operatedBy`, `ownedBy`, `investor`, `facilityManagedBy`,
`developedBy`, `consultedBy`, `customer`, `attributedTo`) are WebID strings, and its
`energyDatasets` are `EnergyDatasetRef` links whose self-describing slug carries
year/granularity/scenario *without* fetching the body. The app resolves a reference
to displayable data **in memory or on demand**, never by following every IRI eagerly
([`data-deref.md`](./data-deref.md) §Resolving references): agent IRIs become
`ResolvedAgent`/`ResolvedOrg` lazily; dataset links are fetched only when a chart or
export needs the figures. So most objects are shallow, and the joins happen in memory
or on demand at the edge.

## What this layer is not

- **Not a validated schema.** The shapes aren't formally specified; they are
  whatever the imperative parsers read/write, and an unmapped predicate is simply
  dropped on read ([`data-schema.md`](./data-schema.md) §Two schemas). There is no
  shape/validator layer between RDF and object.
- **Not where rendering decisions belong.** A resource object should carry values,
  not how to show them; `EnergyType`'s category bucketing is the residual exception
  (its metric keys are canonical now, and labels are applied at render).
