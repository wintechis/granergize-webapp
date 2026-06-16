/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  buildCommandList,
  filterCommands,
  intentDialogAction,
  intentRoutesToDialog,
  type NavTarget,
} from "./commandPalette.ts";
import { withAction } from "../routes.ts";
import { findIntent, type IntentObject } from "../intents/applicable.ts";
import { INTENTS } from "../intents/catalog.ts";
import type { TFn } from "../context/I18nProvider.tsx";
import type { AggregationDefinition, BuildingType } from "../types.ts";

// Echoes the id so a test can see which label key resolved a command's label.
const echoT = ((id: string) => `t:${id}`) as unknown as TFn;

const NAV: NavTarget[] = [
  { path: "/buildings", labelKey: "navBuildings" },
  { path: "/aggregations", labelKey: "navAggregations" },
];

function building(over: Partial<BuildingType> = {}): BuildingType {
  return {
    id: "granergize/buildings/b1.ttl#it",
    uri: "https://alice.example/granergize/buildings/b1.ttl",
    type: "building",
    ...over,
  } as BuildingType;
}

function aggregation(over: Partial<AggregationDefinition> = {}): AggregationDefinition {
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

// ── intentRoutesToDialog: dialog-surface + params → dialog; else direct ──────

Deno.test("intentRoutesToDialog: rich (surface + params) routes; param-less / no-surface does not", () => {
  // Share has recipients/years params AND a dialog surface → routes to its dialog.
  assert.equal(intentRoutesToDialog(findIntent("ShareBuilding")!), true);
  // Edit has fields params AND a dialog surface → routes.
  assert.equal(intentRoutesToDialog(findIntent("UpdateBuilding")!), true);
  // Hide (ToggleVisibility) has a buildingUri param but NO dialog surface → direct.
  assert.equal(intentRoutesToDialog(findIntent("ToggleVisibility")!), false);
  // Refresh: no dialog surface → direct.
  assert.equal(intentRoutesToDialog(findIntent("RefreshAggregation")!), false);
  // Delete building: a confirm surface + a "building" param, so routes to its confirm.
  assert.equal(intentRoutesToDialog(findIntent("DeleteBuilding")!), true);
});

// ── intentDialogAction: rich verbs map to an auto-open token, others to null ──

Deno.test("intentDialogAction maps each wired rich verb to its surface token", () => {
  assert.equal(intentDialogAction(findIntent("AddBuilding")!), "add");
  assert.equal(intentDialogAction(findIntent("UpdateBuilding")!), "edit");
  assert.equal(intentDialogAction(findIntent("ShareBuilding")!), "share");
  assert.equal(
    intentDialogAction(findIntent("CreateAggregation")!),
    "create-aggregation",
  );
  assert.equal(
    intentDialogAction(findIntent("ShareAggregation")!),
    "share-aggregation",
  );
  // SaveObservation is a rich verb whose surface (EnergyYearDialog) lives on the
  // /observation page — it auto-opens from `?action=enter-energy`.
  assert.equal(intentDialogAction(findIntent("SaveObservation")!), "enter-energy");
});

Deno.test("SaveObservation routes to a dialog; DeleteObservation routes (no auto-open token)", () => {
  // Both observation verbs declare params AND a bespoke surface (EnergyYearDialog) →
  // both route to that dialog rather than firing directly.
  assert.equal(intentRoutesToDialog(findIntent("SaveObservation")!), true);
  assert.equal(intentRoutesToDialog(findIntent("DeleteObservation")!), true);
  // Save auto-opens the dialog (enter-energy token); Delete has no token — like
  // DeleteBuilding it routes to the surface where its per-year confirm lives.
  assert.equal(intentDialogAction(findIntent("SaveObservation")!), "enter-energy");
  assert.equal(intentDialogAction(findIntent("DeleteObservation")!), null);
});

Deno.test("intentDialogAction is null for a verb with no auto-open surface", () => {
  // DeleteBuilding routes to a confirm but has no `?action=` auto-open token —
  // the palette navigates to the page; the confirm is the surface's own flow.
  assert.equal(intentDialogAction(findIntent("DeleteBuilding")!), null);
  // A simple/direct verb is never dialog-action-tokened.
  assert.equal(intentDialogAction(findIntent("RefreshAggregation")!), null);
  assert.equal(intentDialogAction(findIntent("RestoreArchive")!), null);
});

Deno.test("every dialog-action token belongs to a verb that routes to a dialog", () => {
  // A token only makes sense for a rich (dialog-routed) verb — never a simple one.
  for (const e of INTENTS) {
    if (intentDialogAction(e) != null) {
      assert.ok(
        intentRoutesToDialog(e),
        `${e.name} has a dialog-action token but does not route to a dialog`,
      );
    }
  }
});

// ── withAction: appends ?action= preserving an existing query string ─────────

Deno.test("withAction appends ?action, preserving an existing id query param", () => {
  // A bare finder route → first query param.
  assert.equal(withAction("/buildings", "add"), "/buildings?action=add");
  // A detail route already carrying ?ref= → action joins with &.
  assert.equal(
    withAction("/building?ref=buildings%2Fb1.ttl%23it", "share"),
    "/building?ref=buildings%2Fb1.ttl%23it&action=share",
  );
  // The observation route carrying its id → enter-energy joins with &.
  assert.equal(
    withAction("/observation?ref=buildings%2Fb1.ttl%23it", "enter-energy"),
    "/observation?ref=buildings%2Fb1.ttl%23it&action=enter-energy",
  );
});

// ── buildCommandList: navigation always present, in order ────────────────────

Deno.test("navigation commands lead the list, in the given order, even with no object", () => {
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const nav = cmds.filter((c) => c.family === "navigation");
  assert.deepEqual(nav.map((c) => c.path), ["/buildings", "/aggregations"]);
  assert.deepEqual(nav.map((c) => c.label), ["t:navBuildings", "t:navAggregations"]);
  // Navigation precedes any intent command.
  const firstIntent = cmds.findIndex((c) => c.family === "intent");
  if (firstIntent > -1) assert.ok(firstIntent >= nav.length);
});

// ── buildCommandList: focused own building surfaces its verbs ─────────────────

Deno.test("own building: share routes to dialog; hide is excluded (shared-only)", () => {
  const cmds = buildCommandList({
    object: building({ isShared: false }),
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const intents = cmds.filter((c) => c.family === "intent").map((c) => c.entry!.name);
  // Share applies to an own building and routes to its dialog (no handler needed).
  assert.ok(intents.includes("ShareBuilding"));
  const share = cmds.find((c) => c.entry?.name === "ShareBuilding")!;
  assert.equal(share.routesToDialog, true);
  // Hide only applies to a shared building.
  assert.ok(!intents.includes("ToggleVisibility"));
});

Deno.test("shared building: hide surfaces only when a handler is supplied (direct verb)", () => {
  const shared = building({ isShared: true });
  // Without a handler, the param-less hide verb is dropped (nothing to invoke).
  const without = buildCommandList({
    object: shared,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  }).filter((c) => c.family === "intent").map((c) => c.entry!.name);
  assert.ok(!without.includes("ToggleVisibility"));

  // With a handler, it surfaces as a direct (non-dialog) command.
  const cmds = buildCommandList({
    object: shared,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: { ToggleVisibility: () => {} },
    t: echoT,
  });
  const hide = cmds.find((c) => c.entry?.name === "ToggleVisibility")!;
  assert.ok(hide);
  assert.equal(hide.routesToDialog, false);
});

// ── buildCommandList: label resolution via the i18n key map ──────────────────

Deno.test("a surfaced verb's label resolves through the i18n key", () => {
  const cmds = buildCommandList({
    object: aggregation({ lastComputedAt: "2026-02-01T00:00:00Z" }),
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  // ShareAggregation has an intentLabelKey → resolved via t().
  const share = cmds.find((c) => c.entry?.name === "ShareAggregation")!;
  assert.equal(share.label, "t:intentShareAggregation");
  // CreateAggregation now has a label key too → resolved via t().
  const create = cmds.find((c) => c.entry?.name === "CreateAggregation");
  if (create) assert.equal(create.label, "t:intentCreateAggregation");
});

// ── filterCommands: case-insensitive substring on the label ──────────────────

Deno.test("filterCommands matches a case-insensitive label substring", () => {
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const all = filterCommands(cmds, "");
  assert.equal(all.length, cmds.length, "empty query returns everything");

  const navBuildings = filterCommands(cmds, "navbuild");
  assert.ok(navBuildings.every((c) => c.label.toLowerCase().includes("navbuild")));
  assert.ok(navBuildings.some((c) => c.path === "/buildings"));

  assert.deepEqual(filterCommands(cmds, "zzz-no-match"), []);
});

// ── buildCommandList: a non-action object yields navigation only ─────────────

Deno.test("an Account object surfaces no per-object verbs beyond navigation/global", () => {
  const acct: IntentObject = { kind: "Account" };
  const cmds = buildCommandList({
    object: acct,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  // No building/aggregation guard passes for an Account → none is a building/agg verb.
  const intents = cmds.filter((c) => c.family === "intent").map((c) => c.entry!.name);
  assert.ok(!intents.includes("ShareBuilding"));
  assert.ok(!intents.includes("RefreshAggregation"));
});
