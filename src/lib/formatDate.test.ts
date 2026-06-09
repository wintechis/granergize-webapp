/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { formatDate, formatDateTime } from "./formatDate.ts";

Deno.test("formatDate renders a Date as ISO 8601 calendar date (local)", () => {
  // Construct from local Y/M/D parts so the assertion is timezone-independent.
  assert.equal(formatDate(new Date(2026, 5, 9)), "2026-06-09"); // month is 0-based
  assert.equal(formatDate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(formatDate(new Date(2026, 11, 31)), "2026-12-31");
});

Deno.test("formatDate zero-pads month and day", () => {
  assert.equal(formatDate(new Date(2026, 2, 5)), "2026-03-05");
});

Deno.test("formatDateTime appends minute-precision time", () => {
  assert.equal(formatDateTime(new Date(2026, 5, 9, 14, 30)), "2026-06-09 14:30");
  assert.equal(formatDateTime(new Date(2026, 5, 9, 3, 7)), "2026-06-09 03:07");
});

Deno.test("an unparseable value yields an empty string", () => {
  assert.equal(formatDate("not a date"), "");
  assert.equal(formatDateTime("not a date"), "");
});
