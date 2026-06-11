/// <reference lib="deno.ns" />
/**
 * Benchmark output: timing helpers + gnuplot data files (`.dat`) + plot scripts
 * (`.gp`) + rendered PNG graphs (for the paper) + a per-run `index.html` showing
 * all figures. Each run writes into its own dated directory
 * `test-results/bench/<run-id>/`, beside the e2e scopes (see `runId.ts`).
 * The benchmark is MEASURE-AND-REPORT — nothing here asserts a time budget; it
 * records numbers and draws them.
 *
 * Split so the formatting is testable offline (Tier 1, `report.test.ts`): the pure
 * functions `formatDat` / `gnuplotScript` build strings; `writeDat` / `writeGp` are
 * the thin disk wrappers; `renderGraphs` shells out to gnuplot ONLY when it's on
 * PATH (graceful — a missing binary prints an install hint, never throws, so a
 * machine without gnuplot still gets the `.dat` + `.gp` to render elsewhere).
 *
 * The plot CATALOG (which `.dat` → which graph) lives in `plots.ts`; this module
 * is the generic formatting/render machinery it builds on.
 */

import { resolve } from "node:path";
import { benchRunId } from "./runId.ts";

/**
 * Root under which each run gets its own dated directory — under the repo's
 * `test-results/`, beside the e2e scopes (`tier-3-css/<run>`, `bench-css/<run>`
 * traces, …), so ALL run artifacts live in one tree. One scope for the figures
 * (no `-css`/`-jss` split): a run's figures span the Tier-2 runner and the
 * Tier-3 specs, and a server comparison is told apart by its run id instead
 * (`BENCH_RUN_ID=2026-06-11-jss`).
 */
export const RESULTS_ROOT = resolve(`${import.meta.dirname}/../../test-results/bench`);

/** This run's output directory — `results/<run-id>/` (see {@link benchRunId}). */
export function benchRunDir(): string {
  return `${RESULTS_ROOT}/${benchRunId()}`;
}

// Run directories are date-named (possibly suffixed via BENCH_RUN_ID), so the
// lexicographic max is the most recent run.
const RUN_DIR_RE = /^\d{4}-\d{2}-\d{2}/;

/** The most recent existing run directory, for plot-only re-rendering. */
export async function latestRunDir(): Promise<string | undefined> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(RESULTS_ROOT)) {
      if (e.isDirectory && RUN_DIR_RE.test(e.name)) names.push(e.name);
    }
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;
  names.sort();
  return `${RESULTS_ROOT}/${names[names.length - 1]}`;
}

// ── Timing ────────────────────────────────────────────────────────────────────

/** Median of a numeric array (numeric sort; mean of the two middles when even). */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Run `fn` `runs` times and return the MEDIAN wall-clock ms (median shrugs off the
 * odd GC / network blip better than the mean). `runs` defaults to 3; pass 1 for
 * one-shot measurements (e.g. an expensive seed already done once).
 */
export async function measure(fn: () => Promise<unknown>, runs = 3): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

// ── Data files (gnuplot-friendly whitespace columns) ────────────────────────────

type Cell = number | string;

/**
 * Format a whitespace-separated data table with a `#`-commented header line
 * (gnuplot treats `#` lines as comments, so the header is documentation only).
 * Numbers are rounded to 3 decimals; everything is space-padded for readability.
 */
export function formatDat(header: string[], rows: Cell[][]): string {
  const fmt = (c: Cell): string =>
    typeof c === "number" ? (Number.isInteger(c) ? String(c) : c.toFixed(3)) : c;
  const lines = [`# ${header.join("  ")}`];
  for (const row of rows) lines.push(row.map(fmt).join("  "));
  return lines.join("\n") + "\n";
}

export async function writeDat(
  dir: string,
  name: string,
  header: string[],
  rows: Cell[][],
): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const path = `${dir}/${name}.dat`;
  await Deno.writeTextFile(path, formatDat(header, rows));
  return path;
}

// ── gnuplot scripts (pngcairo) ──────────────────────────────────────────────────

/** One plotted curve: which `.dat` column to read and how to label it. */
export interface PlotSeries {
  /** 1-based data column (matches gnuplot's `using` numbering). */
  col: number;
  title: string;
  /** Put this curve on the secondary y2 axis (e.g. the per-item ms/N curve). */
  y2?: boolean;
}

export interface PlotSpec {
  /** Base name (no extension): reads `<name>.dat`, writes `<name>.png`. */
  name: string;
  title: string;
  xlabel: string;
  ylabel: string;
  y2label?: string;
  /** 1-based x column (default 1). */
  xcol?: number;
  series: PlotSeries[];
}

// Filled point types that stay distinguishable in black & white print.
const POINT_TYPES = [7, 5, 9, 13, 11, 4];

/**
 * Build a self-contained gnuplot script (PNG via pngcairo) for one graph. Vector
 * PDF was the obvious choice for print, but the user picked PNG; the distinct
 * filled point types + dashtypes keep curves separable on a B/W page anyway.
 */
export function gnuplotScript(spec: PlotSpec): string {
  const xcol = spec.xcol ?? 1;
  const hasY2 = spec.series.some((s) => s.y2);
  const head = [
    `# Generated by test/bench/report.ts — regenerate with: deno task bench:plot`,
    `set terminal pngcairo size 900,560 font ",12"`,
    `set output "${spec.name}.png"`,
    `set title "${spec.title}"`,
    `set xlabel "${spec.xlabel}"`,
    `set ylabel "${spec.ylabel}"`,
    `set grid`,
    `set key top left`,
  ];
  if (hasY2) {
    head.push(`set y2label "${spec.y2label ?? ""}"`, `set y2tics`, `set ytics nomirror`);
  }
  const plots = spec.series.map((s, i) => {
    const pt = POINT_TYPES[i % POINT_TYPES.length];
    const axes = s.y2 ? " axes x1y2" : "";
    const dt = s.y2 ? " dt 2" : "";
    return `  "${spec.name}.dat" using ${xcol}:${s.col}${axes} ` +
      `with linespoints lw 2 pt ${pt} ps 1.2${dt} title "${s.title}"`;
  });
  return head.join("\n") + "\nplot \\\n" + plots.join(", \\\n") + "\n";
}

export async function writeGp(dir: string, spec: PlotSpec): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const path = `${dir}/${spec.name}.gp`;
  await Deno.writeTextFile(path, gnuplotScript(spec));
  return path;
}

// ── Rendering (graceful: gnuplot optional) ──────────────────────────────────────

/** True when a `gnuplot` binary is callable on PATH. */
export async function gnuplotAvailable(): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("gnuplot", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

/**
 * Render every `*.gp` in `dir` to its PNG by running gnuplot with `dir` as cwd (so
 * the scripts' relative `set output`/`<name>.dat` paths resolve inside `out/`).
 * When gnuplot is absent, print where the data + scripts landed and how to render
 * them later — the benchmark never fails over a missing plotting tool.
 */
export async function renderGraphs(dir: string): Promise<void> {
  const gps: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".gp")) gps.push(e.name);
    }
  } catch {
    // out/ doesn't exist (no data written) — nothing to do.
    return;
  }
  gps.sort();

  if (!(await gnuplotAvailable())) {
    console.log(
      `\ngnuplot not found on PATH — wrote ${gps.length} data/script pair(s) to ${dir}.\n` +
        `Install it and render the paper graphs with:\n` +
        `  sudo apt-get install gnuplot   # (or: brew install gnuplot)\n` +
        `  deno task bench:plot`,
    );
    return;
  }

  for (const gp of gps) {
    const { success, stderr } = await new Deno.Command("gnuplot", {
      args: [gp],
      cwd: dir,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (success) {
      console.log(`  rendered ${gp.replace(/\.gp$/, ".png")}`);
    } else {
      console.error(`  gnuplot failed on ${gp}: ${new TextDecoder().decode(stderr).trim()}`);
    }
  }
  console.log(`\nGraphs written to ${dir}`);
}

// ── Run index page ──────────────────────────────────────────────────────────────

/** One entry on a run's index page. */
export interface IndexFigure {
  /** Base name: links `<name>.dat` and (when rendered) embeds `<name>.png`. */
  name: string;
  title: string;
  /** Whether the PNG was rendered (gnuplot present). */
  png: boolean;
}

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Build the self-contained `index.html` for one run directory: every measured
 * figure in catalog order, each PNG inline with a caption linking the raw `.dat`
 * (or, without gnuplot, a pointer to the `.dat` + `.gp` pair to render later).
 */
export function indexHtml(runId: string, figures: IndexFigure[]): string {
  const body = figures.map((f) => {
    const dat = `<a href="${f.name}.dat">${f.name}.dat</a>`;
    const inner = f.png
      ? `    <img src="${f.name}.png" alt="${escapeHtml(f.title)}" />\n` +
        `    <figcaption>${escapeHtml(f.title)} — ${dat}</figcaption>`
      : `    <figcaption>${escapeHtml(f.title)} — not rendered (gnuplot missing): ` +
        `${dat}, <a href="${f.name}.gp">${f.name}.gp</a></figcaption>`;
    return `  <figure>\n${inner}\n  </figure>`;
  });
  return [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <title>Benchmark results — ${escapeHtml(runId)}</title>`,
    `  <style>`,
    `    body { font-family: sans-serif; max-width: 960px; margin: 2rem auto; }`,
    `    figure { margin: 2rem 0; }`,
    `    img { max-width: 100%; }`,
    `    figcaption { color: #555; margin-top: 0.25rem; }`,
    `  </style>`,
    `</head>`,
    `<body>`,
    `  <h1>Benchmark results — ${escapeHtml(runId)}</h1>`,
    ...body,
    `</body>`,
    `</html>`,
  ].join("\n") + "\n";
}

/**
 * Write the run's `index.html` for the given plot specs (only those whose `.dat`
 * was measured), checking per spec whether the PNG actually rendered.
 */
export async function writeIndexHtml(
  dir: string,
  specs: Array<Pick<PlotSpec, "name" | "title">>,
): Promise<string> {
  const figures: IndexFigure[] = [];
  for (const { name, title } of specs) {
    let png = false;
    try {
      await Deno.stat(`${dir}/${name}.png`);
      png = true;
    } catch {
      // not rendered (no gnuplot) — the index links the .dat/.gp instead.
    }
    figures.push({ name, title, png });
  }
  const path = `${dir}/index.html`;
  await Deno.writeTextFile(path, indexHtml(dir.split("/").pop() ?? dir, figures));
  console.log(`  wrote ${path}`);
  return path;
}
