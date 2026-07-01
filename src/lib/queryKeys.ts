/**
 * Query-key prefixes for **Pod state** — the single source for the hooks
 * (`hooks/queries.ts`), the mutation invalidations (`hooks/mutations.ts`) AND
 * the service-side cache accessors (`buildingSource.ts`, `energyDatasetCache.ts`,
 * `sharingLog.ts` — the `ensureQueryData`/peek readers that share the hooks'
 * warm entries), so the invalidation contract and the cross-layer cache
 * sharing can't drift on a key typo. Lives in `lib/` (a leaf) because the
 * services can't import the hooks. The read-only external sources have their
 * own registry (`services/sources/sourceKeys.ts`) — those keys are never
 * write-invalidated, so they are deliberately not part of this contract.
 */
export const queryKeys = {
  // ─── Container listings & per-resource reads (the resource-query layer) ───
  /** The own-buildings container listing (`["buildingsContainer", webId]`) — the
   * membership query the `useBuildings` fan-out reads its own source IRIs from. */
  buildingsContainer: ["buildingsContainer"] as const,
  /** One building source document (`["buildingSource", webId, sourceUri]` → `Building[]`)
   * — the per-resource read the `useBuildings` fan-out and `fetchBuildingSourceShared`
   * go through. */
  buildingSource: ["buildingSource"] as const,
  /** One energy dataset, keyed by its node IRI (`["energyDataset", webId, uri]`) — the
   * shared per-resource read the map fold and the aggregation compute both go through. */
  energyDataset: ["energyDataset"] as const,
  /** The `shared-in/` log's container LISTING (event IRIs) — everything "shared with me"
   * derives from folding it; mutations invalidate this to re-list + refold. */
  sharedInContainer: ["sharedInContainer"] as const,
  /** The `shared-out/` log's container listing — the shared-buildings/-aggregations lists
   * derive from folding it. */
  sharedOutContainer: ["sharedOutContainer"] as const,
  /** One sharing-log event (`["sharingEvent", webId, eventUri]` → `SharingEvent[]`) — the
   * immutable per-event read the log fan-outs cache (staleTime Infinity). */
  sharingEvent: ["sharingEvent"] as const,

  // ─── Per-building energy (fan-out selectors + detail/series reads) ───
  /** One building's latest-annual energy, keyed per building
   * (`["buildingEnergy", webId, buildingUri, linkFingerprint]`) — the `useEnergy`
   * useQueries fan-out; the portfolio/operator averages derive from these in `combine`. */
  buildingEnergy: ["buildingEnergy"] as const,
  /** One building's per-year annual cube (`["buildingEnergyByYear", webId, uri, fingerprint]`)
   * — the `useAnnualEnergyByYear` useQueries fan-out behind the time-cut slider. */
  buildingEnergyByYear: ["buildingEnergyByYear"] as const,
  /** One building's annual datasets (detail pane), keyed by id + link fingerprint. */
  annualEnergy: ["annualEnergy"] as const,
  /** One building's raw annual datasets (energy-year dialog), keyed by id + fingerprint. */
  annualDatasets: ["annualDatasets"] as const,
  /** The user's building-less (unbound) observations, keyed by the building-link fingerprint. */
  buildinglessObservations: ["buildinglessObservations"] as const,
  /** Day files behind a set of 15-min series descriptors, keyed by ref URLs. */
  seriesDays: ["seriesDays"] as const,
  /** One day file's readings, keyed by URL. */
  dayReadings: ["dayReadings"] as const,
  /** A month of day files (bulk), keyed by the entry URLs. */
  monthReadings: ["monthReadings"] as const,

  // ─── Aggregations & received shares ───
  /** The aggregation-definitions container listing (`["aggregationsContainer", webId]`) — the
   * membership query the `useAggregationDefinitions` fan-out reads its definition IRIs from. */
  aggregationsContainer: ["aggregationsContainer"] as const,
  /** One aggregation definition document (`["aggregationDefinition", webId, defUri]`) — the
   * per-resource read of the fan-out. */
  aggregationDefinition: ["aggregationDefinition"] as const,
  /** One aggregation's definition + computed snapshot (the standalone /aggregation page), keyed by aggregation id. */
  aggregationDetail: ["aggregationDetail"] as const,
  /** A received aggregation's computed snapshot, keyed by snapshot IRI. */
  computedSnapshot: ["computedSnapshot"] as const,
  /** A building shared with the user, loaded in full, keyed by building IRI. */
  sharedBuildingDetail: ["sharedBuildingDetail"] as const,
  /** Benchmark snapshots received from a BSP (subset of received aggregations). */
  receivedBenchmarks: ["receivedBenchmarks"] as const,

  // ─── Rooms & agents ───
  /** The room registry (current + known). Set via setQueryData, not invalidated. */
  rooms: ["rooms"] as const,
  /** A room's log (members + roles), keyed by room. Invalidated on role saves. */
  roomLog: ["roomLog"] as const,
  /** Room display names (`rdfs:label`), keyed by the room-URI set. An ordinary
   * read — its own key, NOT a suffix of the never-invalidated `rooms` registry. */
  roomNames: ["roomNames"] as const,
  /** The saved-agents address book. Invalidated on save/remove. */
  agents: ["savedAgents"] as const,
  /** A single resolved agent (name/avatar), keyed by WebID. */
  agent: ["agent"] as const,
  /** A single resolved agent's organisation (name + logo IRI), keyed by WebID. */
  agentOrg: ["agentOrg"] as const,

  // ─── App state ───
  /** prefs.ttl (hidden buildings, …). Invalidated by the visibility toggle. */
  prefs: ["prefs"] as const,
  /** The fresh-Pod demo-buildings offer (own container empty + not declined). */
  demoOffer: ["demoOffer"] as const,
};
