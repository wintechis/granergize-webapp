/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { buildingsByRegion } from "./buildingsByRegion.ts";
import { type Building } from "../../types.ts";

const b = (id: string, regionAgs?: string): Building => ({
  id,
  uri: id,
  type: "",
  isShared: false,
  ...(regionAgs ? { regionAgs } : {}),
});

Deno.test("buildingsByRegion: groups by the Kreis prefix (5 digits)", () => {
  const { byAgs, unplaced } = buildingsByRegion(
    [b("a", "09564000"), b("b", "09564111"), b("c", "09162000")],
    "kreis",
  );
  assert.equal(unplaced, 0);
  assert.deepEqual([...byAgs.keys()].sort(), ["09162", "09564"]);
  assert.equal(byAgs.get("09564")!.length, 2); // a + b share the Nürnberg Kreis
  assert.equal(byAgs.get("09162")!.length, 1);
});

Deno.test("buildingsByRegion: groups by the Land prefix (2 digits)", () => {
  const { byAgs } = buildingsByRegion(
    [b("a", "09564000"), b("b", "09162000"), b("c", "01001000")],
    "land",
  );
  assert.deepEqual([...byAgs.keys()].sort(), ["01", "09"]);
  assert.equal(byAgs.get("09")!.length, 2); // both Bavarian
});

Deno.test("buildingsByRegion: buildings without a usable AGS are unplaced, not dropped", () => {
  const { byAgs, unplaced } = buildingsByRegion(
    [b("a", "09564000"), b("b"), b("c", "09")], // c too short for kreis
    "kreis",
  );
  assert.equal(byAgs.size, 1);
  assert.equal(byAgs.get("09564")!.length, 1);
  assert.equal(unplaced, 2);
});
