/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  openRadiusForZoom,
  openRooftopToBuilding,
  openViewport,
} from "./openBuildings.ts";
import { type NearbyRooftop } from "./lod2Rooftop.ts";

const rooftop: NearbyRooftop = {
  iri: "https://wunderfacts.com/lod2-by/see/DEBY123#it",
  installableKwp: 45.5,
  lat: 49.45,
  long: 11.08,
  distanceKm: 0.3,
};

Deno.test("openRooftopToBuilding: flags the open tier, keeps the source IRI + kWp", () => {
  const b = openRooftopToBuilding(rooftop);
  assert.equal(b.isOpen, true);
  assert.equal(b.isShared, false, "open is not shared (mutually exclusive)");
  assert.equal(b.uri, rooftop.iri, "source IRI kept for the source link / nav");
  assert.equal(b.id, rooftop.iri, "id is the IRI — a stable key, not a Pod route");
  assert.equal(b.lat, 49.45);
  assert.equal(b.long, 11.08);
  assert.equal(b.openKwp, 45.5);
});

Deno.test("openRooftopToBuilding: sets no label — display is the renderer's job", () => {
  // The wrapper carries no name/address; a label parsed from the IRI would violate
  // the no-URI-magic rule, so the adapter leaves it unset.
  const b = openRooftopToBuilding(rooftop);
  assert.equal(b.label, undefined);
  assert.equal(b.streetAddress, undefined);
});

Deno.test("openRadiusForZoom: wider view → bigger radius, clamped to [500, 20000]", () => {
  assert.equal(openRadiusForZoom(6), 20000, "country view clamps to the max");
  assert.equal(openRadiusForZoom(20), 500, "street view clamps to the min");
  // A city-scale zoom sits inside the band and shrinks as you zoom in.
  assert.ok(openRadiusForZoom(13) > openRadiusForZoom(15));
  assert.ok(openRadiusForZoom(13) > 500 && openRadiusForZoom(13) < 20000);
});

Deno.test("openViewport: snaps the centre to a ~110 m grid + zoom radius", () => {
  const { centre, radiusM } = openViewport(
    new URLSearchParams("c=49.45123,11.08456&z=13"),
  );
  assert.deepEqual(centre, { lat: 49.451, long: 11.085 }, "snapped to 3 decimals");
  assert.equal(radiusM, openRadiusForZoom(13));
});

Deno.test("openViewport: no centre → null (the finder shows a 'pan the map' hint)", () => {
  const noC = openViewport(new URLSearchParams("z=13"));
  assert.equal(noC.centre, null);
  assert.equal(noC.radiusM, openRadiusForZoom(13));
  // No zoom → the fallback radius.
  const noZ = openViewport(new URLSearchParams(""));
  assert.equal(noZ.centre, null);
  assert.equal(noZ.radiusM, 2000);
});
