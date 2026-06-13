/// <reference lib="deno.ns" />
/**
 * CSS↔JSS lane parallelism (plans/plan-e2e-speedup.md): run the two Tier-3 backend
 * suites CONCURRENTLY against ONE prebuilt app bundle, instead of back-to-back.
 *
 * The app bundle is backend-agnostic — the backend is chosen at runtime by which
 * issuer the browser logs into, not at build time — so the caller builds `dist/`
 * ONCE before invoking this (the `e2e:local:matrix` task does), and each lane serves
 * that same `dist/` from its own `vite preview`. The lanes are otherwise fully
 * independent: disjoint pod/control/app ports via `LOCAL_PORT_OFFSET`, distinct
 * result dirs (playwright.config scopes by backend → `tier-3-css` vs `tier-3-jss`),
 * separate accounts/servers. Both reset per spec with the fast in-place `/wipe`
 * (`E2E_RESET=wipe`). Nothing is shared but CPU — the idle slack this exploits.
 *
 * ANTI-PHASING: the shared resource (CPU) is scarce exactly when both lanes run a
 * heavy multi-pod spec — several concurrent OIDC logins each — at the same instant;
 * run together that starved the sharing specs into timeouts. So each lane runs the
 * suite in TWO phases, light (`SOLO_SPECS`) and heavy (`DUO`+`TRIO`), in the OPPOSITE
 * order: one lane light→heavy, the other heavy→light. The short heavy phases land at
 * opposite ends of the long run and never overlap; whenever one lane is in its heavy
 * phase the other is in light (single-login, contention-tolerant) work. A single
 * Playwright invocation can't reorder within itself (alphabetical, no shuffle), hence
 * two invocations per lane. A targeted single-spec run (CLI args) bypasses phasing.
 *
 * Run from the repo root. Exits non-zero if EITHER lane fails.
 */
import { DUO_SPECS, SOLO_SPECS, TRIO_SPECS } from "../config/specCatalog.ts";

// Glob `**/foo.spec.ts` → `foo.spec.ts`, a `playwright test` positional file filter.
const basename = (glob: string) => glob.replace(/^\*\*\//, "");
const LIGHT_PHASE = SOLO_SPECS.map(basename);
const HEAVY_PHASE = [...DUO_SPECS, ...TRIO_SPECS].map(basename);

// Anti-phasing is on by default. `E2E_ANTIPHASE=0` runs each lane as ONE plain
// invocation (no light/heavy split) — the experiment for whether the heavy specs
// actually contend across lanes now that the stale-locator "hang" is fixed (the
// "contention" that motivated anti-phasing turned out to be that bug). If a plain
// parallel run stays green, anti-phasing is needless overhead and can be retired.
const ANTIPHASE = (Deno.env.get("E2E_ANTIPHASE") ?? "1") !== "0";

const RUN_ID = Deno.env.get("E2E_RUN_ID") ??
  new Date().toISOString().replace(/\.\d+Z$/, "Z");

interface Lane {
  name: string;
  backend: "css" | "jss";
  offset: number;
  // Anti-phase the heavy multi-pod specs: one lane runs them first, the other last,
  // so they never overlap across lanes (see ANTI-PHASING above).
  heavyFirst: boolean;
}

// Offset clears all three Tier-3 ports (pod 3456, control 3457, app 4183), so the
// JSS lane at +10 binds 3466/3467/4193 — disjoint from the CSS lane at +0.
const LANES: Lane[] = [
  { name: "css", backend: "css", offset: 0, heavyFirst: false },
  { name: "jss", backend: "jss", offset: 10, heavyFirst: true },
];

const logPath = (name: string) => `/tmp/e2e-matrix-${name}-${RUN_ID}.log`;

async function runLane(
  lane: Lane,
): Promise<{ lane: Lane; code: number; ms: number; log: string }> {
  const log = logPath(lane.name);
  const env: Record<string, string> = {
    ...Deno.env.toObject(),
    E2E_LOCAL: "1",
    E2E_RESET: "wipe",
    // The browser build bakes VITE_POD_APP_DIR; the control server (Deno) reads it
    // from the runtime env, so it must be set here too or `/wipe` would clear the
    // wrong (default `granergize/`) collection while the app uses `granergize-e2e/`.
    VITE_POD_APP_DIR: "granergize-e2e",
    LOCAL_POD_SERVER: lane.backend,
    LOCAL_PORT_OFFSET: String(lane.offset),
    E2E_RUN_ID: RUN_ID,
  };
  // `vite preview` of the prebuilt dist/ + the pod server are started by Playwright's
  // own `webServer` (per the config), so a phase is just `playwright test` filtered to
  // that phase's spec files. A targeted run (CLI args, e.g. one spec on both lanes)
  // bypasses anti-phasing and runs as-is; otherwise the two phases run in this lane's
  // order. Each phase's Playwright is a fresh invocation (the only way to control order
  // — see ANTI-PHASING), so its own webServer reboots between phases; tolerated for the
  // contention win. Tee both phases to one per-lane log so summarize() finds each
  // phase's summary line.
  const phases: { label: string; files: string[] }[] = Deno.args.length
    ? [{ label: "run", files: Deno.args }]
    : !ANTIPHASE
    ? [{ label: "all", files: [] }] // one plain invocation, no file filter
    : lane.heavyFirst
    ? [{ label: "heavy", files: HEAVY_PHASE }, {
      label: "light",
      files: LIGHT_PHASE,
    }]
    : [{ label: "light", files: LIGHT_PHASE }, {
      label: "heavy",
      files: HEAVY_PHASE,
    }];

  const t0 = performance.now();
  let code = 0;
  for (let i = 0; i < phases.length; i++) {
    const { label, files } = phases[i];
    const redirect = i === 0 ? ">" : ">>"; // first phase truncates, rest append
    const marker = `=== lane ${lane.name} phase ${
      i + 1
    }/${phases.length}: ${label} ===`;
    const { code: phaseCode } = await new Deno.Command("sh", {
      args: [
        "-c",
        `echo "${marker}" ${redirect} ${log} 2>&1; ` +
        `npx playwright test --project=local ${files.join(" ")} >> ${log} 2>&1`,
      ],
      env,
    }).output();
    // Lane fails if ANY phase fails, but keep running later phases for full diagnostics.
    if (phaseCode !== 0) code = phaseCode;
  }
  const ms = performance.now() - t0;
  const text = await Deno.readTextFile(log).catch(() => "");
  return { lane, code, ms, log: text };
}

// Playwright's list reporter prints e.g. "  42 passed (19.8m)" / "  5 failed".
function summarize(log: string): string {
  const lines = log.split("\n")
    .filter((l) => /\b\d+ (passed|failed|flaky|skipped|did not run)\b/.test(l))
    .map((l) => l.trim());
  return lines.length
    ? lines.join(" / ")
    : "(no summary line — lane likely crashed)";
}

console.log(
  `matrix: launching ${LANES.length} lanes in parallel (run ${RUN_ID}) — ` +
    LANES.map((l) =>
      `${l.name}@+${l.offset} (${
        !ANTIPHASE ? "simple" : l.heavyFirst ? "heavy→light" : "light→heavy"
      })`
    ).join(", "),
);
const results = await Promise.all(LANES.map(runLane));

console.log("\n==================== MATRIX RESULTS ====================");
let failed = false;
for (const r of results) {
  if (r.code !== 0) failed = true;
  console.log(
    `${r.lane.name.toUpperCase().padEnd(4)} exit=${r.code} ` +
      `wall=${(r.ms / 60000).toFixed(1)}m  ${summarize(r.log)}`,
  );
  console.log(`     log: ${logPath(r.lane.name)}`);
}
console.log("========================================================");
Deno.exit(failed ? 1 : 0);
