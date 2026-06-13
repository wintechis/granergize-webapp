# Figures for the Praxishandbuch

These images are embedded in the Praxishandbuch (`docs/handbuch.md`) and bundled
into the generated `public/granergize-handbuch.{pdf,docx}` via `deno task handbuch`.

Two kinds of figures live here:

- **App screenshots** — captured from the running app by
  `test/e2e/support/screenshots.spec.ts`: `anmelden.png`, `erster-start.png`,
  `room.png`,
  `contacts.png`, `add-building.png`, `manage-actions.png`, `energy-year.png`,
  `share-building.png`, `create-view.png`, `aggregated-view.png`, `map-tabs.png`,
  `energy-data-tab.png`, `energy-detail.png`, `energy-lens.png`,
  `benchmark-share-back.png`, `benchmark-payoff.png`, `shared-with-you.png`,
  `teilen-payoff.png`, `soll-ist-payoff.png`.
- **Actor identity images** — the example ensemble introduced in the use-case
  chapter: `alice-avatar.png`, `bob-avatar.png`, `charlie-avatar.png` (copied
  from `test/e2e/fixtures/`) and `ahlmann-logistik-logo.png`,
  `bauer-grundbesitz-logo.png`, `conrad-kennwert-logo.png` (rendered from the
  SVG fixtures via `rsvg-convert -h 240`). Regenerate after changing the
  fixtures.
- **Conceptual diagrams** — carried over from the original handbuch (still
  accurate): `architektur.png`, `wac.png`, `wissensgraph.png`,
  `sharing-vergleich.png`. The two scenario diagrams `szenario-teilen.png` and
  `szenario-benchmark.png` have TikZ sources in `src/`; rebuild them with
  `src/build.sh` (needs pdflatex + pdftoppm).

To refresh the screenshots after UI changes, run the capture **credential-free
against the throwaway local CSS** (Tier 3) and rebuild the handbuch:

    deno task handbuch:full      # build once → capture figures → rebuild PDF/DOCX

`handbuch:full` chains the steps via task dependencies. The bundle build is the
separate `handbuch:capture:build` task, so the screenshot capture
(`handbuch:figures`, Playwright `--project=support`) and the video capture
(`handbuch:videos`, `--project=video`) can **run in parallel** over one shared
build — `deno task handbuch:capture` does both at once. Each capture lane carries
a distinct `LOCAL_PORT_OFFSET` (figures 0, videos 20) so their Tier-3 pod /
control / app servers bind disjoint ports and never collide. Run a single lane
on its own (`deno task handbuch:figures`) and the build dependency still runs
first automatically (deduped, so a combined run builds only once).

Recommended: ~1200px-wide light-theme PNGs; keep file sizes modest (they ship in
the static build). The shown URLs are then `localhost` (the local CSS); to capture
canonical `solidcommunity.net` URLs instead, run the same spec remotely against a
throwaway Pod (`source test/.env.e2e.local && deno task e2e:remote:spec
test/e2e/support/screenshots.spec.ts`).
