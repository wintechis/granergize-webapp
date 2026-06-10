# Figures for the Praxishandbuch

These images are embedded in the Praxishandbuch (`docs/handbuch.md`) and bundled
into the generated `public/granergize-handbuch.{pdf,docx}` via `deno task handbuch`.

Two kinds of figures live here:

- **App screenshots** — captured from the running app by
  `test/e2e/support/screenshots.spec.ts`: `anmelden.png`, `room.png`,
  `contacts.png`, `add-building.png`, `manage-actions.png`, `energy-year.png`,
  `share-building.png`, `create-view.png`, `aggregated-view.png`, `map-tabs.png`,
  `energy-data-tab.png`, `energy-detail.png`, `energy-lens.png`,
  `shared-with-you.png`.
- **Conceptual diagrams** — carried over from the original handbuch (still
  accurate): `architektur.png`, `wac.png`, `wissensgraph.png`,
  `sharing-vergleich.png`.

To refresh the screenshots after UI changes, run the capture **credential-free
against the throwaway local CSS** (Tier 3) and rebuild the handbuch:

    deno task handbuch:figures   # build + E2E_LOCAL=1 playwright --project=support
    deno task handbuch

Recommended: ~1200px-wide light-theme PNGs; keep file sizes modest (they ship in
the static build). The shown URLs are then `localhost` (the local CSS); to capture
canonical `solidcommunity.net` URLs instead, run the same spec remotely against a
throwaway Pod (`source test/.env.e2e.local && deno task e2e:remote:spec
test/e2e/support/screenshots.spec.ts`).
