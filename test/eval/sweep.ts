/// <reference lib="deno.ns" />
/**
 * Temperature × model sweep for the NL→intent translator. Runs the full eval
 * dataset at every (model, temperature) cell and plots **quality and speed** as
 * gnuplot figures (bench infra), one line per model.
 *
 * Each model needs its own request profile (confirmed by probe — the request is
 * tuned for Qwen): Mistral-Medium 400s on the `enable_thinking` kwarg; gpt-oss emits
 * malformed JSON under `response_format`. So per model we toggle `disableThinking`
 * and `jsonMode` (see `LlmConfig`).
 *
 *   LLM_API_KEY=... deno run -A --env-file=.env.local test/eval/sweep.ts
 */
import { resolve } from "node:path";
import {
  CASES,
  config as baseConfig,
  type Result,
  runCase,
} from "./intent-translation.eval.ts";
import type { LlmConfig } from "../../src/intents/llm/intentTranslate.ts";
import {
  median,
  type PlotSpec,
  renderGraphs,
  writeDat,
  writeGp,
  writeIndexHtml,
} from "../bench/report.ts";
import { benchRunId } from "../bench/runId.ts";

/** One model + the request profile it accepts (Qwen is the default-on profile). */
interface ModelProfile {
  id: string;
  label: string;
  jsonMode: boolean;
  disableThinking: boolean;
}
const MODELS: ModelProfile[] = [
  { id: "Qwen/Qwen3.6-35B-A3B-FP8", label: "qwen", jsonMode: true, disableThinking: true },
  { id: "mistralai/Mistral-Medium-3.5-128B", label: "mistral", jsonMode: true, disableThinking: false },
  { id: "gpt-oss-120b", label: "gptoss", jsonMode: false, disableThinking: false },
];
const TEMPS = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
/** Concurrency per cell — keeps the ~1000-call sweep to a few minutes. Latency is
 * thus measured under light load (consistent across models, so the comparison holds;
 * absolute ms run a little higher than a fully-sequential run). */
const POOL = 4;

interface CellStats {
  supportedPct: number;
  selectorPct: number;
  medianMs: number;
  p95Ms: number;
  errors: number;
}

/** Map with bounded concurrency (order-preserving). */
async function poolMap<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function statsOf(results: Result[]): CellStats {
  const supported = results.filter((r) => r.supported);
  const passed = supported.filter((r) => r.ok).length;
  const selCases = results.filter((r) => r.selOk != null);
  const selPass = selCases.filter((r) => r.selOk).length;
  const lat = results.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.95 * lat.length))] : 0;
  return {
    supportedPct: supported.length ? Math.round((100 * passed) / supported.length) : 0,
    selectorPct: selCases.length ? Math.round((100 * selPass) / selCases.length) : 0,
    medianMs: lat.length ? Math.round(median(lat)) : 0,
    p95Ms: p95,
    errors: results.filter((r) => r.error).length,
  };
}

async function main() {
  if (baseConfig.apiKey === "foobarbaz") {
    console.warn("⚠  placeholder key — set LLM_API_KEY.\n");
  }
  console.log(`Sweep: ${MODELS.length} models × ${TEMPS.length} temps × ${CASES.length} cases\n`);

  // stat[label][temp] = CellStats
  const stat: Record<string, Record<number, CellStats>> = {};
  for (const m of MODELS) {
    stat[m.label] = {};
    for (const t of TEMPS) {
      const cfg: LlmConfig = {
        ...baseConfig,
        model: m.id,
        temperature: t,
        jsonMode: m.jsonMode,
        disableThinking: m.disableThinking,
      };
      const results = await poolMap([...CASES], POOL, (c) => runCase(c, cfg));
      const s = statsOf(results);
      stat[m.label][t] = s;
      console.log(
        `${m.label.padEnd(8)} t=${t.toFixed(1)}  acc ${String(s.supportedPct).padStart(3)}%  ` +
          `sel ${String(s.selectorPct).padStart(3)}%  median ${String(s.medianMs).padStart(5)}ms  ` +
          `p95 ${String(s.p95Ms).padStart(6)}ms  err ${s.errors}`,
      );
    }
  }

  // ── Figures (bench infra): one row per temperature, one column per model ──────
  const labels = MODELS.map((m) => m.label);
  const series = MODELS.map((m, i) => ({ col: i + 2, title: m.label }));
  const rows = (pick: (s: CellStats) => number) =>
    TEMPS.map((t) => [t, ...MODELS.map((m) => pick(stat[m.label][t]))]);

  const dir = resolve(`${import.meta.dirname}/../../test-results/eval-sweep/${benchRunId()}`);
  await writeDat(dir, "sweep-quality", ["temp", ...labels], rows((s) => s.supportedPct));
  await writeDat(dir, "sweep-selector", ["temp", ...labels], rows((s) => s.selectorPct));
  await writeDat(dir, "sweep-speed", ["temp", ...labels], rows((s) => s.medianMs));
  await writeDat(dir, "sweep-speed-p95", ["temp", ...labels], rows((s) => s.p95Ms));

  const specs: PlotSpec[] = [
    { name: "sweep-quality", title: "Intent accuracy vs temperature (by model)", xlabel: "temperature", ylabel: "supported accuracy (%)", series },
    { name: "sweep-selector", title: "Selector accuracy vs temperature (by model)", xlabel: "temperature", ylabel: "selector accuracy (%)", series },
    { name: "sweep-speed", title: `Median translate latency vs temperature (pool=${POOL})`, xlabel: "temperature", ylabel: "median latency (ms)", series },
    { name: "sweep-speed-p95", title: `p95 translate latency vs temperature (pool=${POOL})`, xlabel: "temperature", ylabel: "p95 latency (ms)", series },
  ];
  for (const s of specs) await writeGp(dir, s);
  await renderGraphs(dir);
  await writeIndexHtml(dir, specs);
}

if (import.meta.main) await main();
