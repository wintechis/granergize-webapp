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

    deno task handbuch      # blank build → capture figures → rebuild PDF/DOCX

`deno task handbuch` runs the whole pipeline: a hermetic bundle build (it blanks
`VITE_OIDC_CLIENT_ID` so local logins don't dereference the deployed remote
client-id document), the screenshot capture (Playwright `--project=support`), then
the PDF/DOCX build. Its sibling `deno task videos` is the same shape for the demo
clips (capture `--project=video`, then trim/convert/concat).

The two tasks are **fully isolated** from each other and from a normal spec run, so
any of them may run concurrently. Each carries its own `LOCAL_PORT_OFFSET` (handbuch
40, videos 60; spec runs 0), which shifts its whole Tier-3 port set — pod, control
server, app preview — off the others, and builds into its own `--outDir`
(`dist-handbuch` / `dist-videos`, with `PREVIEW_OUTDIR` pointing the preview at it)
so the bundle builds never race on the shared `dist/`. The pod's data dir is a fresh
temp dir per boot, so that never collides either. To rebuild the document from the
existing figures without recapturing, run `bash docs/build-handbuch.sh` directly.

Recommended: ~1200px-wide light-theme PNGs; keep file sizes modest (they ship in
the static build). The shown URLs are then `localhost` (the local CSS); to capture
canonical `solidcommunity.net` URLs instead, run the same spec remotely against a
throwaway Pod (`source test/.env.e2e.local && deno task e2e:remote:spec
test/e2e/support/screenshots.spec.ts`).
