/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  applicableIntents,
  findIntent,
  intentApplies,
  type IntentObject,
} from "./applicable.ts";
import type { AggregationDefinition, BuildingType } from "../types.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function building(over: Partial<BuildingType> = {}): BuildingType {
  return {
    id: "granergize/buildings/b1.ttl#it",
    uri: "https://alice.example/granergize/buildings/b1.ttl",
    type: "building",
    ...over,
  } as BuildingType;
}

function aggregation(
  over: Partial<AggregationDefinition> = {},
): AggregationDefinition {
  return {
    id: "v1",
    name: "Portfolio",
    buildingUris: [],
    aggregationType: "average",
    metrics: ["electricity"],
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function applies(name: string, object: IntentObject, devMode = false): boolean {
  const e = findIntent(name);
  assert.ok(e, `intent ${name} exists`);
  return intentApplies(e!, object, { devMode });
}

// ── findIntent ───────────────────────────────────────────────────────────────

Deno.test("findIntent resolves a catalog name", () => {
  assert.ok(findIntent("ShareBuilding"));
  assert.equal(findIntent("NotAnIntent"), undefined);
});

// ── Guards: own vs shared building ───────────────────────────────────────────

Deno.test("own building: edit / share / delete / energy / upload apply", () => {
  const own = building({ isShared: false });
  for (
    const v of [
      "UpdateBuilding",
      "ShareBuilding",
      "DeleteBuilding",
      "SaveObservation",
      "RevokeBuildingAccess",
      "UploadAttachments",
    ]
  ) {
    assert.ok(applies(v, own), `${v} applies to an own building`);
  }
});

Deno.test("shared building: edit / share / delete do NOT apply", () => {
  const shared = building({ isShared: true });
  for (const v of ["UpdateBuilding", "ShareBuilding", "DeleteBuilding"]) {
    assert.ok(!applies(v, shared), `${v} must not apply to a shared building`);
  }
});

Deno.test("ToggleVisibility applies only to a shared building", () => {
  assert.ok(applies("ToggleVisibility", building({ isShared: true })));
  assert.ok(!applies("ToggleVisibility", building({ isShared: false })));
});

// ── Guards: energy / attachment presence ─────────────────────────────────────

Deno.test("DeleteObservation applies only to an own building that has energy", () => {
  const withEnergy = building({
    isShared: false,
    energyDatasets: [{ year: 2024 } as never],
  });
  const without = building({ isShared: false, energyDatasets: [] });
  const shared = building({
    isShared: true,
    energyDatasets: [{ year: 2024 } as never],
  });
  assert.ok(applies("DeleteObservation", withEnergy));
  assert.ok(!applies("DeleteObservation", without));
  assert.ok(!applies("DeleteObservation", shared));
});

Deno.test("DeleteAttachment / SetEnergyCertificate need an own building with attachments", () => {
  const withFiles = building({
    isShared: false,
    attachments: [{ uri: "x" } as never],
  });
  const without = building({ isShared: false, attachments: [] });
  for (const v of ["DeleteAttachment", "SetEnergyCertificate"]) {
    assert.ok(applies(v, withFiles), `${v} applies when attachments present`);
    assert.ok(!applies(v, without), `${v} not when no attachments`);
  }
});

// ── Guards: aggregation snapshot existence ───────────────────────────────────

Deno.test("RefreshAggregation / ShareAggregation apply only with a computed snapshot", () => {
  const withSnap = aggregation({ lastComputedAt: "2026-02-01T00:00:00Z" });
  const noSnap = aggregation({ lastComputedAt: undefined });
  for (const v of ["RefreshAggregation", "ShareAggregation"]) {
    assert.ok(applies(v, withSnap), `${v} applies once a snapshot exists`);
    assert.ok(!applies(v, noSnap), `${v} not before a snapshot exists`);
  }
});

Deno.test("DeleteAggregation applies to any aggregation definition, not a building", () => {
  assert.ok(applies("DeleteAggregation", aggregation()));
  assert.ok(!applies("DeleteAggregation", building()));
});

// ── Guards: developer-mode exposure ──────────────────────────────────────────

Deno.test("developer-gated verbs apply only with devMode on (affordance guard)", () => {
  for (const v of ["RemoveAppData", "ExportArchive", "CheckInbox"]) {
    assert.ok(!applies(v, { kind: "Account" }, false), `${v} hidden without dev`);
    assert.ok(applies(v, { kind: "Account" }, true), `${v} shown with dev`);
  }
});

// ── applicableIntents: the filtered + ordered affordance set ─────────────────

Deno.test("applicableIntents on an own building offers owner verbs, hides shared/dev verbs", () => {
  const own = building({ isShared: false });
  const verbs = applicableIntents(own, { devMode: false }).map((e) => e.name);
  assert.ok(verbs.includes("ShareBuilding"));
  assert.ok(verbs.includes("UpdateBuilding"));
  assert.ok(verbs.includes("DeleteBuilding"));
  assert.ok(!verbs.includes("ToggleVisibility")); // shared-only
  assert.ok(!verbs.includes("RemoveAppData")); // dev-only
});

Deno.test("applicableIntents respects the developer-mode gate", () => {
  const acct: IntentObject = { kind: "Account" };
  const off = applicableIntents(acct, { devMode: false }).map((e) => e.name);
  const on = applicableIntents(acct, { devMode: true }).map((e) => e.name);
  assert.ok(!off.includes("RemoveAppData"));
  assert.ok(on.includes("RemoveAppData"));
});

Deno.test("applicableIntents follows the catalog source order (aggregation snapshot set)", () => {
  const withSnap = aggregation({ lastComputedAt: "2026-02-01T00:00:00Z" });
  const verbs = applicableIntents(withSnap, { devMode: false })
    .map((e) => e.name)
    .filter((n) =>
      ["DeleteAggregation", "RefreshAggregation", "ShareAggregation"].includes(n)
    );
  // Catalog order: Create, Delete, Refresh, Share, RevokeAccess → among these three,
  // Delete precedes Refresh precedes Share.
  assert.deepEqual(verbs, [
    "DeleteAggregation",
    "RefreshAggregation",
    "ShareAggregation",
  ]);
});
