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

The backend is the **`@wintechis/wetterdienst-rdf-adapter`** (`WetterdienstClient`),
an RDF wrapper over **Deutscher Wetterdienst (DWD)** observation data.
`VITE_WEATHER_API_URL` selects it — dev points at the Vite proxy `/weather-api/`
(rewritten onto `wetterdienst-rdf-adapter.deno.dev` in `vite.config.ts`), prod at that
origin directly (`.env.development` / `.env.production`). The absolute form backs a
dev-mode `RdfSourceLink`, so the service is inspectable like a Pod resource.

## The query path — two steps, by proximity

`WeatherData.tsx` runs two plain React-Query reads — **not** WebID-namespaced and
**not** through the authed session, because this is neither user-specific nor Pod
data:

1. **Nearest stations** — `getStations({ provider: "dwd", network: "observation",
   parameters, latitude, longitude, rank: 5 })` returns the five closest DWD stations
   to the building's `lat`/`long`, distance-sorted; gated on the building having
   coordinates. So the building↔weather link is a **spatial join by proximity**, not
   containment or attribution — the station is typically kilometres away, and its
   distance (km) is shown in the picker.
2. **Recent values** — `getValues({ …, periods: "recent", station })` for the chosen
   station; gated until a station is selected. The closest station is auto-selected
   when a fresh list arrives (a during-render reset keyed on the list identity, not an
   effect).

Both reads opt into the global activity store (`beginActivity` / `endActivity`),
because the adapter fetch is not auto-wrapped the way `instrumentSessionFetch` wraps
the Solid session — so weather requests still surface in the header network indicator
(see [`architecture.md`](./architecture.md) and the network-activity section of
`CLAUDE.md`).

## What it shows

A **Weather** section on the building's observation page (`/observation/:id`,
`Energy.tsx`), shown whenever the building has coordinates — energy and weather
are the building's two observation layers (one owned on the Pod, one queried
live). Two selects — **parameter** and
**station** — over the annual DWD parameters the adapter exposes: mean temperature
(the default, °C), sunshine duration (h), precipitation (mm). Values render as a
small year / value / quality table, with a "Deutscher Wetterdienst (DWD)"
attribution, the dev-mode source link, and a caption naming the chosen station. Per
the loading policy the selects go `disabled` while in flight (no component spinner);
errors and the two empty states ("no stations near here", "no data for this
station/parameter") use inline `<Alert>`.

## What it is not

- **Not stored, not owned, not shared.** Purely a live read — no Pod write, no
  persistence, no grant. Distinct both from the building's own energy (owned) and from
  buildings/views shared *with* the user (granted, reached via `shared-in/`).
- **Not joined to energy.** It is a sibling section on the observation page;
  weather and consumption sit side by side but are not aligned or compared today.
