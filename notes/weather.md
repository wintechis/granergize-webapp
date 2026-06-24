# Weather data

How the app shows weather alongside a building, and why it sits **outside** the Pod
data path. It lives as a section on the building's observation page beside energy
(`Energy.tsx`); companion to [`architecture.md`](./architecture.md) (the
network-activity store it opts into); the energy observations it sits beside are
[`energy-model.md`](./energy-model.md).

Weather here is an **external, live, read-only** layer: observations about a **nearby
weather station**, fetched on demand from a third-party adapter, never stored on the
Pod and never joined to the building's own data. It is the one data surface that does
not go through the Solid session or the React-Query Pod cache.

## Source and configuration

The backend is the **`linked-wetterdienst`** Linked Data wrapper (`linkedWeather.ts`),
a Java/Jena SOSA/QUDT RDF wrapper over the **wetterdienst** service (which serves
**Deutscher Wetterdienst (DWD)** data) — a sibling of the other `linked-*` wrappers.
The app **dereferences its Turtle** (`Accept: text/turtle`, parsed with n3 via
`parseRdfText`), not a JSON RPC. It is fetched **directly** from
`https://wunderfacts.com/wetterdienst/` — the wrapper is CORS-enabled, so no dev proxy
is needed — overridable via `VITE_WEATHER_API_URI` (`.env.development` /
`.env.production`); see
[external wrapper endpoints](./data-deref.md#external-wrapper-endpoints). The base
backs a dev-mode `RdfSourceLink`, so the service is inspectable like a Pod resource.

## The query path — two steps, by proximity

`WeatherData.tsx` runs two plain React-Query reads — **not** WebID-namespaced and
**not** through the authed session, because this is neither user-specific nor Pod
data:

1. **Nearest stations** — `fetchNearestStations(lat, long, 5, parameter)` GETs
   `near?latitude&longitude&rank&parameters` and parses the returned
   `dwd:WeatherStation`s (id, name, `schema:distance`), nearest-first; gated on the
   building having coordinates. So the building↔weather link is a **spatial join by
   proximity**, not containment or attribution — the station is typically kilometres
   away, and its distance (km) is shown in the picker.
2. **Recent values** — `fetchStationValues(station, parameter)` GETs
   `values?station&parameters&periods=recent`, parsing the `sosa:Observation`s into
   year / value / quality; gated until a station is selected. Values arrive
   **unit-converted by the wrapper** (e.g. sunshine in hours). The closest station is
   auto-selected when a fresh list arrives (a during-render reset keyed on the list
   identity, not an effect).

Both reads go through `trackedFetch` (`networkActivity.ts`) — the wrapper for non-Pod
external fetches, which records the request in the global activity store **and** retries
transient throttling — so weather requests surface in the header network indicator
without the components tracking activity themselves (see
[`architecture.md`](./architecture.md) and the network-activity section of
`CLAUDE.md`). The pure parsers (`parseStations` / `parseObservations`) are split out
for offline unit-testing (`linkedWeather.test.ts`).

## What it shows

A **Weather** section on the building's observation page (`/observation`,
`Energy.tsx`), shown whenever the building has coordinates — energy and weather
are the building's two observation layers (one owned on the Pod, one queried
live). Two selects — **parameter** and
**station** — over the annual DWD parameters the wrapper exposes: mean temperature
(the default, °C), sunshine duration (h), precipitation (mm). Values render as a
small year / value / quality table, with a "Deutscher Wetterdienst (DWD)"
attribution, the dev-mode source link, and a caption naming the chosen station. Per
the loading policy the selects go `disabled` while in flight (no component spinner);
errors and the two empty states ("no stations near here", "no data for this
station/parameter") use inline `<Alert>`.

## What it is not

- **Not stored, not owned, not shared.** Purely a live read — no Pod write, no
  persistence, no grant. Distinct both from the building's own energy (owned) and from
  buildings/aggregations shared *with* the user (granted, reached via `shared-in/`).
- **Not joined to energy.** It is a sibling section on the observation page;
  weather and consumption sit side by side but are not aligned or compared today.
