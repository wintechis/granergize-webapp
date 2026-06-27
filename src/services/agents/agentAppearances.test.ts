/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Building } from "../../types.ts";
import {
  appearancesOf,
  referencedAgentTiers,
  referencedAgentWebIds,
} from "./agentAppearances.ts";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";

function building(id: string, fields: Partial<Building>): Building {
  return { id, uri: `urn:b:${id}`, type: "x", ...fields } as Building;
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
  // customer and investor both point at Alice → both roles listed (config order:
  // investor precedes customer in AGENT_ROLES).
  assert.deepEqual(b2?.roles, ["Investor", "Customer"]);
});

Deno.test("appearancesOf covers the full agent-role set (ownedBy/managed/developed/consulted)", () => {
  const buildings = [
    building("1", { ownedBy: ALICE }),
    building("2", { facilityManagedBy: ALICE }),
    building("3", { developedBy: ALICE }),
    building("4", { consultedBy: ALICE }),
  ];
  const roles = appearancesOf(ALICE, buildings).flatMap((a) => a.roles);
  assert.deepEqual(roles.sort(), ["Consulted by", "Developed by", "Facility management", "Owned by"]);
});

Deno.test("referencedAgentWebIds collects distinct WebID agents, skips free-text names", () => {
  const buildings = [
    building("1", { operatedBy: ALICE, ownedBy: BOB }),
    building("2", { operatedBy: ALICE, attributedTo: "https://acme.example/org#it" }),
    // A free-text operator name (not a WebID) is NOT a resolvable agent → excluded.
    building("3", { operatedBy: "Müller Logistik GmbH" }),
  ];
  const ids = referencedAgentWebIds(buildings).sort();
  assert.deepEqual(ids, [ALICE, "https://acme.example/org#it", BOB].sort());
});

Deno.test("referencedAgentWebIds is empty when no building references a WebID", () => {
  assert.deepEqual(referencedAgentWebIds([building("1", { operatedBy: "ACME" })]), []);
  assert.deepEqual(referencedAgentWebIds([]), []);
});

Deno.test("referencedAgentWebIds + appearancesOf include technical-system operators", () => {
  // The bulk-imported plant operators live on the building's system nodes
  // (rec:operatedBy on <#pv>/<#chp>), not the building's own operatedBy.
  const buildings = [
    building("1", {
      systems: [
        { id: "pv", kind: "pv", operatedBy: ALICE },
        { id: "chp", kind: "chp", operatedBy: BOB },
      ],
    }),
    // Alice also operates this one's PV and owns the building.
    building("2", { ownedBy: ALICE, systems: [{ id: "pv", kind: "pv", operatedBy: ALICE }] }),
  ];
  // Both plant operators surface as referenced agents (deduped).
  assert.deepEqual(referencedAgentWebIds(buildings).sort(), [ALICE, BOB].sort());
  // The agent detail "appears in" lists the system-operator role per building.
  const alice = appearancesOf(ALICE, buildings);
  assert.equal(alice.length, 2);
  assert.deepEqual(alice.find((a) => a.building.id === "1")?.roles, ["PV operator"]);
  assert.deepEqual(
    alice.find((a) => a.building.id === "2")?.roles,
    ["Owned by", "PV operator"],
  );
  assert.deepEqual(appearancesOf(BOB, buildings)[0]?.roles, ["CHP operator"]);
});

Deno.test("referencedAgentTiers: own building → mine, shared building → shared, both → both", () => {
  const buildings = [
    building("1", { operatedBy: ALICE }), // own (isShared falsy) → mine
    building("2", { isShared: true, ownedBy: ALICE, operatedBy: BOB }), // shared
    building("3", { isShared: true, systems: [{ id: "pv", kind: "pv", operatedBy: ALICE }] }),
  ];
  const tiers = referencedAgentTiers(buildings);
  // Alice: own building (mine) + shared buildings (shared) → both.
  assert.deepEqual([...(tiers.get(ALICE) ?? [])].sort(), ["mine", "shared"]);
  // Bob: only a shared building → shared.
  assert.deepEqual([...(tiers.get(BOB) ?? [])], ["shared"]);
});

Deno.test("appearancesOf matches attributedTo (provenance) and returns [] when unseen", () => {
  const buildings = [
    building("1", { attributedTo: ALICE }),
    building("2", { operatedBy: "A Plain Name" }),
  ];
  assert.deepEqual(appearancesOf(ALICE, buildings)[0]?.roles, ["Data source"]);
  assert.deepEqual(appearancesOf(BOB, buildings), [], "no match → empty");
});
