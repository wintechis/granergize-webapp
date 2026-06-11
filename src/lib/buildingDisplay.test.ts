/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { BuildingType } from "../types.ts";
import { buildingAddressLine, buildingDisplayName } from "./buildingDisplay.ts";

function building(fields: Partial<BuildingType>): BuildingType {
  return { id: "b1", uri: "urn:b:b1", type: "x", ...fields } as BuildingType;
}

Deno.test("buildingDisplayName prefers label, then code, then address, then the verbatim id", () => {
  assert.equal(
    buildingDisplayName(
      building({ label: "Halle Nord", buildingCode: "C-1", streetAddress: "A St" }),
    ),
    "Halle Nord",
  );
  assert.equal(
    buildingDisplayName(building({ buildingCode: "C-1", streetAddress: "A St" })),
    "C-1",
  );
  assert.equal(buildingDisplayName(building({ streetAddress: "A St" })), "A St");
  // The id fallback shows the IRI-extracted id verbatim (heike-5 #1) — never a
  // derived number that exists nowhere in the data.
  assert.equal(buildingDisplayName(building({})), "Building b1");
});

Deno.test("buildingAddressLine joins street and city parts, omitting unset ones", () => {
  assert.equal(
    buildingAddressLine(
      building({ streetAddress: "A St 1", postalCode: "90402", locality: "Nürnberg" }),
    ),
    "A St 1, 90402 Nürnberg",
  );
  assert.equal(buildingAddressLine(building({ streetAddress: "A St 1" })), "A St 1");
  assert.equal(buildingAddressLine(building({ locality: "Nürnberg" })), "Nürnberg");
  assert.equal(buildingAddressLine(building({})), "");
});
