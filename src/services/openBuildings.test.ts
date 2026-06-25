/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  OPEN_BUILDINGS_RADIUS_M,
  ownDataAnchor,
  openRooftopToBuilding,
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

Deno.test("ownDataAnchor: no located buildings → null centre (no own data to anchor to)", () => {
  assert.deepEqual(ownDataAnchor([]), { centre: null, radiusM: OPEN_BUILDINGS_RADIUS_M });
  assert.deepEqual(
    ownDataAnchor([{ lat: undefined, long: undefined }, {}]),
    { centre: null, radiusM: OPEN_BUILDINGS_RADIUS_M },
  );
});

Deno.test("ownDataAnchor: a single building → its point, radius floored at 2 km", () => {
  const { centre, radiusM } = ownDataAnchor([{ lat: 49.45123, long: 11.08456 }]);
  assert.deepEqual(centre, { lat: 49.451, long: 11.085 }, "centre snapped to 3 decimals");
  assert.equal(radiusM, OPEN_BUILDINGS_RADIUS_M, "a zero-extent bbox floors at the minimum");
});

Deno.test("ownDataAnchor: clustered buildings → bbox centre + a covering radius", () => {
  const { centre, radiusM } = ownDataAnchor([
    { lat: 49.40, long: 11.00 },
    { lat: 49.50, long: 11.10 },
    { lat: 49.45, long: 11.05 },
  ]);
  assert.deepEqual(centre, { lat: 49.45, long: 11.05 }, "centre is the bbox midpoint");
  // ~5.5 km half-diagonal → above the floor, below the ceiling.
  assert.ok(radiusM > OPEN_BUILDINGS_RADIUS_M && radiusM < 20000);
});

Deno.test("ownDataAnchor: a spread portfolio clamps the radius to the 20 km ceiling", () => {
  // Nürnberg + Berlin → a huge bbox; the radius caps rather than fetching all of Germany.
  const { radiusM } = ownDataAnchor([
    { lat: 49.45, long: 11.08 },
    { lat: 52.52, long: 13.40 },
  ]);
  assert.equal(radiusM, 20000);
});
