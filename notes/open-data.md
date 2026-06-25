# Open data — the outer (ungated) ring

Beyond the user's own Pod (`mine`) and what others share with them (`shared`), the app
reads an outer ring of data: **open** — public, off-Pod, ungated Linked Data anyone can
fetch, shown to give the user's own figures context (§The concentric model). It is never written, never owned,
never shared. Companion to [`data-deref.md`](./data-deref.md) (the external-wrapper read
path it shares), [`weather.md`](./weather.md) (one such queried source),
[`aggregations.md`](./aggregations.md) (where open regional datasets appear as a tier),
and [`building-detail.md`](./building-detail.md) (the building page's open-context
sections).

## The concentric model

The three source tiers are **concentric rings** around the user, ordered by
write-authority then gate — each outer ring a strictly larger world the user has less say
over:

- **Centre (`mine`)** — the user's own Pod (storage-root-keyed); authored, owned, and the
  only **writable** ring.
- **Middle (`shared`)** — on *other* Pods, WAC-gated and addressed *to them* through the
  `shared-in/` log; read-only but still private (someone granted it).
- **Outer (`open`)** — public, ungated, off-Pod Linked Data, pulled in only as context;
  never owned, never written, addressed to *no one in particular*.

Outward, several axes move together — what "concentric" captures and a flat list doesn't:
**ownership/control** falls (only the centre is writable), **breadth** grows, how
specifically-**addressed-to-you** it is fades (mine *is* yours → shared is *for* you →
open is for everyone), and **gatekeeping** loosens (own auth → a WAC grant → none).

Every collection finder filters its rows by a multi-select **source tier**
(`useListFacet("tiers", …)`, `constants/tiers.ts`): `TIER_VALUES = ["mine", "shared",
"open"]`. Each finder offers the rings that fit its collection (`BUILDING_TIERS` /
`OBSERVATION_TIERS` / `AGGREGATION_TIERS` / `AGENT_TIERS` — all three; the open ring is
simply empty outside a source's coverage). The facet unions outward from the centre:
`mine` + `shared` are on by default, `open` is opt-in. Two behaviours track the model:
only `mine` is writable, and (with the carve-out below) `mine`/`shared` resources earn an
in-app detail page.

### Reaching the outer ring

The outer ring is reached from the inner two **two ways** — only the first is literally
"linked from" your data:

- **Followed links** — an IRI that sits *in* the Pod (or shared) graph: `rec:operatedBy`
  / `rec:ownedBy` / `owl:sameAs` → an agent profile, a Wikidata entity. You follow the
  edge (see [`data-deref.md`](./data-deref.md) §"Resolving references").
- **Discovered/constructed from a value** — the nearby MaStR plants, LoD2 rooftops, the
  weather station, the regional-statistics table. Not linked from your data; found from a
  *value* in it — coordinates (`/bbox` / `/point` / `/contains`) or an AGS (constructible
  `data/{tableId}`). The graph supplies the value; discovery or a URI template mints the
  IRI (access modes catalogued in [`../sources/README.md`](../sources/README.md)
  §"Capability vocabulary").

The outer ring is **transitive**: once an external resource is dereferenced, *its* graph
links onward (a MaStR unit → its operator → its EEG plant in netztransparenz), so the
ring keeps expanding one hop at a time.

**Anchoring — every discovery centres on *your* data.** The *discovered-from-a-value*
path always takes the value from the user's own (+ shared) data, so the open ring is
uniformly concentric: the Aggregations regional tier (`openRegionalItemsFromBuildings` —
only Bundesländer where you own buildings) and the building page's
`StandortEnergieprofil`/`RegionalStatistics`/`NeighbourhoodEnergyMap`/weather sections
(keyed to *that building's* coordinates/region); and the map's **open buildings**
(`useOpenBuildings`) + **open observations** (`useOpenObservations`) layers anchor to
`ownDataAnchor(buildings)` — a centre + radius covering the user's own buildings' bounding
box, NOT the free map viewport. Panning to a city you own nothing in shows no open rows;
with no located building, the open tier is empty (no own data → no context). Free-viewport
*exploration* (browsing open data beyond your own extent) is a separate, opt-in mode driven
by the wrappers' server-side `/search` / `/bbox` — not built; a direction only.

The **Agents** finder reads the same facet via the shared `TierFilter`, but an agent
isn't a Pod resource with a ring of its own, so its ring is *derived* from where it
appears (`referencedAgentTiers`): an agent in the address book (`agents.ttl`) or
referenced by an OWN building — incl. a building's technical-system operator — is `mine`;
one that appears only in a building shared WITH the user is `shared` (an agent can be
both). `open` is empty for now (operators of open/public buildings could populate it once
the open ring is scanned for agents).

## The open sources

All open reads go through `trackedFetch` (`networkActivity.ts` — non-Pod, non-DPoP,
retried, activity-tracked, **never the authed session**) and parse Turtle via
`parseRdfText`; wrapper bases are env-overridable (`VITE_*_API_URI`) but CORS-enabled, so
fetched directly. The public registry — name, homepage, licence, attribution — is
`DATA_SOURCES` (`constants/dataSources.ts`), surfaced on the `/data-sources` page.

- **LoD2 rooftop-PV** (`linked-lod2-by`, Bavaria) — `lod2Rooftop.ts`: 3D roof geometry →
  installable kWp + annual kWh (with PVGIS). `fetchNearbyRooftops` (bbox summary) /
  `fetchRooftopPotential` / `fetchOpenBuilding`.
- **MaStR units** (`linked-mastr`, all-Germany) — `mastrNearby.ts`: nearby renewable
  generation units (carrier, capacity, locality, EEG number). `fetchNearbyInstallations`
  / `fetchEegNumber` / `parseUnitDetail`.
- **EEG settled generation** (`linked-netztransparenz`) — `netztransparenz.ts`: a plant's
  actually-settled kWh per year, joined to a MaStR unit by its EEG number.
  `fetchPlantGenerationByYear`.
- **Regional statistics** (`linked-regionalstatistik`, RDF Data Cube `qb:`) —
  `regionalCube.ts`: GENESIS tables (renewable share, GHG/capita, heat-pump permits, …) at
  Land/Kreis grain. `fetchRegionalObservations` (one table × region year-series) /
  `fetchRegionalChoropleth` (latest value per region); tables in `REGIONAL_TABLES`.
- **Energie-Atlas Bayern** (`linked-energieatlas`) — `standortEnergieprofil.ts`:
  per-Gemeinde PV potential/installed/remaining + generation mix. `fetchAreaProfile`.
  Bavaria-only.
- **NUTS/LAU geometry** (`linked-nuts` / `linked-lau`) — `regionGeometry.ts`: region
  boundaries (GeoJSON) for the choropleths and place-by-AGS resolution. LAU loads scoped
  to a viewport / parent Kreis (the full layer is large).

## Open data opens in-app (read-only)

The app sits inside the Linked-Data Web; rather than bounce out to the wrapper document, a
drill on an open row/marker opens an **in-app, read-only detail** — the same `DetailView`
chrome (`BackLink`, `DetailCard`, `SourceNote`, …) the Pod-backed pages use, plus a
dev-mode `RdfSourceLink` to the raw IRI. The detail routes resolve a `?uri=` against the
Pod cache first; on a miss the route wrapper (`App.tsx`) recognises an open IRI and
fetches by IRI:

- `/building?uri=<lod2-iri>` — `isOpenBuildingIri` → `OpenBuildingDetail` (`fetchOpenBuilding`
  → roof footprints + rooftop-PV potential through the same `RooftopBuildingCardView` an
  owned building uses).
- `/observation?uri=<mastr-iri>` — `isOpenObservationIri` → `OpenObservationDetail`
  (`fetchOpenObservation` → unit master data + an annual settled-generation bar chart from
  netztransparenz).
- `/regional?table=<id>&ags=<region>` — `RegionalDataset`: one GENESIS table's year-series
  for a region, with a Table | Map (choropleth) toggle.

## Where open data surfaces

- **Buildings finder** — the `open` tier (when ticked) unions nearby LoD2 rooftop buildings
  (`useOpenBuildings` → `fetchNearbyRooftops`, converted to `BuildingType` with `isOpen`
  and the IRI as id) into the list + map; a drill opens the read-only building detail.
- **Observations finder** — the `open` tier lists nearby MaStR renewable plants with their
  settled generation (`useOpenObservations`, capped) as a **separate list section**, not
  building-keyed (per-building open energy isn't wired — a known gap below).
- **Aggregations finder** — the `open` tier adds public regional-statistics datasets,
  derived in memory from the user's building regions (`openRegionalItemsFromBuildings`, no
  network cost); the **map** guise shades a German choropleth (own/received Kreis snapshots
  + open Land figures) and the **timeline** shows cross-year evolution.
- **Building page context sections** — `StandortEnergieprofil` (rooftop potential vs
  installed, generation mix, nearby settled generation), `NeighbourhoodEnergyMap` (Gemeinde
  build-out choropleth) and `RegionalStatistics` (the building's region figures, table/map)
  render read-only open context beside the building's own data.

## Boundaries

- **Render-only — nothing is persisted.** Open data is never written to the Pod and
  carries no PROV on a Pod resource; the app caches it client-side in React Query (keyed by
  coordinates / IRI / table — **not** WebID-namespaced, since it's public — `staleTime`
  ~1h). Attribution lives in the UI: the `/data-sources` page, in-context `SourceNote`s,
  and the dev-mode `RdfSourceLink`.
- **Best-effort, silent-degrade.** An unreachable wrapper / 404 / missing EEG plant yields
  `[]` / `null` with no toast — open context is non-critical, so a coverage gap just omits
  the section.
- **Coverage is partial.** LoD2 and Energie-Atlas are Bavaria-only;
  MaStR / netztransparenz / regionalstatistik are all-Germany. The open tier is empty where
  a source has no data.
- **The IRI is the identity.** Open buildings/observations carry no label — the IRI is the
  id and the display renders coordinates + figures only (the "no URI-parsing magic" rule:
  never derive meaning from IRI structure).
- **Known gap.** The Observations `open` tier is half-built — open generation shows as a
  standalone plant list, not joined per-building.
