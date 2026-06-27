# design-sync notes — Granergize App

This repo is an **application** (`"name": "webapp"`, private, no published entry), not a
component library. The sync is deliberately **scoped**: the MUI **theme tokens** (the real
brand asset) plus the handful of presentational components that render standalone. The app's
other ~90 components need Solid-session / I18n / Confirm / dev-mode contexts and are excluded.

## How the build works here
- **Synth entry**: `.design-sync/entry.tsx` re-exports `GranergizeThemeProvider` + the 4 scoped
  components. The converter runs with `--entry ./.design-sync/entry.tsx --node-modules ./node_modules`
  (the repo's deno-managed `node_modules`, where `@mui/material`, `react`, `recharts` resolve).
- **Tokens**: `cfg.cssEntry` → `.design-sync/theme-tokens.css`, **generated** from `src/theme.ts`
  by `.design-sync/gen-tokens.ts` (= `cfg.buildCmd`). It uses MUI v9 `theme.generateStyleSheets()`
  (the theme has `cssVariables: true`), so the tokens are the authoritative `--mui-*` vars the
  components use at runtime. Re-run on re-sync if the theme changed.
- **Provider**: `cfg.provider = GranergizeThemeProvider` — required, since MUI styling is
  injected at runtime (CSS-in-JS); there is no static component stylesheet.
- **Render check**: chromium build 1228 is cached system-wide; `.ds-sync` has `playwright@1.61.1`
  (pins 1228). If the cache moves, install the matching playwright version.

## Re-sync risks (watch these)
- **Capture animation settle (FORK)**: `.ds-sync/package-capture.mjs` `settle()` was edited to add
  `await page.waitForTimeout(1600)` so Recharts' mount draw-animation finishes before the
  screenshot (otherwise the line charts capture mid-draw). The staged `.ds-sync/` is re-copied on
  re-sync, so **this edit is lost** — re-apply it (or the line-chart cards will look cut off). Not a
  durable override because `package-capture.mjs` is a top-level staged script, not a `lib/*.mjs`.
- **theme-tokens.css is generated** — never hand-edit; re-run `cfg.buildCmd`. It's committed so the
  converter has a real `cssEntry`, but it's a build artifact of `src/theme.ts`.
- **Scope is hand-curated** in `cfg.componentSrcMap` / `entry.tsx`. Adding a component means adding
  it to `entry.tsx` AND `componentSrcMap`; it must render with only `GranergizeThemeProvider`
  (no Solid/I18n/Confirm/dev-mode context) or it needs a richer `cfg.provider`.

## Known render warns
- `[RENDER_BLANK]` on TierDot's floor card was pre-authoring (a 10px dot) — resolved by the authored
  `Tiers` preview. `[GRID_OVERFLOW]` on the two charts is handled by `cfg.overrides.*.cardMode: column`.
