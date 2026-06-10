import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { LOCAL_APP_PORT } from "./test/config/localSeed.ts";
import { providerIdForIssuer } from "./test/config/providers.ts";

/**
 * Playwright config for the browser tiers: Tier 4 drives Chromium against real Pods
 * (`deno task e2e:remote`, or `e2e:remote:spec` for one spec); Tier 3 reuses the same
 * specs against a throwaway local CSS, credential-free (`deno task e2e:local`, the
 * `local` project, E2E_LOCAL=1). Tiers 1
 * (deno test) and 2 (deno task it) are separate. `login.spec.ts` runs with no creds;
 * credentialed (Tier-4) specs self-skip.
 */
// Tier 3 (browser × local CSS): boot a throwaway CSS and run the specs against it,
// credential-free (E2E_LOCAL=1, via `deno task e2e:local`). Off for real-Pod runs.
const LOCAL = !!process.env.E2E_LOCAL;
// Tier 5 (deployed smoke): drive the PUBLISHED app at this URL instead of a
// locally served build — no app webServer is started. `deno task e2e:deployed`.
const DEPLOYED = process.env.E2E_DEPLOYED_URL;
// Tier 3 serves the app on LOCAL_APP_PORT; Tier 4 (real Pods) on 4173.
const PORT = LOCAL ? LOCAL_APP_PORT : 4173;

// Per-run id so successive runs of the SAME tier+backend don't overwrite each
// other — Playwright wipes a test's output folder at the start of each run, so
// without this you'd only ever keep the latest run. A second-resolution ISO 8601
// UTC timestamp (not a UUID) so runs sort chronologically and "latest vs previous"
// is obvious; override with E2E_RUN_ID to label a run (e.g. `before-fix`). Stamped
// onto process.env so it's stable across the config's main + worker evaluations.
// (`new Date()` is fine here — the config runs under Node via `npx playwright`.)
// Colons are legal in paths on Linux; quote the dir in shell (e.g. show-report).
if (!process.env.E2E_RUN_ID) {
  process.env.E2E_RUN_ID = new Date().toISOString().replace(/\.\d+Z$/, "Z");
}
const RUN_ID = process.env.E2E_RUN_ID;

// Artifacts (traces, attachments) go to a tier+backend+run scoped folder so
// `test-results/` stays interpretable and independent: a Tier-3 run never
// intermingles with a Tier-4 run; a CSS run never overwrites a JSS run (both use
// the same `local` project → identical leaf paths); and a re-run never clobbers
// the prior run of the same config.
//   Tier 4 (real Pods)      → test-results/tier-4-<pod>/<run>
//   Tier 3 local CSS / JSS  → test-results/tier-3-css/<run> | tier-3-jss/<run>
//   bench                   → test-results/bench-css/<run> | bench-jss/<run>
const BACKEND = process.env.LOCAL_POD_SERVER === "jss" ? "jss" : "css";
// Tier 4 runs against real Pods, and two different Pods can run back-to-back
// (e.g. meisdata then redpencil). Label the scope by the Pod — the provider of
// account A — so they land in DISTINCT dirs (`tier-4-redpencil` vs
// `tier-4-solidweb`) instead of colliding in one `tier-4/` and overwriting each
// other's traces even when they share a RUN_ID. Resolution mirrors `account()`:
// explicit `E2E_POD_LABEL` (a friendly name like `meisdata`) wins, else the
// provider id of `E2E_PROVIDER_A` / `E2E_ISSUER_A`, else bare `tier-4`.
const TIER4_POD = process.env.E2E_POD_LABEL ||
  process.env.E2E_PROVIDER_A ||
  providerIdForIssuer(process.env.E2E_ISSUER_A);
const SCOPE = process.env.E2E_BENCH
  ? `bench-${BACKEND}`
  : DEPLOYED
  ? "deployed"
  : LOCAL
  ? `tier-3-${BACKEND}`
  : TIER4_POD
  ? `tier-4-${TIER4_POD}`
  : "tier-4";
const RESULTS_DIR = `test-results/${SCOPE}/${RUN_ID}`;

// Tier 4 (real Pods): write each run to a UNIQUE app collection
// (`granergize-e2e-<uuid>`) so leftover/stuck resources from an earlier run — e.g.
// a Pod request that hung mid-cleanup — can never impede a fresh run; there is no
// reset step to depend on. Set here so the dev server (started below) bakes it into
// the app, and the value is read at server start (`reuseExistingServer: false` for
// Tier 4 so each run gets its own segment). Tier 3 keeps a fixed segment baked at
// build time (its throwaway local CSS is wiped per spec). An explicit
// VITE_POD_APP_DIR always wins — set it to target a specific collection.
if (!LOCAL && !process.env.VITE_POD_APP_DIR) {
  process.env.VITE_POD_APP_DIR = `granergize-e2e-${randomUUID()}`;
}

const CHROME = { ...devices["Desktop Chrome"] };
const SOLO_SPECS = [
  "**/login.spec.ts",
  "**/organisation.spec.ts",
  "**/add-building.spec.ts",
  "**/attachments.spec.ts",
  "**/edit-building-fields.spec.ts",
  "**/excel-import.spec.ts",
  "**/excel-export.spec.ts",
  "**/energy-entry.spec.ts",
  "**/materialised-views.spec.ts",
  "**/map-energy-lens.spec.ts",
  "**/data-room.spec.ts",
  "**/building-details.spec.ts",
  "**/contacts.spec.ts",
  "**/archive-restore.spec.ts",
  "**/uri-state.spec.ts",
  "**/building-form-and-energy.spec.ts",
];
const SHARING_SPECS = [
  "**/share-building.spec.ts",
  "**/share-view.spec.ts",
  "**/share-files.spec.ts",
  "**/peer-benchmark.spec.ts",
];

export default defineConfig({
  testDir: "./test/e2e",
  // Tier 3 only (self-gates on E2E_LOCAL): at run end, stop the throwaway Pod
  // server via the control server's `POST /stop`, so its shutdown is owned by
  // Playwright's lifecycle and it doesn't leak past the run. The server is spawned
  // under `setsid`, so a process-tree kill on teardown wouldn't reap it.
  globalTeardown: "./test/e2e-local/globalTeardown.ts",
  // Per-test traces go in a `traces/` subdir of the per-run dir, so the HTML report
  // can sit beside them as a sibling `html/` — Playwright errors if the HTML output
  // folder is inside (or contains) outputDir. Tier+backend+run scoped (see above).
  outputDir: `${RESULTS_DIR}/traces`,
  // Serial (1 worker → no cross- or in-file parallelism). Fanning spec files across
  // workers logs into the SAME Pod host concurrently, which trips Cloudflare throttling
  // (429/503 as CORS, mid-test OIDC re-auth, multi-minute timeouts); the local tier
  // also shares ONE CSS with a per-spec /reset, so parallel workers would race it. The
  // two roles (A/B) run their specs in sequence.
  workers: 1,
  retries: 0, // no retries: a flaky pass is a bug to fix, not to mask
  // `list` → live stdout (ephemeral). `html`/`json` persist a durable record into the
  // per-run dir: `html/` is browsable (`npx playwright show-report <dir>/html`),
  // `report.json` is the machine-readable index (each test's id/title/file:line/status +
  // its trace `attachments[].path`) — so the opaque artifact-folder hash is resolvable to
  // a test and runs are diffable. Both emit on every run (pass or fail). `cf1015Reporter`
  // aborts the instant a Cloudflare-fronted Pod answers Error 1015 (rate limited) — note a
  // 1015 abort calls process.exit before onEnd, so it leaves no html/json (only real Pods).
  reporter: [
    ["list"],
    ["html", { outputFolder: `${RESULTS_DIR}/html`, open: "never" }],
    ["json", { outputFile: `${RESULTS_DIR}/report.json` }],
    ["./test/e2e/cf1015Reporter.ts"],
  ],
  use: {
    baseURL: DEPLOYED ?? `http://localhost:${PORT}`,
    // Capture a trace for every test and keep it on failure — so the FIRST failure
    // always yields a trace, no retry needed (unlike `on-first-retry`, which writes
    // nothing on a retries=0 run).
    trace: "retain-on-failure",
  },
  /**
   * Specs split into functional projects. The two roles are A = Alice and B = Bob;
   * configure their Pods/WebIDs per run by `source`-ing an env file (see test/README.md):
   *  - `solo`    — single-account specs; run against Alice (account A).
   *  - `sharing` — cross-Pod specs; use the A+B pair (Alice + Bob).
   *  - `support` — handbuch screenshots (account A / Alice).
   *  - `local`   — TIER 3: solo + sharing specs against a throwaway local CSS, no
   *                creds (only present when E2E_LOCAL=1; the seeded A/B pods
   *                interoperate, so sharing runs in-browser too). `deno task e2e:local`.
   * `deno task e2e:remote` runs solo + sharing; `e2e:remote:spec --project=<name>`
   * (or a spec path) selects one. `support` is excluded from the full run.
   */
  projects: [
    { name: "solo", use: CHROME, testMatch: SOLO_SPECS },
    { name: "sharing", use: CHROME, testMatch: SHARING_SPECS },
    { name: "support", use: CHROME, testMatch: ["**/support/**/*.spec.ts"] },
    // Gated on E2E_LOCAL so the default/real-Pod runs don't re-run these specs
    // (they'd duplicate solo+sharing). Selected via `--project=local`.
    ...(LOCAL
      ? [{ name: "local", use: CHROME, testMatch: [...SOLO_SPECS, ...SHARING_SPECS] }]
      : []),
    // Tier-3 scalability BENCHMARK (measure-and-report). Gated on E2E_BENCH so it
    // never runs in the normal suite, and needs E2E_LOCAL too (it seeds via the
    // local-CSS control server). `deno task bench:ui`. `--project=bench`.
    ...(process.env.E2E_BENCH
      ? [{ name: "bench", use: CHROME, testMatch: ["**/bench/**/*.spec.ts"] }]
      : []),
    // Diagnostic STRESS probes (currently the JSS concurrent-login hammer).
    // Gated on LOGIN_STRESS like bench/deployed — absent the switch the spec
    // isn't even collected, so catalog runs report zero skips and any skip
    // that DOES appear is a real signal (a capability gate firing). The
    // `e2e:stress` / `e2e:stress:jss` tasks set the var AND select the project.
    ...(process.env.LOGIN_STRESS
      ? [{
        name: "stress",
        use: CHROME,
        testMatch: ["**/login-stress.spec.ts"],
      }]
      : []),
    // Tier 5: smoke against the PUBLISHED app (E2E_DEPLOYED_URL is the baseURL;
    // no webServer). `deno task e2e:deployed`. `--project=deployed`.
    ...(DEPLOYED
      ? [{
        name: "deployed",
        use: CHROME,
        testMatch: ["**/deployed-smoke.spec.ts"],
      }]
      : []),
  ],
  // The Vite app (except for the deployed smoke, which targets the published
  // URL); plus the throwaway CSS when running the local tier.
  webServer: [
    ...(DEPLOYED ? [] : [{
      // Tier 3 (local) serves the production build (`deno task build` runs first in
      // the task) to rule out Vite-dev/HMR artifacts; Tier 4 (remote) uses the dev
      // server. Keyed off LOCAL — no separate E2E_PREVIEW knob.
      command: LOCAL
        ? `deno run -A npm:vite preview --port ${PORT} --strictPort`
        : `deno run -A npm:vite dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      // NEVER reuse the app server, either tier. Tier 4: each run bakes its own
      // unique VITE_POD_APP_DIR (above) into a freshly-started dev server, so a
      // reused one would serve the wrong collection. Tier 3: `vite preview`
      // (sirv, production mode) snapshots dist/ into memory AT STARTUP — a
      // leftover preview from an earlier invocation keeps serving THAT build no
      // matter what the current run's `deno task build` just produced.
      // Trace-proven (2026-06-10): a zombie preview served a stale bundle whose
      // baked remote VITE_OIDC_CLIENT_ID made every local login dereference a
      // flaky university host → the suite collapsed mid-run. A fresh preview of
      // the fresh build is the only way the served app is the one just built.
      reuseExistingServer: false,
      timeout: 120_000,
    }]),
    ...(LOCAL
      ? [{
        command: "deno run -A test/e2e-local/css.ts",
        // Wait on the control server's health (port 3457): it starts listening only
        // AFTER startLocalCss() resolves (CSS booted + SEEDED), so this one wait
        // guarantees CSS is ready AND the per-spec `/reset` endpoint is up (no
        // first-spec race against seeding or against the control server).
        url: "http://localhost:3457/",
        // Reuse a still-running control server (faster re-runs); the run's own
        // `globalTeardown` stops it at the end via `POST /stop` (see above), so it
        // doesn't leak. A leftover from a hard-killed earlier run is adopted here
        // and then stopped by this run's teardown.
        reuseExistingServer: true,
        timeout: 90_000,
      }]
      : []),
  ],
});
