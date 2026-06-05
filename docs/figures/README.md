# Figures for the Praxishandbuch

These images are embedded in the Praxishandbuch (`docs/handbuch.md`) and bundled
into the generated `public/granergize-handbuch.{pdf,docx}` via `deno task handbuch`.

Two kinds of figures live here:

- **App screenshots** — captured from the running app by
  `e2e/screenshots.spec.ts` (account C, solidcommunity.net, so the shown URLs are
  canonical): `anmelden.png`, `room.png`, `add-building.png`, `energy-year.png`,
  `share-building.png`, `create-view.png`, `map-tabs.png`.
- **Conceptual diagrams** — carried over from the original handbuch (still
  accurate): `architektur.png`, `wac.png`, `wissensgraph.png`,
  `sharing-vergleich.png`.

To refresh the screenshots after UI changes, run the screenshots spec
(`source .env.e2e.local && deno task e2e e2e/screenshots.spec.ts`), then rebuild
the handbuch (`deno task handbuch`). Recommended: ~1200px-wide light-theme PNGs;
keep file sizes modest (they ship in the static build).
