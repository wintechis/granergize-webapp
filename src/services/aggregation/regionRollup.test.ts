/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { commonRegion, kreisAgsOf } from "./regionRollup.ts";

// Nürnberg 09564000 / 09564001 (same Kreis 09564, Land 09); Fürth-Stadt 09563000 (same Land);
// Berlin 11000000 (Land 11). The IRI base comes from the app's regionalstatistik convention.
const ends = (iri: string | undefined, tail: string) =>
  assert.ok(iri?.endsWith(tail), `${iri} should end with ${tail}`);

Deno.test("all in one Gemeinde → the Gemeinde (finest)", () => {
  const r = commonRegion(["09564000", "09564000"]);
  assert.equal(r?.level, "gemeinde");
  ends(r?.region, "/ags/09564000");
});

Deno.test("same Kreis, different Gemeinden → the Kreis", () => {
  const r = commonRegion(["09564000", "09564001"]);
  assert.equal(r?.level, "kreis");
  ends(r?.region, "/ags/09564");
});

Deno.test("same Land, different Kreise → the Land", () => {
  const r = commonRegion(["09564000", "09563000"]);
  assert.equal(r?.level, "land");
  ends(r?.region, "/ags/09");
});

Deno.test("spanning Länder → the national (Bund) catch-all", () => {
  // Bayern (09…) + Hamburg (02…) share no Land prefix but are both German → NUTS-0 DE.
  const r = commonRegion(["09564000", "02000000"]);
  assert.equal(r?.level, "bund");
  assert.ok(r?.region.endsWith("/nuts/DE#it"), `${r?.region} should be the NUTS DE concept`);
});

Deno.test("a single building → its Gemeinde", () => {
  const r = commonRegion(["09564000"]);
  assert.equal(r?.level, "gemeinde");
  ends(r?.region, "/ags/09564000");
});

Deno.test("empty set → undefined", () => {
  assert.equal(commonRegion([]), undefined);
});

Deno.test("any missing / malformed AGS → undefined (no guessing from a partial set)", () => {
  assert.equal(commonRegion(["09564000", ""]), undefined);
  assert.equal(commonRegion(["09564000", "0956"]), undefined); // too short
  assert.equal(commonRegion(["09564000", "09564abc"]), undefined); // non-numeric
});

Deno.test("commonRegion(level): a chosen grain is honoured, or none if not all share it", () => {
  // Same Gemeinde, but the user asked for Kreis / Land → coarsen.
  assert.equal(commonRegion(["09564000", "09564000"], "kreis")?.level, "kreis");
  ends(commonRegion(["09564000", "09564000"], "kreis")?.region, "/ags/09564");
  assert.equal(commonRegion(["09564000", "09564000"], "land")?.level, "land");
  // Different Gemeinden: "gemeinde" requested but they don't share one → no extent.
  assert.equal(commonRegion(["09564000", "09564001"], "gemeinde"), undefined);
  // …yet they share a Kreis, so "kreis" still resolves.
  assert.equal(commonRegion(["09564000", "09564001"], "kreis")?.level, "kreis");
});

Deno.test("kreisAgsOf: Gemeinde/Kreis extent → 5-digit Kreis; Land/none → null", () => {
  assert.equal(kreisAgsOf(commonRegion(["09564000"])), "09564"); // Gemeinde → Kreis prefix
  assert.equal(kreisAgsOf(commonRegion(["09564000", "09564001"])), "09564"); // Kreis → itself
  assert.equal(kreisAgsOf(commonRegion(["09564000", "09563000"])), null); // Land-only → too coarse
  assert.equal(kreisAgsOf(undefined), null);
});
