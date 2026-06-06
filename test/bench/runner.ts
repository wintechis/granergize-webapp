/// <reference lib="deno.ns" />
/**
 * Tier-2 scalability/performance BENCHMARK (`deno task bench`). Boots ONE throwaway
 * local CSS with two seeded actors (A, B) — same substrate as the headless tier —
 * then sweeps a size axis and TIMES the real data-layer paths as the data grows:
 *
 *   D1 buildings — fetchAndParseData() vs # of owned buildings (the listing+parse).
 *   D2 series    — list + parse a PT15M series vs # of daily files (UserEnergyChart path).
 *   D3 shared    — getSharedWithMe()+fold vs # of buildings shared in from B.
 *
 * Measure-and-report: it records medians, writes gnuplot `.dat` + `.gp` into
 * test/bench/results/, and renders PNGs when gnuplot is on PATH (else prints a hint).
 * Nothing here asserts a time budget — hardware variance makes that flaky; the
 * graphs are the deliverable (paper figures).
 *
 *   deno task bench                       # defaults (buildings 10..100)
 *   BENCH_SIZES=0,100,200 deno task bench # custom sweep
 *   deno task bench:plot                  # re-render PNGs from existing .dat (after installing gnuplot)
 */
import { getLiveSession, type LiveSessionLike } from "../headless/liveSession.ts";
import { type LocalCss, startLocalCss } from "../headless/localCss.ts";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { resolveStorageRoot, podResources } from "../../src/services/utils/solidUtils.ts";
import { ensureOwnInbox } from "../../src/services/interop/inbox.ts";
import { fetchAndParseData } from "../../src/services/TurtleParsingService.ts";
import { getSharedWithMe } from "../../src/services/interop/sharingManager.ts";
import { listDirectChildren } from "../../src/services/utils/podDelete.ts";
import { parseTtlReadings } from "../../src/services/utils/userEnergyParser.ts";
import {
  type BenchActor,
  seedBuildings,
  seedSeriesBuilding,
  seedSharedBuildings,
  wipeBuildings,
} from "./seed.ts";
import { measure, RESULTS_DIR, writeDat } from "./report.ts";
import { regenerateAndRender } from "./plots.ts";

/** Parse a `BENCH_*` size list ("0,50,100"), falling back to `def`. */
function sizes(envVar: string, def: number[]): number[] {
  const raw = Deno.env.get(envVar);
  if (!raw) return def;
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

// Modest defaults — the throwaway local CSS gets unstable under heavy seeding, so
// the sweeps stay small (10…100). Raise via the BENCH_* env vars on a sturdier
// server. Sharing/series are heavier per item (ACL writes / daily files), so their
// defaults are a touch lighter still.
const BUILDING_SIZES = sizes("BENCH_SIZES", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const SERIES_DAYS = sizes("BENCH_SERIES_DAYS", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const SHARED_SIZES = sizes("BENCH_SHARED_SIZES", [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
const RUNS = Number(Deno.env.get("BENCH_RUNS") ?? "3");

const perItem = (total: number, n: number): number => (n > 0 ? total / n : 0);

console.log("starting local CSS…");
const css: LocalCss = await startLocalCss().catch((e): never => {
  console.error(`FAIL — could not start local CSS:\n${e}`);
  return Deno.exit(1);
});
console.log(`local CSS up at ${css.baseUrl}`);

let sA: LiveSessionLike | undefined;
let sB: LiveSessionLike | undefined;
try {
  const issuer = css.baseUrl.replace(/\/$/, "");
  [sA, sB] = await Promise.all([
    getLiveSession(issuer, css.A.email, css.A.password, css.A.webId),
    getLiveSession(issuer, css.B.email, css.B.password, css.B.webId),
  ]);
  const sessionA = sA as unknown as Session;
  const sessionB = sB as unknown as Session;
  await resolveStorageRoot(sessionA);
  await resolveStorageRoot(sessionB);
  await ensureOwnInbox(sessionA);
  await ensureOwnInbox(sessionB);
  const a: BenchActor = { webId: sessionA.info.webId!, session: sessionA };
  const b: BenchActor = { webId: sessionB.info.webId!, session: sessionB };
  console.log(`A = ${a.webId}\nB = ${b.webId}\nruns/median = ${RUNS}\n`);

  // ── D1: fetchAndParseData vs # owned buildings ───────────────────────────────
  console.log(`D1 buildings: ${BUILDING_SIZES.join(", ")}`);
  {
    const rows: number[][] = [];
    for (const n of BUILDING_SIZES) {
      await wipeBuildings(sessionA, a.webId);
      await seedBuildings(sessionA, a.webId, n);
      let parsed = 0;
      const ms = await measure(async () => {
        parsed = (await fetchAndParseData(sessionA)).buildings.length;
      }, RUNS);
      rows.push([n, ms, perItem(ms, n), parsed]);
      console.log(`  n=${n}  ${ms.toFixed(1)} ms  (${perItem(ms, n).toFixed(2)} ms/bldg, parsed ${parsed})`);
    }
    await writeDat(RESULTS_DIR, "buildings", ["n_buildings", "total_ms", "ms_per_building", "parsed"], rows);
    await wipeBuildings(sessionA, a.webId);
  }

  // ── D2: list + parse a PT15M series vs # daily files ─────────────────────────
  console.log(`D2 series (days): ${SERIES_DAYS.join(", ")}`);
  {
    const rows: number[][] = [];
    for (const days of SERIES_DAYS) {
      await wipeBuildings(sessionA, a.webId);
      const { seriesContainer } = await seedSeriesBuilding(sessionA, a.webId, days);
      const ms = await measure(async () => {
        const children = (await listDirectChildren(seriesContainer, sessionA)) ?? [];
        const daily = children.filter((u) => u.endsWith(".ttl"));
        await Promise.all(daily.map((u) => parseTtlReadings(u, sessionA.fetch.bind(sessionA))));
      }, RUNS);
      const readings = days * 96;
      rows.push([days, readings, ms, perItem(ms, readings)]);
      console.log(`  days=${days} (${readings} readings)  ${ms.toFixed(1)} ms`);
    }
    await writeDat(RESULTS_DIR, "series", ["days", "readings", "total_ms", "ms_per_reading"], rows);
    await wipeBuildings(sessionA, a.webId);
  }

  // ── D3: getSharedWithMe + fold vs # buildings shared in from B ───────────────
  console.log(`D3 shared: ${SHARED_SIZES.join(", ")}`);
  {
    const sharedInA = podResources(a.webId).sharedIn;
    const rows: number[][] = [];
    for (const n of SHARED_SIZES) {
      // Isolate each size: clear A's owned buildings + shared-in log and B's pod.
      await wipeBuildings(sessionA, a.webId);
      await wipeBuildings(sessionB, b.webId);
      await sessionA.fetch(sharedInA, { method: "DELETE" }).catch(() => {});
      await seedSharedBuildings(a, b, n);
      let shared = 0;
      const ms = await measure(async () => {
        shared = (await getSharedWithMe(sessionA)).length;
        await fetchAndParseData(sessionA);
      }, RUNS);
      rows.push([n, ms, perItem(ms, n)]);
      console.log(`  n=${n}  ${ms.toFixed(1)} ms  (sharedWithMe=${shared})`);
    }
    await writeDat(RESULTS_DIR, "shared", ["n_shared", "total_ms", "ms_per_shared"], rows);
    await wipeBuildings(sessionA, a.webId);
    await wipeBuildings(sessionB, b.webId);
    await sessionA.fetch(sharedInA, { method: "DELETE" }).catch(() => {});
  }

  await regenerateAndRender();
} finally {
  console.log("\ncleanup");
  await sA?.dispose().catch(() => {});
  await sB?.dispose().catch(() => {});
  await css.stop();
  console.log("  done");
}
