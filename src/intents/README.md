# `src/intents/` — React-free intent cores

The **core** below the hook. See
[`../../explore/explore-intent-registry.md`](../../explore/explore-intent-registry.md)
§"Half the abstraction, React-bound" (the line this layer draws) and §"Actions"
(the effect-discriminated result channel), and
[`../../plans/plan-intent-core.md`](../../plans/plan-intent-core.md) §1.

## The core/adapter split

An intent's implementation splits in two:

- **The core** (here) — a plain async function
  `<name>Core(session, params) → Promise<Outcome | Result>` holding exactly the
  Pod-request composition. It **takes the `Session` as an argument** (never calls
  `getSession()`), imports **no React and no React Query**, and returns a typed
  result. It is the single implementation, callable headless — a palette, a deep
  link, an LLM tool, the bench seeder, or a Tier-2 runner can invoke it with no
  component tree (proven by the Tier-1 `*.test.ts` here, which call the core with
  a fake offline-fixture session).

- **The adapter** (the hook in `src/hooks/mutations.ts`) — a thin `useMutation`
  whose `mutationFn` calls the core with `getSession()`, keeping ONLY the parts
  that mean something where a query cache exists: busy (`isPending`), the central
  error toast (`meta.action`), and the cache invalidation (`onSettled`). UI
  behaviour is unchanged.

## The `invoke` / `query` layer (`registry.ts`)

Above the cores sits the **callable entry point** — `registry.ts`, React-free
(it imports the cores + `Session` only). Two `as const` dispatch maps keyed by
the catalog `name` hold the extracted cores: `WRITE_CORES` (`ShareBuilding`) and
`READ_CORES` (`AuditGrants`, `ExportArchive`). Step 5 adds one line each as the
remaining hooks gain cores.

- `invoke(name, params, session)` dispatches a **write** intent → its outcome;
  `query(name, params, session)` dispatches a **read** intent → its value.
- **CQS is enforced at the type level** by the two separate maps/functions:
  passing a read name to `invoke` (or a write name to `query`) is a compile
  error — there is no runtime `effect` switch.
- `invokeByName`/`queryByName` take a runtime string (the palette passing
  `IntentEntry.name`) and throw `IntentNotInvocableError` for any name without an
  extracted core — a clear error, never a silent fallback.

The adapter hooks route through this entry point (`useShareBuilding` →
`invoke("ShareBuilding", …)`; `useAuditGrants`/`useExportArchive` →
`query(…)`), so the UI and a headless caller hit the same path.

The reified **param schema** lives in `params.ts` (`INTENT_PARAMS`): each param's
node-kind / range / cardinality, key-set-bound to the core's TS param type via
the `ParamKeysMatch` witness, drift-guarded against the affordance bag.

## The EntityQuery resolver (`entityQuery.ts`)

The seam that turns an entity **IRI** into the typed instance the `applies()`
guards consume — so the callable layer can bind and state-filter verbs from a
bare IRI **without a component tree** (a deep link, a palette, an LLM tool). It is
also React-free (cores + `Session` only). See
[`../../explore/explore-intent-registry.md`](../../explore/explore-intent-registry.md)
§"Entity queries": the app fills this role only implicitly today (a route's `:id`
is resolved by filtering already-loaded collection folds); this reifies it as a
one-shot, below-React read.

- `resolve(entity, iri, session)` → the typed object (`IntentObject`): a
  `"building"` IRI → `BuildingType` (with `isShared` set the way `loadBuildings`
  does — own iff the source lives under the viewer's storage root), an
  `"aggregation"` IRI → `AggregationDefinition`; any other entity / unresolvable
  IRI → `undefined`. It resolves only enough to satisfy the guards (own-vs-shared,
  has-energy, has-attachment, snapshot-exists), so no extra fetch.
- `applicableForIri(entity, iri, viewer, session)` = `resolve(…)` then
  `applicableIntents(object, viewer)` — the state-filtered verb set from an IRI
  alone (empty for an unresolvable IRI).

It is **not a new loader**: it reuses the app's single-resource reads + parsers —
`fetchFresh` + `parseBuildings` for a building, `getAggregationDefinition` for an
aggregation (keyed by the IRI's file stem; definitions are own-only).

## CQS at the type level (§"The in-code catalog")

The result channel is discriminated on effect:

- A **write** core returns an **outcome** — settled, or a small per-item tally
  (e.g. `{ recipientsShared }`) — **never a value**. No caller consumes a
  mutation's return value; the effect is on the Pod, observed through the
  adapter's invalidations.
- A **read** core returns its **value** (the audit report, the archive blob).
  The returned value is a read-intent's whole point.

The full outcome taxonomy (abort-as-outcome, whole-cache invalidation, the
boundary cases) lands in later steps; Step 1 establishes only the shape.
