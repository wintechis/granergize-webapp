/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  formatNumber,
  formatNumberMax,
  formatSignedPercent,
} from "./formatNumber.ts";

/** The non-breaking space `formatSignedPercent` puts before the `%` (DIN 5008). */
const NB = "\u00A0";
/** The real minus sign (U+2212) — not a hyphen. */
const MINUS = "−";

Deno.test("formatNumber: de-DE decimal comma, fixed fraction digits", () => {
  assert.equal(formatNumber(1234.5, 1), "1.234,5");
  assert.equal(formatNumber(2, 2), "2,00");
});

Deno.test("formatNumberMax: trailing zeros dropped", () => {
  assert.equal(formatNumberMax(2, 2), "2");
  assert.equal(formatNumberMax(2.5, 2), "2,5");
});

Deno.test("formatSignedPercent: a fraction becomes a signed percentage", () => {
  assert.equal(formatSignedPercent(0.12), `+12${NB}%`);
  assert.equal(formatSignedPercent(-0.12), `${MINUS}12${NB}%`);
});

Deno.test("formatSignedPercent: no change reads ±0, never +0", () => {
  assert.equal(formatSignedPercent(0), `±0${NB}%`);
  // Rounds to zero at 0 decimals — the sign would claim a direction the shown
  // figure doesn't support, so it reads ±0 rather than −0.
  assert.equal(formatSignedPercent(-0.004), `±0${NB}%`);
  assert.equal(formatSignedPercent(0.004), `±0${NB}%`);
});

Deno.test("formatSignedPercent: decimals go through the de-DE formatter", () => {
  assert.equal(formatSignedPercent(0.125, 1), `+12,5${NB}%`);
  assert.equal(formatSignedPercent(-0.125, 1), `${MINUS}12,5${NB}%`);
});
