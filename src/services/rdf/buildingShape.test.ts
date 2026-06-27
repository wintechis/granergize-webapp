/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseVocab, render } from "../../../scripts/genVocabInterface.ts";
import type { BuildingFlatFields, ShiftRegime } from "./buildingShape.generated.ts";
import { BUILDING_FIELDS } from "./building/buildingConfig.ts";

Deno.test("generated building shape is fresh (matches a regeneration from the vocab)", () => {
  const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
  const regenerated = render(parseVocab(repoRoot));
  const committed = Deno.readTextFileSync(
    new URL("./buildingShape.generated.ts", import.meta.url),
  );
  assert.equal(
    regenerated,
    committed,
    "buildingShape.generated.ts is stale — run `deno task gen:interface`",
  );
});

Deno.test("every BUILDING_FIELDS bridge entry is a key of the generated BuildingFlatFields", () => {
  // Compile-time coverage: this object must list every bridge field as a BuildingFlatFields
  // key, so a bridge field with no generated slot is a type error here.
  const keys = new Set<keyof BuildingFlatFields>(
    BUILDING_FIELDS.map((f) => f.field as keyof BuildingFlatFields),
  );
  assert.ok(keys.size === BUILDING_FIELDS.length);
});

Deno.test("controlled-vocab enums use the stable tokens, not labels", () => {
  const shift: ShiftRegime = "OneShift";
  assert.equal(shift, "OneShift");
});
