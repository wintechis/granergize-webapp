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

Every collection finder filters its rows by a multi-select **source tier**
(`useListFacet("tiers", …)`, `constants/tiers.ts`): `TIER_VALUES = ["mine", "shared",
"open"]`. Read the three not as a flat list but as **concentric rings centred on the
user's Pod** — each outer ring a strictly larger world the user has less say over:

- **`mine`** (centre) — on the user's own Pod (storage-root-keyed); authored, owned, and
  the only **writable** ring.
- **`shared`** (middle) — on *another* Pod, WAC-granted through the interop `shared-in/`
  log and addressed *to them*; read-only, theirs to see but not own.
- **`open`** (outer) — public, ungated, off-Pod Linked Data addressed to *no one in
  particular*; fetched as anyone, no auth, read-only — pure context.

Outward, several axes move together — what "concentric" captures and a flat ladder
doesn't: **ownership/control** falls (only the centre is writable), **breadth** grows
(each ring is a larger set), how specifically-**addressed-to-you** it is fades (mine *is*
yours → shared is *for* you → open is for everyone), and **gatekeeping** loosens (own auth
→ a WAC grant → none). The facet unions outward from the centre: `mine` + `shared` are on
by default, `open` is opt-in.

Each finder offers the rings that fit its collection (`BUILDING_TIERS` /
`OBSERVATION_TIERS` / `AGGREGATION_TIERS` / `AGENT_TIERS` — all three; the open ring is
simply empty outside a source's coverage). Two behaviours track the model: only `mine`
is writable, and (with the carve-out below) `mine`/`shared` resources earn an in-app
detail page.

**Provenance vs anchoring — the rings describe *who controls* the data, not *what it is
centred on spatially*.** That control axis is uniform. But which open data the app
actually fetches has **two anchoring modes**, and only one is centred on the user:

- *Own-data-anchored* (genuinely concentric): the Aggregations regional tier
  (`openRegionalItemsFromBuildings` — only Bundesländer where the user owns buildings)
  and the building page's `StandortEnergieprofil`/`RegionalStatistics`/
  `NeighbourhoodEnergyMap`/weather sections (each keyed to *that building's*
  coordinates/region).
- *Viewport-anchored* (independent of the on-Pod buildings): the map's **open buildings**
  (`useOpenBuildings`) and **open observations** (`useOpenObservations`) layers key on
  `openViewport(searchParams)` (`?c=`/`?z=`) → "what's near where you're *looking*", not
  what you own. Pan to a city you own nothing in, tick `open`, and rows appear.

So `open` is one provenance ring but two query modes: context-around-your-data, and free
viewport exploration. The map layers are deliberately exploratory; the rest is concentric
context.

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
