/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  BASEMAP_DE,
  BAVARIA_DOP20,
  detailBaseLayer,
  inBavaria,
} from "./orthophoto.ts";

// Nürnberg — the pilot city; the demo buildings live here (≈49.45, 11.08).
Deno.test("inBavaria: Nürnberg is inside the DOP20 coverage", () => {
  assert.equal(inBavaria(49.45, 11.08), true);
});

Deno.test("inBavaria: cities outside Bavaria are excluded", () => {
  assert.equal(inBavaria(52.52, 13.405), false); // Berlin
  assert.equal(inBavaria(53.55, 9.99), false); // Hamburg
  assert.equal(inBavaria(50.94, 6.96), false); // Köln
});

Deno.test("inBavaria: bounding-box edges", () => {
  // Just inside the SW and NE corners.
  assert.equal(inBavaria(47.2, 9.0), true);
  assert.equal(inBavaria(50.5, 14.0), true);
  // Just outside (north of, and west of, the box).
  assert.equal(inBavaria(50.7, 11.0), false);
  assert.equal(inBavaria(49.0, 8.5), false);
});

Deno.test("detailBaseLayer: a Bavarian building gets the DOP20c orthophoto, zoomed in", () => {
  const { config, zoom } = detailBaseLayer(49.45, 11.08);
  assert.equal(config, BAVARIA_DOP20);
  assert.equal(config.layers, "by_dop20c");
  assert.ok(zoom >= 17, "orthophoto is zoomed in for a close-up of the building");
});

Deno.test("detailBaseLayer: a non-Bavarian building falls back to the basemap raster (no blank DOP tiles)", () => {
  const { config, zoom } = detailBaseLayer(52.52, 13.405); // Berlin
  assert.equal(config, BASEMAP_DE);
  assert.equal(zoom, 14);
});
