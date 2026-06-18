/// <reference lib="deno.ns" />
/**
 * Eval — does the model translate natural language into the right intent?
 *
 * NOT a hermetic test: it calls the REAL chat API (that is the point), so it lives
 * in `test/eval/`, outside the `deno test` Tier-1 glob and the Playwright tiers. It
 * runs each {@link CASES} request through {@link translateToIntentJson} and scores
 * the resulting `{ name, params }`.
 *
 * Two populations (the runner derives which from the live catalog, so it tracks the
 * code, not a hardcoded list):
 *   - **supported** — the expected intent is in `INTENTS` today → scored pass/fail
 *     on the name; this is the headline accuracy.
 *   - **frontier** — the verb isn't dispatchable yet (FindBuildings, Show…,
 *     DismissSharedIn) → reported, not scored; the model "declining" ("") is correct.
 *
 * Run (a real key is required — the committed default `foobarbaz` is a placeholder):
 *   LLM_API_KEY=... deno run -A test/eval/intent-translation.eval.ts
 *   # optional overrides: LLM_API_URI=... LLM_MODEL=...
 */
import { resolve } from "node:path";
import casesJson from "./cases.json" with { type: "json" };
import { INTENTS } from "../../src/intents/catalog.ts";
import { selectorEquals } from "../../src/intents/selector.ts";
import {
  type LlmConfig,
  translateToIntentJson,
} from "../../src/services/llm/intentTranslate.ts";
// Reuse the bench plotting infrastructure (test/bench): .dat → .gp → gnuplot PNG +
// an index.html, exactly as `deno task bench` does.
import {
  median,
  type PlotSpec,
  renderGraphs,
  writeDat,
  writeGp,
  writeIndexHtml,
} from "../bench/report.ts";
import { benchRunId } from "../bench/runId.ts";

/** One eval case: an NL request and the gold answers a correct translation yields.
 * The dataset lives in `cases.json`. */
export type EvalCategory =
  | "mutation"
  | "query-scalar"
  | "query-collection"
  | "navigation";
export interface EvalCase {
  readonly nl: string;
  /** Gold answer: acceptable intent name(s); "" means "should decline". */
  readonly expect: string | readonly string[];
  readonly category: EvalCategory;
  /** Gold attribute selector — when present, the produced params.selector must
   * match it structurally (in addition to the name). */
  readonly selector?: unknown;
  readonly note?: string;
}
export const CASES = casesJson as readonly EvalCase[];

// Accept either the eval's own `LLM_*` names or the app's `VITE_LLM_*` names, so a
// single `.env` (the one the app reads) also drives the eval. `deno task eval:intent`
// loads `.env` + `.env.local` via `--env-file`.
const env = (...keys: string[]) => {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v) return v;
  }
  return undefined;
};
/** The env-resolved endpoint config (no temperature → the default 0.2 applies). The
 * temperature sweep imports this and overrides `temperature` per run. */
export const config: LlmConfig = {
  apiUri: env("LLM_API_URI", "VITE_LLM_API_URI") ?? "https://hub.nhr.fau.de/api/llmgw/v1",
  apiKey: env("LLM_API_KEY", "VITE_LLM_API_KEY") ?? "foobarbaz",
  model: env("LLM_MODEL", "VITE_LLM_MODEL") ?? "Qwen/Qwen3.6-35B-A3B-FP8",
};

const CATALOG = new Set(INTENTS.map((e) => e.name));
export const accepts = (c: EvalCase) =>
  (Array.isArray(c.expect) ? c.expect : [c.expect]) as readonly string[];
/** A case is supported once any of its expected (non-empty) names exists today. */
export const isSupported = (c: EvalCase) => accepts(c).some((n) => n && CATALOG.has(n));

export interface Result {
  c: EvalCase;
  supported: boolean;
  name: string | null; // the model's chosen intent name ("" = declined)
  ok: boolean | null; // pass/fail for supported cases; null for frontier
  selOk: boolean | null; // selector match (gold-selector cases only), else null
  ms: number; // wall-clock latency of the translate call (incl. failures)
  outLen: number; // length of the model's output (a token-count proxy)
  error?: string;
}

export async function runCase(c: EvalCase, cfg: LlmConfig = config): Promise<Result> {
  const supported = isSupported(c);
  const t0 = performance.now();
  const fail = (extra: Partial<Result>): Result => ({
    c, supported, name: null, ok: supported ? false : null, selOk: null,
    ms: Math.round(performance.now() - t0), outLen: 0, ...extra,
  });
  try {
    const raw = await translateToIntentJson(c.nl, {
      fetchImpl: globalThis.fetch,
      config: cfg,
      onRetry: (a, of) => console.log(`    … timed out, retry ${a}/${of}: ${c.nl.slice(0, 50)}`),
    });
    const ms = Math.round(performance.now() - t0);
    let obj: { name?: unknown; params?: { selector?: unknown }; selector?: unknown };
    try {
      obj = JSON.parse(raw);
    } catch {
      return fail({ error: `non-JSON: ${raw.slice(0, 60)}`, ms, outLen: raw.length });
    }
    const name = String(obj.name ?? "");
    const nameOk = accepts(c).includes(name);
    // Selector cases also score the produced params.selector (or a top-level one).
    const selOk = c.selector === undefined
      ? null
      : selectorEquals(obj.params?.selector ?? obj.selector, c.selector);
    const ok = supported ? (nameOk && (selOk ?? true)) : null;
    return { c, supported, name, ok, selOk, ms, outLen: raw.length };
  } catch (e) {
    return fail({ error: (e as Error).message });
  }
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  if (config.apiKey === "foobarbaz") {
    console.warn(
      "⚠  Using the placeholder key 'foobarbaz' — set LLM_API_KEY to a real key.\n",
    );
  }
  console.log(`Model: ${config.model}   Endpoint: ${config.apiUri}`);
  console.log(`Cases: ${CASES.length}\n`);

  // Sequential — gentle on the endpoint and keeps the live log readable.
  const results: Result[] = [];
  for (const c of CASES) {
    results.push(await runCase(c));
  }

  const supported = results.filter((r) => r.supported);
  const passed = supported.filter((r) => r.ok).length;

  const mark = (r: Result) =>
    r.supported ? (r.ok ? "PASS" : "FAIL") : (r.name === "" ? "decl" : "want");
  for (const r of results) {
    const got = r.error ? `error: ${r.error}` : `→ ${r.name === "" ? "(declined)" : r.name}`;
    const want = accepts(r.c).filter(Boolean).join("|") || "(decline)";
    // A selector verdict tag for gold-selector cases (sel✓ / sel✗).
    const sel = r.selOk == null ? "" : r.selOk ? " sel✓" : " sel✗";
    console.log(
      `[${mark(r)}] ${pad(`${r.ms}ms`, 7)} ${pad(r.c.category, 17)} ${pad(got, 32)} want ${pad(want, 16)}${pad(sel, 6)} ${r.c.nl}`,
    );
  }

  // Selector sub-score, over the gold-selector (FindBuildings) cases only.
  const selCases = results.filter((r) => r.selOk != null);
  const selPass = selCases.filter((r) => r.selOk).length;

  console.log(
    `\nSupported accuracy: ${passed}/${supported.length}` +
      (supported.length ? ` (${Math.round((100 * passed) / supported.length)}%)` : ""),
  );
  if (selCases.length) {
    console.log(`Selector accuracy:  ${selPass}/${selCases.length} (structural match of params.selector)`);
  }
  console.log(
    `Frontier (verb not in catalog yet, not scored): ${results.length - supported.length}`,
  );

  // ── Latency summary + gnuplot graphs (bench infrastructure) ────────────────
  const lat = results.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  if (lat.length) {
    const p95 = lat[Math.min(lat.length - 1, Math.floor(0.95 * lat.length))];
    console.log(
      `\nLatency (n=${lat.length}): min ${lat[0]}ms  median ${median(lat)}ms  ` +
        `p95 ${p95}ms  max ${lat[lat.length - 1]}ms`,
    );
    await writePlots(results);
  }

  // Exit non-zero if any SUPPORTED case failed — so the eval can gate a run when
  // wanted; frontier cases never fail the run.
  Deno.exit(passed === supported.length ? 0 : 1);
}

/**
 * Plot the per-lookup latency via the bench infra (`test/bench/report.ts`): write
 * `.dat` files, a gnuplot `.gp` per spec, render to PNG, and an `index.html` — into
 * `test-results/eval/<run-id>/`, beside the bench scopes.
 */
async function writePlots(results: Result[]): Promise<void> {
  const ok = results.filter((r) => !r.error && r.ms > 0);
  if (!ok.length) return;
  const dir = resolve(`${import.meta.dirname}/../../test-results/eval/${benchRunId()}`);

  // Sorted latency curve (the distribution shape) + latency vs output size (the
  // correlate — generation time scales with tokens emitted).
  const sorted = [...ok].map((r) => r.ms).sort((a, b) => a - b);
  await writeDat(dir, "eval-latency", ["rank", "ms"], sorted.map((ms, i) => [i + 1, ms]));
  const bySize = [...ok].sort((a, b) => a.outLen - b.outLen);
  await writeDat(dir, "eval-latency-vs-size", ["outChars", "ms"], bySize.map((r) => [r.outLen, r.ms]));

  const specs: PlotSpec[] = [
    {
      name: "eval-latency",
      title: `NL→intent translate latency (sorted, n=${ok.length})`,
      xlabel: "case (sorted by latency)",
      ylabel: "latency (ms)",
      series: [{ col: 2, title: "per-lookup ms" }],
    },
    {
      name: "eval-latency-vs-size",
      title: "NL→intent translate latency vs output size",
      xlabel: "output JSON length (chars)",
      ylabel: "latency (ms)",
      series: [{ col: 2, title: "per-lookup ms" }],
    },
  ];
  for (const s of specs) await writeGp(dir, s);
  await renderGraphs(dir);
  await writeIndexHtml(dir, specs);
}

if (import.meta.main) await main();
