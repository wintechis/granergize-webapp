/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { VOCAB_SCHEMA } from "./vocabSchema.generated.ts";
import { generateSchema, renderModule } from "../../../scripts/genVocabSchema.ts";
import { BUILDING_FIELDS, schemaFor } from "./building/buildingConfig.ts";

const BUILDING_NS = "https://solid.ti.rw.fau.de/gra/building.ttl#";
const REC_NS = "https://w3id.org/rec#";

Deno.test("generated schema is fresh (matches a regeneration from the vocab)", () => {
  const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
  const regenerated = renderModule(generateSchema(repoRoot));
  const committed = Deno.readTextFileSync(
    new URL("./vocabSchema.generated.ts", import.meta.url),
  );
  assert.equal(
    regenerated,
    committed,
    "vocabSchema.generated.ts is stale — run `deno task gen:schema`",
  );
});

Deno.test("classifies building properties by range (literal / agent / enum / structured)", () => {
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}hasBuildingArea`].kind, "literal");
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}hasBuildingArea`].datatype, "integer");
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}hallArea`].datatype, "decimal");
  assert.equal(VOCAB_SCHEMA[`${REC_NS}operatedBy`].kind, "agent");
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}shiftRegime`].kind, "enum");
  // Node-shape ranges (parsed by hand) are NOT flat fields.
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}hasSystem`].kind, "structured");
  assert.equal(VOCAB_SCHEMA[`${BUILDING_NS}hasOperatingCosts`].kind, "structured");
});

Deno.test("enum properties list their controlled-vocab instances", () => {
  const shift = VOCAB_SCHEMA[`${BUILDING_NS}shiftRegime`];
  assert.ok(shift.instances?.includes(`${BUILDING_NS}OneShift`));
  assert.equal(shift.instances?.length, 3);
});

Deno.test("every BUILDING_FIELDS bridge entry maps to a FLAT (non-structured) term", () => {
  // A flat app field must resolve to a literal/agent/enum vocab term — never a node
  // shape (which the parser handles by hand). Catches a mis-bridged IRI.
  for (const f of BUILDING_FIELDS) {
    assert.notEqual(
      schemaFor(f.iri).kind,
      "structured",
      `${String(f.field)} (${f.iri}) bridges to a structured node, not a flat field`,
    );
  }
});
