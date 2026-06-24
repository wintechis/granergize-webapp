/// <reference lib="deno.ns" />
// Tier-1: buildingToFields (the Add/Edit form seed). Asserts the editable
// master-data set — including customer/naceCode (now editable) — and that the
// structural rdf:type plus the identity/derived keys stay out of the form.
import { strict as assert } from "node:assert";
import type { BuildingType } from "../types.ts";
import { buildingToFields } from "./buildingFormSeed.ts";

const base = {
  uri: "https://pod.example/granergize/buildings/b1.ttl#it",
  id: "b1",
  type: "https://w3id.org/rec#Building",
  isShared: false,
} as unknown as BuildingType;

Deno.test("buildingToFields: seeds customer and naceCode (now editable master data)", () => {
  const f = buildingToFields({ ...base, customer: "Acme GmbH", naceCode: "52.10" });
  assert.equal(f.customer, "Acme GmbH");
  assert.equal(f.naceCode, "52.10");
});

Deno.test("buildingToFields: omits the structural rdf:type and identity/derived keys", () => {
  const f = buildingToFields({ ...base, customer: "Acme GmbH" });
  for (const k of ["type", "id", "uri", "isShared"]) {
    assert.ok(!(k in f), `${k} must not seed into the form`);
  }
});

Deno.test("buildingToFields: scalars by key; nested costs/certs flattened", () => {
  const f = buildingToFields({
    ...base,
    companyName: "Co",
    hallArea: 5000,
    hasHeatPump: true,
    operatingCosts: { security: "1200", operationInspectionAndMaintenance: true },
    certifications: [{ type: "DGNB", level: "Gold", scope: "Shell" }],
  } as unknown as BuildingType);
  assert.equal(f.companyName, "Co");
  assert.equal(f.hallArea, "5000");
  assert.equal(f.hasHeatPump, "true");
  assert.equal(f._opcost_security, "1200");
  assert.equal(f._opcost_operationInspectionAndMaintenance, "true");
  assert.equal(f._cert_0_type, "DGNB");
  assert.equal(f._cert_0_level, "Gold");
  assert.equal(f._cert_0_scope, "Shell");
});
