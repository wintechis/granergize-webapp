/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { BuildingType } from "../../types.ts";
import { appearancesOf } from "./agentAppearances.ts";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";

function building(id: string, fields: Partial<BuildingType>): BuildingType {
  return { id, uri: `urn:b:${id}`, type: "x", ...fields } as BuildingType;
}

Deno.test("appearancesOf finds buildings by each agent role and tags the roles", () => {
  const buildings = [
    building("1", { streetAddress: "A St", operatedBy: ALICE }),
    building("2", { streetAddress: "B St", investor: ALICE, customer: ALICE }),
    building("3", { streetAddress: "C St", operatedBy: BOB }),
  ];

  const found = appearancesOf(ALICE, buildings);
  assert.equal(found.length, 2, "two buildings reference Alice");

  const b1 = found.find((a) => a.building.id === "1");
  assert.deepEqual(b1?.roles, ["Operated by"]);

  const b2 = found.find((a) => a.building.id === "2");
  // customer and investor both point at Alice → both roles listed (config order).
  assert.deepEqual(b2?.roles, ["Customer", "Investor"]);
});

Deno.test("appearancesOf matches attributedTo (provenance) and returns [] when unseen", () => {
  const buildings = [
    building("1", { attributedTo: ALICE }),
    building("2", { operatedBy: "A Plain Name" }),
  ];
  assert.deepEqual(appearancesOf(ALICE, buildings)[0]?.roles, ["Data source"]);
  assert.deepEqual(appearancesOf(BOB, buildings), [], "no match → empty");
});
