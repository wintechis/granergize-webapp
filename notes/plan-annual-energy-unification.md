# Plan: one annual-energy view + energy reads through the data layer

Two coupled refactors of the map detail pane's "Energy data" tab and its
neighbours. Both close gaps against rules CLAUDE.md already states: *behaviour
dispatches on the data's shape, not a role*, and *data is read through the
hooks in `src/hooks/queries.ts`*.

## Problem

- `InvestorEnergy.tsx` and `BspEnergy.tsx` are ~80% copy-paste of one
  annual-energy view (identical loader effect, error boundary, `metricData`/
  `metricBars` helpers, summary table with operator-average row, per-metric
  charts). They differ only in which metric columns/charts they show, a
  master-data block BSP renders above the table, and the card title. ExplorePage
  dispatches between them on `companyName || logisticsFunction` — a role-shaped
  proxy left over from the retired role model. Every fix lands twice and has
  already half-diverged (the wastewater column exists only in BSP, renewable
  share only in Investor).
- Four components bypass the React Query data layer with hand-rolled
  `useEffect` fetch loops (`cancelled` flags, local `loading` state, a
  manually copied staleness fingerprint): the two clones, `UserEnergyChart`
  (day listing, single-day readings, month bulk), and `CreateViewDialog`
  (available-months discovery). They miss the layer's caching/dedupe, the
  centralized error classification in `QueryProvider`, and the `fetchFresh`
  freshness chokepoint (they fetch with raw `session.fetch`, so no
  `no-cache`/304 revalidation).

## Design

### One `AnnualEnergy` component (replaces the pair)

`src/pages/AnnualEnergy.tsx`, props `{ building }` (no `session` prop — data
comes through hooks). Everything it shows derives from the data present:

- Metric columns and charts come from `ANNUAL_METRICS`
  (`constants/annualMetrics.ts`, the one annual-metric schema): a metric
  appears when any actual/planned year — or the operator average — carries it.
  Schema order keeps electricity first, so positional cell assertions in the
  e2e specs stay valid. Per-metric icon/color maps live in the component;
  units render in the column header only (the old Investor view repeated the
  `%` in each renewable cell).
- The operator-average row/caption logic is unchanged; the carrier keys in
  `operatorAverages` ("Electricity"/"Heat"/…) are exactly the schema `label`s
  of the four consumption metrics, so the lookup is `operatorAvg[m.label]`
  (renewable share is a ratio and stays out, as before).
- The master-data block (climate control, tenancy, lease, tenant industry,
  indoor-temperature class, loading docks, green-lease share, PV chip,
  certifications) renders whenever any of those fields is present — the
  BSP-only gating was the role residue.
- One card title (`Annual Energy & Water — <label>`), with
  `companyName`/`logisticsFunction` as the subheader when present (they were
  the BSP title). The "Benchmark Data" framing disappears with the role.
- Empty state generalises BSP's: master-data block (if any) + "No annual
  energy data available for this building."

ExplorePage's annual branch renders `AnnualEnergy` unconditionally; the
`companyName || logisticsFunction` dispatch is deleted. `InvestorAnnualData`
(`types.ts`) is renamed `AnnualData` — the last role-named type on the energy
path.

### Energy reads as query hooks

New hooks in `src/hooks/queries.ts`, following the existing conventions
(WebID-namespaced keys from `queryKeys`, `getSession()` transport, errors
routed by `QueryProvider`). All fetch through `fetchFresh`, joining the
conditional-GET freshness chokepoint.

- `useAnnualEnergy(building)` — the building's annual datasets split into
  `{ actual, planned }`, sorted by year. Keyed on
  `[...queryKeys.annualEnergy, webId, building.id, energyKeyFor([building])]`:
  the link fingerprint makes a year add/delete refetch fall out of the data
  (what the duplicated effect-dep comment used to hand-maintain).
- `useSeriesDays(refs)` — the day files behind a set of 15-min series
  descriptors (`listSeriesDays` per ref, concurrently), keyed on the sorted
  ref URLs. Serves both `UserEnergyChart` (date/month pickers) and
  `CreateViewDialog` (months = distinct `day.substring(0, 7)`, derived in a
  `useMemo` — no separate months hook).
- `useDayReadings(url?)` — one day file's readings, enabled when a date is
  picked.
- `useMonthReadings(entries, enabled)` — the bulk month fetch
  (`Promise.allSettled`, unreadable days skipped as before), keyed on the
  entry URLs, enabled on the two monthly tabs. The numeric "N / M days"
  progress text becomes the standard plain `Loading…` (the loading-spinner
  policy: regions show plain text, the header indicator carries per-request
  detail).

`useInvalidateBuildingData` (`mutations.ts`) additionally invalidates the new
keys. That closes a pre-existing staleness gap the fingerprint alone cannot:
editing an *existing* year's figures changes no links, so the old effect never
re-ran; an invalidation on every building write refetches regardless (cheap —
conditional GETs).

`EnergyYearDialog`'s stored-years load stays as is, deliberately: the dialog
keeps a locally-synced copy so its table updates the moment a save/delete
resolves, without waiting for the buildings refetch that drives every
query-key fingerprint.

## Testing

- Hook tests in `queries.test.ts` (offline-fixture fake session, `renderHook`):
  `useAnnualEnergy` splits/sorts actual vs planned; `useSeriesDays` lists and
  sorts day files. Component render of MUI pages doesn't work under
  `deno test` — render behaviour stays covered by the existing Tier-3 specs
  that drive this tab (`energy-entry`, `materialised-views`,
  `share-building`).
- The e2e specs assert table *content* (year rows, figures, "Operator
  average", "(planned)" legend), which the unified component preserves;
  comments naming `InvestorEnergy` are updated.
