# Granergize App — design system

The Granergize App browses and compares building **energy data** held on user-controlled Solid Pods. It is a **Material UI (MUI) v9** application with a custom theme. Build designs from MUI primitives styled by the Granergize theme, plus the few app-specific components listed below.

## Wrapping — required

Wrap every design in **`GranergizeThemeProvider`** (exported from the bundle). It applies the brand theme: the palette, a deliberately narrow three-tier type scale, rem-based spacing, and component defaults (outlined Cards, flat/disable-elevation Buttons, small Chips). Without it, MUI components fall back to the stock Material theme and look off-brand.

```jsx
import { GranergizeThemeProvider, MetricBarChart } from '<bundle>';
import { Box, Button, Card, Typography } from '@mui/material';

<GranergizeThemeProvider>
  <Card sx={{ p: 3 }}>
    <Typography variant="h5">Nordostpark 84</Typography>
    <MetricBarChart data={rows} bars={series} yUnit="kWh" />
    <Button variant="contained">Share</Button>
  </Card>
</GranergizeThemeProvider>
```

## Styling idiom — MUI props, not utility classes

There are **no CSS class names**. Style via MUI's `sx` prop and theme-aware values:
- **Spacing** is the rem scale (8px-equivalent at the base font): `sx={{ p: 3, gap: 2, mt: 1 }}` — 3 = section gap, 2 = related elements, 1 = tight.
- **Color** comes from the theme: `color="primary"`, `color="text.secondary"`, `color="error"` — never a hardcoded hex.
- **Typography** is one variant per role: page title `h5`, section header `h6`, body `body1`, secondary/help `body2` + `color="text.secondary"`, caption `caption`. The scale is intentionally calm (three tiers, all headings weight 600).
- Primary button = `variant="contained"`, secondary = `outlined`, tertiary = `text`; at most one contained per section.

The brand tokens are CSS custom properties in `styles.css` (`:root`), e.g. `--mui-palette-primary-main: #0277bd`, `--mui-palette-secondary-main: #388e3c`, the `--mui-palette-{error,warning,success}-main` set, `--mui-shadows-*`, and `--mui-shape-borderRadius`. Reference these in any custom CSS so it matches the components. Read `styles.css` for the full set before styling.

## Brand palette
- Primary — energy-infrastructure blue: `#0277bd`
- Secondary — sustainability/renewables green: `#388e3c`
- Error `#c62828` · Warning `#e65100` · Success `#2e7d32`
- Background `#f5f7fa` · Paper (cards) `#ffffff`

## Feature colour tokens (the `--gr-*` family)

For the app's data-visualisation surfaces, `styles.css` (`:root`) also defines a `--gr-*` family beyond the MUI palette — reference these (never re-pick) so a design's map, lens and chart colours match the app:
- **Map markers** — `--gr-marker-owned` (blue), `--gr-marker-shared` (orange), `--gr-marker-open` (green), `--gr-marker-no-data` (grey).
- **Energy lens** (efficiency tier) — `--gr-energy-below` (efficient/green), `--gr-energy-typical` (amber), `--gr-energy-above` (inefficient/red).
- **Regional-statistics choropleth** (magnitude, low→high) — `--gr-magnitude-low` / `-mid` / `-high` (single-hue blue; carries no good/bad meaning).
- **Trend lens** — `--gr-trend-improving` (blue) / `-flat` (grey) / `-worsening` (orange).
- **Per-metric chart series** — `--gr-metric-{electricity,heat,water,wastewater,renewable,generation,planned}`.

## App surfaces to design for

Recently documented in the user handbook; design for these using the tokens above:
- **Map + energy lens** — buildings on a Leaflet map, markers tinted efficient→inefficient.
- **Regional statistics** — official open-data benchmarks for a building's region (German AGS / EU LAU codes), shown as a table and a magnitude choropleth beside the building's own figures.
- **Command palette** — a ⌘K/Ctrl+K launcher for every action and for natural-language building queries: a search field over a grouped command list, plus a schema-driven parameter form.

## Components (see each `.prompt.md` + `.d.ts`)
- **GranergizeThemeProvider** — the theme wrapper (above).
- **TierDot** — `tier="mine" | "shared" | "open"`: a colour-coded source dot (owned blue / shared orange / open green), shown beside a finder item.
- **Pager** — `paging={{ page, pageCount, total, pageItems, setPage }}`: list pagination with an "x–y of N" summary (renders nothing for a single page).
- **MetricBarChart** / **MetricLineChart** — Recharts energy charts. `data` is one row per category/point; `bars`/`lines` describe each series as `{ key, name, color }`; `yUnit` labels the axis; `hideLegend` for single-series.
