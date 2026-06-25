/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { clusterStyle, dominantBand } from "./markerClusterTint.ts";
import {
  MARKER_OPEN_COLOR,
  MARKER_OWNED_COLOR,
} from "../../constants/chartColors.ts";
import { bandColor } from "../../constants/lensBand.ts";

Deno.test("dominantBand: most frequent non-none band wins", () => {
  assert.equal(
    dominantBand(["efficient", "efficient", "typical"], "tier"),
    "efficient",
  );
  assert.equal(dominantBand(["low", "high", "high"], "magnitude"), "high");
});

Deno.test("dominantBand: ignores none unless everything is none", () => {
  assert.equal(dominantBand(["none", "none", "typical"], "tier"), "typical");
  assert.equal(dominantBand(["none", "none"], "tier"), "none");
  assert.equal(dominantBand([], "magnitude"), "none");
});

Deno.test("dominantBand: ties break toward the worse / higher band", () => {
  // efficient vs inefficient, 1 each → the worse (inefficient) wins.
  assert.equal(
    dominantBand(["efficient", "inefficient"], "tier"),
    "inefficient",
  );
  // low vs high, 1 each → the higher (high) wins.
  assert.equal(dominantBand(["low", "high"], "magnitude"), "high");
});

Deno.test("clusterStyle: energy children → tinted by the dominant band", () => {
  const s = clusterStyle([
    "energy-marker energy-inefficient",
    "energy-marker energy-inefficient",
    "energy-marker energy-typical",
  ]);
  assert.equal(s.className, "energy-cluster energy-inefficient");
  assert.equal(s.color, bandColor("inefficient", "tier"));
});

Deno.test("clusterStyle: magnitude bands infer the magnitude framing", () => {
  const s = clusterStyle(["energy-marker energy-high", "energy-marker energy-mid"]);
  assert.equal(s.className, "energy-cluster energy-high");
  assert.equal(s.color, bandColor("high", "magnitude"));
});

Deno.test("clusterStyle: only-open children → green open bubble", () => {
  const s = clusterStyle(["pin-marker pin-open", "pin-marker pin-open"]);
  assert.equal(s.className, "pin-cluster pin-open");
  assert.equal(s.color, MARKER_OPEN_COLOR);
});

Deno.test("clusterStyle: owned/shared (mixed) → neutral owned bubble", () => {
  const s = clusterStyle(["pin-marker pin-owned", "pin-marker pin-shared"]);
  assert.equal(s.className, "pin-cluster");
  assert.equal(s.color, MARKER_OWNED_COLOR);
});
