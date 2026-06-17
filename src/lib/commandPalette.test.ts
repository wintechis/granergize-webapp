/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  buildCommandList,
  DIRECT_INVOKE_EXCLUDED,
  filterCommands,
  intentDialogAction,
  intentRoutesToDialog,
  isDirectInvokeEligible,
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

Deno.test("own building: share is form-eligible → routes to the param form (not the dialog)", () => {
  const cmds = buildCommandList({
    object: building({ isShared: false }),
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const intents = cmds.filter((c) => c.family === "intent").map((c) => c.entry!.name);
  // Share is form-eligible: it now opens the schema-driven param form (no handler,
  // no dialog route). The form path supersedes the bespoke dialog for it.
  assert.ok(intents.includes("ShareBuilding"));
  const share = cmds.find((c) => c.entry?.name === "ShareBuilding")!;
  assert.equal(share.routesToForm, true);
  assert.notEqual(share.routesToDialog, true);
});

Deno.test("hide (ToggleVisibility) is form-eligible → always surfaces, no handler needed", () => {
  // ToggleVisibility is form-eligible (buildingUri picker), so it reaches the
  // palette globally — even with no focused object and no handler — via the form.
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const hide = cmds.find((c) => c.entry?.name === "ToggleVisibility")!;
  assert.ok(hide, "form-eligible hide surfaces without focus/handler");
  assert.equal(hide.routesToForm, true);
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

// ── buildCommandList: form-eligible verbs reach the palette without focus ─────

Deno.test("form-eligible verbs surface globally (no focus) and are marked routesToForm", () => {
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const byName = new Map(cmds.map((c) => [c.entry?.name, c]));
  for (
    const name of [
      "ShareBuilding",
      "ShareAggregation",
      "RevokeBuildingAccess",
      "RemoveContact",
      "EnterRoom",
      "DeleteAggregation",
      // AddRoom's `input` is a genuine XSD_STRING text field → form-eligible.
      "AddRoom",
    ]
  ) {
    const c = byName.get(name);
    assert.ok(c, `${name} should surface globally`);
    assert.equal(c!.routesToForm, true);
  }
  // A non-form-eligible rich verb (UpdateBuilding) is NOT surfaced globally — it
  // needs its focused building (it routes to its bespoke edit dialog).
  assert.ok(!byName.has("UpdateBuilding"));
});

Deno.test("a focused object does not duplicate a form-eligible verb (deduped)", () => {
  const cmds = buildCommandList({
    object: building({ isShared: false }),
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const shares = cmds.filter((c) => c.entry?.name === "ShareBuilding");
  assert.equal(shares.length, 1, "ShareBuilding appears exactly once");
});

Deno.test("developer-only form-eligible verbs stay hidden outside dev mode", () => {
  // (None of the v1 form-eligible verbs is developer-gated, so the global pass
  // never leaks a developer verb when devMode is off — assert the set is clean.)
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  for (const c of cmds) {
    if (c.routesToForm) {
      assert.notEqual(c.entry?.exposure, "developer");
    }
  }
});

// ── direct-invoke: param-less write verbs fire straight from the palette ─────

Deno.test("isDirectInvokeEligible: param-less writes qualify; reads / RemoveAppData / param-ful do not", () => {
  // CreateRoom: param-less write → direct-invoke.
  assert.equal(isDirectInvokeEligible(findIntent("CreateRoom")!), true);
  // The dev seeders + inbox-drain + ACL rebuild are param-less writes → qualify
  // (exposure-gating is applied separately by buildCommandList).
  for (const n of ["SeedDemoBuildings", "SeedDemoContacts", "SeedDemoRooms", "CheckInbox", "ReissueGrants"]) {
    assert.equal(isDirectInvokeEligible(findIntent(n)!), true, `${n} qualifies`);
  }
  // RemoveAppData is a param-less write but explicitly excluded (destructive).
  assert.ok(DIRECT_INVOKE_EXCLUDED.has("RemoveAppData"));
  assert.equal(isDirectInvokeEligible(findIntent("RemoveAppData")!), false);
  // Param-less READS return a value needing handling → out of scope.
  assert.equal(isDirectInvokeEligible(findIntent("ExportArchive")!), false);
  assert.equal(isDirectInvokeEligible(findIntent("AuditGrants")!), false);
  // A param-ful write is not a direct-invoke (it routes to a form/dialog).
  assert.equal(isDirectInvokeEligible(findIntent("ShareBuilding")!), false);
});

Deno.test("CreateRoom surfaces as a direct-invoke command (standard exposure, no focus)", () => {
  const cmds = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const room = cmds.find((c) => c.entry?.name === "CreateRoom");
  assert.ok(room, "CreateRoom surfaces even with dev mode off");
  assert.equal(room!.routesToDirect, true);
  assert.notEqual(room!.routesToForm, true);
  assert.notEqual(room!.routesToDialog, true);
  // Reuses the Rooms-finder host-button wording.
  assert.equal(room!.label, "t:roomHostBtn");
});

Deno.test("dev direct-invoke verbs surface only in dev mode; RemoveAppData / reads never", () => {
  const dev = ["SeedDemoBuildings", "SeedDemoContacts", "SeedDemoRooms", "CheckInbox", "ReissueGrants"];

  const off = buildCommandList({
    object: undefined,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const offNames = new Set(off.map((c) => c.entry?.name));
  for (const n of dev) assert.ok(!offNames.has(n), `${n} hidden outside dev mode`);

  const on = buildCommandList({
    object: undefined,
    viewer: { devMode: true },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const onByName = new Map(on.map((c) => [c.entry?.name, c]));
  for (const n of dev) {
    const c = onByName.get(n);
    assert.ok(c, `${n} surfaces in dev mode`);
    assert.equal(c!.routesToDirect, true);
  }

  // Excluded / out-of-scope verbs never surface, in either mode.
  for (const cmds of [off, on]) {
    const names = new Set(cmds.map((c) => c.entry?.name));
    assert.ok(!names.has("RemoveAppData"), "RemoveAppData never one-click");
    assert.ok(!names.has("ExportArchive"), "ExportArchive (read) not surfaced");
    assert.ok(!names.has("AuditGrants"), "AuditGrants (read) not surfaced");
  }
});

// ── buildCommandList: a non-action object yields navigation only ─────────────

Deno.test("an Account object surfaces no AFFORDANCE-GUARDED per-object verb (form-eligible verbs still appear globally)", () => {
  const acct: IntentObject = { kind: "Account" };
  const cmds = buildCommandList({
    object: acct,
    viewer: { devMode: false },
    navTargets: NAV,
    handlers: {},
    t: echoT,
  });
  const intents = cmds.filter((c) => c.family === "intent");
  // The Account passes no building/aggregation affordance guard, so it surfaces no
  // *focused-object* verb. But form-eligible verbs reach the palette regardless of
  // focus (the form's pickers ARE the object selection) — ShareBuilding appears as
  // a form-routed command; RefreshAggregation likewise (also form-eligible).
  const share = intents.find((c) => c.entry?.name === "ShareBuilding");
  assert.ok(share);
  assert.equal(share!.routesToForm, true);
  const refresh = intents.find((c) => c.entry?.name === "RefreshAggregation");
  assert.ok(refresh);
  assert.equal(refresh!.routesToForm, true);
});
