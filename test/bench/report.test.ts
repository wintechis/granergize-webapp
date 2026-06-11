/// <reference lib="deno.ns" />
/**
 * Tier-1 unit test for the benchmark report formatting (offline, no CSS/network).
 * Covers the deterministic pieces — `median`, the `.dat` column layout, and the
 * generated gnuplot script. The timings themselves are measure-and-report, so
 * there's nothing time-based to assert; what must stay correct is the file format
 * gnuplot reads and the plot script it runs.
 */
import { strict as assert } from "node:assert";
import { formatDat, gnuplotScript, indexHtml, median } from "./report.ts";
import { benchRunId } from "./runId.ts";

Deno.test("median: odd, even, empty", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5); // mean of two middles
  assert.ok(Number.isNaN(median([])));
});

Deno.test("formatDat: commented header, integers vs rounded decimals", () => {
  const out = formatDat(
    ["n", "total_ms", "per"],
    [[0, 0, 0], [50, 12.3456, 0.246912]],
  );
  const lines = out.trimEnd().split("\n");
  assert.equal(lines[0], "# n  total_ms  per"); // header is a gnuplot comment
  assert.equal(lines[1], "0  0  0"); // integers stay bare
  assert.equal(lines[2], "50  12.346  0.247"); // decimals rounded to 3
  assert.ok(out.endsWith("\n"));
});

Deno.test("gnuplotScript: pngcairo terminal, output name, one plot per series", () => {
  const gp = gnuplotScript({
    name: "buildings",
    title: "T",
    xlabel: "# buildings",
    ylabel: "ms",
    y2label: "per",
    series: [
      { col: 2, title: "total (ms)" },
      { col: 3, title: "per building (ms)", y2: true },
    ],
  });
  assert.match(gp, /set terminal pngcairo/);
  assert.match(gp, /set output "buildings\.png"/);
  // y2 series triggers the secondary-axis setup.
  assert.match(gp, /set y2tics/);
  assert.match(gp, /set ytics nomirror/);
  // One plot clause per series, reading the matching .dat columns.
  assert.match(gp, /"buildings\.dat" using 1:2 .*title "total \(ms\)"/);
  assert.match(gp, /"buildings\.dat" using 1:3 axes x1y2 .*title "per building \(ms\)"/);
  assert.equal((gp.match(/buildings\.dat/g) ?? []).length, 2);
});

Deno.test("benchRunId: local date by default, BENCH_RUN_ID overrides", () => {
  const before = Deno.env.get("BENCH_RUN_ID");
  try {
    Deno.env.delete("BENCH_RUN_ID");
    // 2026-06-09 local time (month is 0-based) — zero-padded YYYY-MM-DD.
    assert.equal(benchRunId(new Date(2026, 5, 9, 14, 30)), "2026-06-09");
    Deno.env.set("BENCH_RUN_ID", "2026-06-11-jss");
    assert.equal(benchRunId(new Date(2026, 5, 9)), "2026-06-11-jss");
  } finally {
    if (before === undefined) Deno.env.delete("BENCH_RUN_ID");
    else Deno.env.set("BENCH_RUN_ID", before);
  }
});

Deno.test("indexHtml: run id in title, figure per plot, dat/gp fallback without png", () => {
  const html = indexHtml("2026-06-11", [
    { name: "buildings", title: "Load & parse", png: true },
    { name: "rooms", title: "Rooms", png: false },
  ]);
  assert.match(html, /<title>Benchmark results — 2026-06-11<\/title>/);
  // Rendered figure: inline image + a caption linking the raw data.
  assert.match(html, /<img src="buildings\.png" alt="Load &amp; parse" \/>/);
  assert.match(html, /<a href="buildings\.dat">buildings\.dat<\/a>/);
  // Unrendered figure: no image, points at the .dat + .gp pair instead.
  assert.doesNotMatch(html, /rooms\.png/);
  assert.match(html, /not rendered .*<a href="rooms\.dat">.*<a href="rooms\.gp">/);
  assert.equal((html.match(/<figure>/g) ?? []).length, 2);
});

Deno.test("gnuplotScript: custom x column, no y2 axis when unused", () => {
  const gp = gnuplotScript({
    name: "series",
    title: "T",
    xlabel: "# readings",
    ylabel: "ms",
    xcol: 2,
    series: [{ col: 3, title: "total (ms)" }],
  });
  assert.match(gp, /using 2:3 /); // honors xcol
  assert.doesNotMatch(gp, /set y2tics/); // no y2 series → no secondary axis
});
