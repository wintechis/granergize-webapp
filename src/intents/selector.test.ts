/// <reference lib="deno.ns" />
//
// Tier-1 for the attribute selector (plan-attribute-facets): the pure evaluator
// (matches/filter), the field-kind derivation, and the gold-vs-produced comparator
// the eval uses (selectorEquals). No Pod.
import { strict as assert } from "node:assert";
import type { BuildingType } from "../types.ts";
import {
  fieldsByKind,
  filter,
  matches,
  type Selector,
  selectorEquals,
} from "./selector.ts";

// Minimal building fixtures (only the fields under test; cast through unknown).
const b = (o: Record<string, unknown>) => o as unknown as BuildingType;
const warm = b({ id: "1", hallArea: 6000, hasHeatPump: true, locality: "Nürnberg", yearOfConstruction: 2015 });
const cold = b({ id: "2", hallArea: 2000, hasHeatPump: false, locality: "Fürth", yearOfConstruction: 1998 });
const sel = (...and: Selector["and"][number][]): Selector => ({ and });

Deno.test("numeric ops compare coerced values", () => {
  assert.equal(matches(warm, sel({ field: "hallArea", op: "gt", value: 5000 })), true);
  assert.equal(matches(cold, sel({ field: "hallArea", op: "gt", value: 5000 })), false);
  assert.equal(matches(cold, sel({ field: "yearOfConstruction", op: "lt", value: 2000 })), true);
});

Deno.test("boolean eq + presence (has/lacks)", () => {
  assert.equal(matches(warm, sel({ field: "hasHeatPump", op: "eq", value: true })), true);
  assert.equal(matches(cold, sel({ field: "hasHeatPump", op: "eq", value: true })), false);
  // false is treated as absent for has/lacks
  assert.equal(matches(cold, sel({ field: "hasHeatPump", op: "has" })), false);
  assert.equal(matches(cold, sel({ field: "hasHeatPump", op: "lacks" })), true);
});

Deno.test("text eq is case-insensitive; contains + in", () => {
  assert.equal(matches(warm, sel({ field: "locality", op: "eq", value: "nürnberg" })), true);
  assert.equal(matches(warm, sel({ field: "locality", op: "contains", value: "ürnb" })), true);
  assert.equal(matches(warm, sel({ field: "locality", op: "in", value: ["Fürth", "Nürnberg"] })), true);
  assert.equal(matches(cold, sel({ field: "locality", op: "in", value: ["Nürnberg"] })), false);
});

Deno.test("AND semantics; empty selector matches all; unknown field fails", () => {
  assert.equal(
    matches(warm, sel({ field: "hasHeatPump", op: "eq", value: true }, { field: "hallArea", op: "gt", value: 5000 })),
    true,
  );
  assert.equal(
    matches(warm, sel({ field: "hasHeatPump", op: "eq", value: true }, { field: "hallArea", op: "gt", value: 9999 })),
    false,
  );
  assert.equal(matches(warm, sel()), true); // empty AND
  assert.equal(matches(warm, sel({ field: "noSuchField", op: "has" })), false);
});

Deno.test("filter narrows a set", () => {
  const out = filter([warm, cold], sel({ field: "hallArea", op: "gt", value: 5000 }));
  assert.deepEqual(out.map((x) => (x as unknown as { id: string }).id), ["1"]);
});

Deno.test("fieldsByKind derives kinds from the building schema", () => {
  const g = fieldsByKind();
  assert.ok(g.numeric.includes("hallArea"));
  assert.ok(g.boolean.includes("hasHeatPump"));
  assert.ok(g.text.includes("locality"));
});

Deno.test("selectorEquals: order-insensitive, value-normalised, tolerant of shapes", () => {
  const a = { and: [{ field: "hallArea", op: "gt", value: 5000 }, { field: "hasHeatPump", op: "eq", value: true }] };
  const reordered = { and: [{ field: "hasHeatPump", op: "eq", value: true }, { field: "hallArea", op: "gt", value: 5000 }] };
  assert.equal(selectorEquals(a, reordered), true);
  // value normalisation: number-as-string and case-folding
  assert.equal(
    selectorEquals({ and: [{ field: "Locality", op: "eq", value: "Nürnberg" }] }, [{ field: "locality", op: "eq", value: "nürnberg" }]),
    true,
  );
  // a different constraint set is not equal
  assert.equal(selectorEquals(a, { and: [{ field: "hallArea", op: "gt", value: 5000 }] }), false);
});
