# PVGIS yield grid (bundled) ↔ our model

PVGIS v5.2 (EU JRC, `re.jrc.ec.europa.eu`) is the source of the photovoltaic
specific-yield grid the app uses to turn roof geometry into expected kWh. **Not a
live external fetch** — a single pre-computed cell is *baked into the repo* as
`src/services/sources/pvgisGridData.ts` and read through `src/services/sources/pvgisGrid.ts`.
Listed here as its own source id for provenance, though it ships as static data.

## What it is

A parametric lookup table: specific yield (kWh/kWp/yr) as a function of roof
**tilt** (0–90°) and **azimuth** (PVGIS convention 0=S, ±180=N), for one pilot
cell (lat 49.464, lon 11.117 — the Nürnberg area). `specificYield(tilt, azimuth)`
does bilinear interpolation over the grid; `lod2ToPvgisAspect()` converts the
LoD2 orientation convention to PVGIS's.

## Relation to our model

Pure derivation input, not an entity: it supplies the per-roof yield factor in
`rooftopPv.ts`, so its values land embedded in a building's computed `<#pv>`
annual-kWh figure (see `lod2-by.md`). It is not RDF, has no IRIs, no
thing/document split, and nothing of it is stored on the Pod.

## Provenance

PVGIS v5.2, credited in the data file's header comment only. The grid is
**single-cell** (Nürnberg pilot) — a national rollout would key the grid by
location (or query PVGIS live) rather than reuse one cell. Regenerate from the
PVGIS source if the pilot cell or PVGIS version changes.
