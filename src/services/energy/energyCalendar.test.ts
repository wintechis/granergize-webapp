/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  buildCalendarGrid,
  calendarColorScale,
  type ReadingsByDay,
} from "./energyCalendar.ts";

/** Build a day's readings: one reading per (hour, quarter) given as kWh values. */
function day(
  date: string,
  perReading: Array<{ h: number; q?: number; value: number }>,
): { begin: string; value: number }[] {
  return perReading.map(({ h, q = 0, value }) => ({
    begin: `${date}T${String(h).padStart(2, "0")}:${
      String(q * 15).padStart(2, "0")
    }:00`,
    value,
  }));
}

function readings(spec: Record<string, ReturnType<typeof day>>): ReadingsByDay {
  return new Map(Object.entries(spec));
}

Deno.test("buildCalendarGrid: rows sorted by day, each row has 24 hour cells", () => {
  const grid = buildCalendarGrid(
    readings({
      "2024-03-02": day("2024-03-02", [{ h: 0, value: 1 }]),
      "2024-03-01": day("2024-03-01", [{ h: 0, value: 1 }]),
    }),
  );
  assert.deepEqual(grid.rows.map((r) => r.day), ["2024-03-01", "2024-03-02"]);
  for (const r of grid.rows) {
    assert.equal(r.cells.length, 24);
    assert.deepEqual(r.cells.map((c) => c.hour), [...Array(24).keys()]);
  }
});

Deno.test("buildCalendarGrid: sums the four quarter-hour readings into one hour cell", () => {
  const grid = buildCalendarGrid(
    readings({
      "2024-03-01": day("2024-03-01", [
        { h: 8, q: 0, value: 1 },
        { h: 8, q: 1, value: 2 },
        { h: 8, q: 2, value: 3 },
        { h: 8, q: 3, value: 4 },
      ]),
    }),
  );
  const cell = grid.rows[0].cells[8];
  assert.equal(cell.value, 10); // 1+2+3+4
  assert.equal(cell.hour, 8);
  assert.equal(cell.day, "2024-03-01");
});

Deno.test("buildCalendarGrid: an hour with no reading is a null hole", () => {
  const grid = buildCalendarGrid(
    readings({
      "2024-03-01": day("2024-03-01", [{ h: 8, value: 5 }]),
    }),
  );
  assert.equal(grid.rows[0].cells[8].value, 5);
  assert.equal(grid.rows[0].cells[0].value, null);
  assert.equal(grid.rows[0].cells[23].value, null);
});

Deno.test("buildCalendarGrid: an hour summing to 0 stays a real cell, not a hole", () => {
  const grid = buildCalendarGrid(
    readings({
      "2024-03-01": day("2024-03-01", [{ h: 3, value: 0 }]),
    }),
  );
  // A real 0 reading is a populated cell (value 0), distinct from an untouched null.
  assert.equal(grid.rows[0].cells[3].value, 0);
  assert.equal(grid.rows[0].cells[4].value, null);
});

Deno.test("buildCalendarGrid: min/max span the non-null cells only", () => {
  const grid = buildCalendarGrid(
    readings({
      "2024-03-01": day("2024-03-01", [
        { h: 1, value: 2 },
        { h: 2, value: 9 },
        { h: 3, value: 5 },
      ]),
    }),
  );
  assert.equal(grid.min, 2);
  assert.equal(grid.max, 9);
});

Deno.test("buildCalendarGrid: empty input yields no rows and null range", () => {
  const grid = buildCalendarGrid(new Map());
  assert.deepEqual(grid.rows, []);
  assert.equal(grid.min, null);
  assert.equal(grid.max, null);
});

Deno.test("buildCalendarGrid: a malformed timestamp is dropped, not mis-binned", () => {
  const grid = buildCalendarGrid(
    new Map([[
      "2024-03-01",
      [
        { begin: "garbage", value: 100 },
        { begin: "2024-03-01T10:00:00", value: 7 },
      ],
    ]]),
  );
  // Only the well-formed reading lands; the garbage one never inflates a cell.
  assert.equal(grid.rows[0].cells[10].value, 7);
  assert.equal(grid.min, 7);
  assert.equal(grid.max, 7);
});

Deno.test("calendarColorScale: null/out-of-range → transparent", () => {
  const scale = calendarColorScale(0, 10);
  assert.equal(scale(null), "transparent");
  const empty = calendarColorScale(null, null);
  assert.equal(empty(5), "transparent");
});

Deno.test("calendarColorScale: min maps low alpha, max maps full alpha", () => {
  const scale = calendarColorScale(0, 10);
  const low = scale(0);
  const high = scale(10);
  assert.ok(low.startsWith("rgba(31, 120, 180, "), "low end is the chart blue");
  assert.ok(high.startsWith("rgba(31, 120, 180, "), "high end is the chart blue");
  // Low end is the pale floor (0.08), high end is full (1).
  assert.ok(low.includes("0.080"));
  assert.ok(high.includes("1.000"));
});

Deno.test("calendarColorScale: a midpoint sits between the endpoints", () => {
  const scale = calendarColorScale(0, 10);
  const alphaOf = (c: string) => Number(c.match(/,\s*([\d.]+)\)$/)![1]);
  const mid = alphaOf(scale(5));
  assert.ok(mid > alphaOf(scale(0)) && mid < alphaOf(scale(10)));
});

Deno.test("calendarColorScale: a degenerate (min===max) range maps everything to full colour", () => {
  const scale = calendarColorScale(4, 4);
  assert.ok(scale(4).includes("1.000"));
});
