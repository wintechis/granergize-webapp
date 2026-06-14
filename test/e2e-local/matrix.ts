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
 * Running both lanes' heavy multi-pod specs at the same instant is SAFE (verified
 * 2026-06-14: a full simple-parallel run stayed green with the heavy `share-*` /
 * `peer-benchmark` specs overlapping across lanes). The apparent "contention" that
 * once timed the sharing specs out — and likely the old "no parallel Playwright"
 * rule — was a stale test locator (a `/review & share/i` that stopped matching the
 * "Review and Share" button after a UI-text change), not CPU starvation. So the lanes
 * just run their full suites in parallel; no spec-ordering games are needed.
 *
 * Run from the repo root. Exits non-zero if EITHER lane fails.
 */

const RUN_ID = Deno.env.get("E2E_RUN_ID") ??
  new Date().toISOString().replace(/\.\d+Z$/, "Z");

interface Lane {
  name: string;
  backend: "css" | "jss";
  offset: number;
}

// Port lanes are spaced 20 apart and each task owns one: offset 0 is the hand-driven
// dev:local stack (dev.ts), 40 is `handbuch`, 60 is `videos`, 80 is the single-lane
// automated suites (`it`, `e2e:local`). This parallel run needs TWO disjoint lanes at
// once, so it takes its own pair at 100/110 — clear of every single-lane task, so the
// matrix can run alongside any of them (including a live dev:local on offset 0). An
// offset clears all three Tier-3 ports (pod 3456, control 3457, app 4183), so the CSS
// lane at +100 binds 3556/3557/4283 and the JSS lane at +110 binds 3566/3567/4293.
const LANES: Lane[] = [
  { name: "css", backend: "css", offset: 100 },
  { name: "jss", backend: "jss", offset: 110 },
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
  // own `webServer` (per the config), so the lane is just `playwright test`. Any extra
  // CLI args (e.g. a spec path to run one spec on both lanes) are forwarded. Tee to a
  // per-lane log so the combined report can pull each lane's summary line.
  const extra = Deno.args.length ? " " + Deno.args.join(" ") : "";
  const t0 = performance.now();
  const { code } = await new Deno.Command("sh", {
    args: ["-c", `npx playwright test --project=local${extra} > ${log} 2>&1`],
    env,
  }).output();
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
    LANES.map((l) => `${l.name}@+${l.offset}`).join(", "),
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
