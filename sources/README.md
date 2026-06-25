# External data sources — overview

The app reads, beyond the user's own Pod, a set of **external** sources: public
Linked-Data wrappers, a geocoder, identity/media lookups, raster tiles, and an LLM
gateway. This directory holds one note per source (`sources/<id>.md`) recording how
that source's RDF model corresponds to ours; this README is the cross-cutting overview
— what each source is, how the app reaches it, and which access modes it offers.

Three sibling artefacts describe adjacent concerns, not this one:

- `vocab/` — **our own** three Granergize `.ttl` vocabularies (building / consumption /
  core) and their README. Those are authored here; external sources are not.
- `src/constants/dataSources.ts` (`SOURCES`) — the in-app **attribution** registry
  (name, homepage, licence) surfaced on `/data-sources` and in `SourceNote`. One entry
  per id, mirroring a `sources/<id>.md` note.
- `notes/data-deref.md` + `notes/open-data.md` — the **read path**: the deref
  primitive, discover-then-bulk-fetch, and where each `open`-tier source surfaces.

## The access contract

Every source is **dereferenceable**: GET an IRI it mints, get back RDF describing that
resource. That — plus discover-then-bulk-fetch and an in-memory join — is the *only*
mode the app uses. The app **never issues SPARQL** and is **not** a follow-your-nose
engine (see `notes/data-deref.md` §"What this is NOT").

Some wrappers *additionally* expose query endpoints on top of deref. Two kinds appear:

- **`/sparql`** — a full SPARQL endpoint over the wrapper's dump. Present on
  `linked-nuts`, `linked-lau`, `linked-inspire`, `linked-regionalstatistik`,
  `linked-osm` (and `linked-eurostat`, `linked-mastr-store` — neither wired into the
  app). **Absent** on the wrappers the app leans on most: `linked-mastr` (the *store*
  variant has one, the served wrapper does not), `linked-wetterdienst`,
  `linked-lod2-by`, `linked-energieatlas`, `linked-netztransparenz`. So `/sparql`
  availability is per-wrapper, not a family guarantee — and the app exploits none of
  it; it's there for ad-hoc exploration.
- **Lookup endpoints** — the discovery capabilities below, used to find the IRI set
  before dereferencing. These *are* on the app's load path.

## Capability vocabulary

Beyond plain deref, the `linked-*` family uses a small, fixed set of endpoint names,
each with one fixed meaning. A wrapper exposes the subset that fits its data; the name
must match the shape, so a reader can predict an endpoint's contract from its name
alone.

- **`/search?q=`** — **keyword** lookup: free text in, matching resources out. The
  textual discovery shape. (`linked-mastr`; `linked-inspire`'s `/names?q=` is the
  gazetteer-scoped variant; `linked-osm`'s `/nominatim/search` is API-compat with
  upstream Nominatim.)
- **`/bbox?bbox=W,S,E,N`** — **spatial, area**: resources within a bounding rectangle.
  (`linked-mastr`, `linked-lod2-by`.)
- **`/point?lon=&lat=&r=`** — **spatial, point + radius**: resources within `r` of a
  coordinate — the "nearby" circle. (`linked-lod2-by`.) `/bbox` and `/point` are the two
  *find-around-here* shapes; the app's `fetchNearby*` functions wrap whichever one the
  source offers (MaStR via `/bbox`, LoD2 rooftops via `/point`).
- **`/contains?lat=&lon=`** — **spatial, point → container**: the region(s) a coordinate
  falls *inside*. (`linked-nuts`, `linked-lau`.) Distinct from `/point`: not "what's near"
  but "what contains me".
- **`/filter?<attrs>`** — **structured by-attribute selection** over a listing (exact
  facet matches, not free text). (`linked-netztransparenz`: `plz`/`source`/`minkw`.)

The discovery shapes above *find* IRIs you don't yet hold. Separately, the wrappers expose
**constructible deref paths** — path-based URI templates keyed by a meaningful external
code, so a client that already holds the code can build the IRI and dereference directly,
no discovery round-trip: `/ags/{ags}` (`linked-mastr`, `linked-lod2-by`), `/eeg/{number}`
(`linked-mastr`, `linked-netztransparenz`), `/see/{mastr-nr}` / `/building/{id}`,
`/area/{ags}` (`linked-energieatlas`). These are part of the dereferenceable resource
space, not discovery — the app reaches netztransparenz purely this way
(`plantUrl(eegNumber)` → `eeg/{number}`).

Two capabilities sit *outside* this vocabulary entirely: **`/sparql`** (a full query
surface, per-wrapper — see above) and **`/geojson`** (bulk choropleth export, AGS-keyed,
`linked-nuts`/`linked-lau`). Anything that doesn't fit a shape above must not borrow its
name — e.g. netztransparenz's attribute selection is `/filter`, **not** `/search`
(keyword search would need a `?q=`).

## The sources

Grouped by how the app consumes them. Each lists: what it provides · the client module
· the source tier it feeds (see `notes/open-data.md`).

### Ontologycentral `linked-*` RDF wrappers

- **MaStR** (`mastr.md`, `linked-mastr`) — nearby renewable generation units (carrier,
  capacity, EEG number). `mastrNearby.ts`; also the Logistikimmobilien import. `open`
  tier. Deref + `bbox`/`search`; no `/sparql`.
- **Netztransparenz** (`netztransparenz.md`, `linked-netztransparenz`) — a plant's
  actually-settled kWh per year, joined to a MaStR unit by EEG number.
  `netztransparenz.ts`. `open`. App reaches it by **deref** (EEG-number-addressed); the
  wrapper also offers `/filter` (attribute selection), unused by the app.
- **Weather / DWD** (`wetterdienst.md`, `linked-wetterdienst`) — DWD observations
  (SOSA/QUDT), aligned to a building's energy. `linkedWeather.ts`. Render-only context.
  Deref only; CORS-enabled (`VITE_WEATHER_API_URI`).
- **Regionalstatistik** (`regionalstatistik.md`, `linked-regionalstatistik`) — GENESIS
  tables as RDF Data Cube at Land/Kreis grain. `regionalCube.ts`. `open`. Deref +
  `/sparql`.
- **Energie-Atlas Bayern** (`energieatlas.md`, `linked-energieatlas`) — per-Gemeinde PV
  potential/installed/mix (Bavaria-only). `standortEnergieprofil.ts`. `open`. Deref via
  the constructible `/area/{ags}`.
- **LoD2 rooftop** (`lod2-by.md`, `linked-lod2-by`) — 3D roof geometry → installable
  kWp + annual kWh (Bavaria). `lod2Rooftop.ts`. `open`. `/point` (the nearby layer) +
  `/bbox` for discovery, then deref (`/building/{id}`, `/ags/{ags}`).
- **NUTS regions** (`nuts.md`, `linked-nuts`) — EU statistical regions as SKOS +
  GeoSPARQL geometry. `regionGeometry.ts`. Choropleths / place-by-AGS. Deref +
  `geojson`/`contains` + `/sparql`.
- **LAU regions** (`lau.md`, `linked-lau`) — the leaf (Gemeinde) level of the same
  hierarchy. `regionGeometry.ts`. Deref + `geojson`/`contains` + `/sparql`.
- **INSPIRE / ALKIS** (`inspire.md`, `linked-inspire`) — cadastral parcels/geometry; a
  MaStR-import join wrapper. Deref + `/sparql`.

### Geocoder

- **Nominatim** (`nominatim.md`) — OSM geocoding, address → coordinates. Plain HTTP
  **JSON, not RDF**, so outside the deref frame. `geocode.ts`, hard-coded host.

### Identity & media (deref of foreign authorities)

- **Wikidata** (`wikidata.md`) — entity resolution for organisations; deref of
  `Special:EntityData/Q….ttl` (CORS-open) for label + logo. `agentResolver.ts`.
- **Wikimedia Commons** (`commons.md`) — the logo image files Wikidata's `P154` points
  at. Image fetch, not RDF.

### Raster tiles & bundled grids (render-only, persist nothing)

- **basemap.de** (`basemap.md`) — base map tiles under the Leaflet map.
- **Bavaria DOP20c** (`bavaria-dop.md`) — orthophoto tiles.
- **PVGIS** (`pvgis.md`) — yield grid **bundled** with the app (not a live endpoint),
  combined with LoD2 roof area to get annual kWh.

### LLM gateway

- **FAU NHR LLM** (`nhr-llm.md`) — the chat/autofill API. Not Linked Data; remote-only
  by nature (can't be meaningfully stubbed — see the eval lanes in `test/README.md`).

## Boundaries

External data is **read-only and best-effort**: an unreachable wrapper degrades to an
empty section, never a hard error. `open`-tier data is never written to the Pod and
carries no Pod-side PROV; attribution lives in the UI (`/data-sources`, `SourceNote`,
the dev-mode `RdfSourceLink`). Coverage is partial — LoD2 and Energie-Atlas are
Bavaria-only; MaStR / netztransparenz / regionalstatistik are all-Germany.
