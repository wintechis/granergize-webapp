/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  fieldKindFor,
  formEligibleNames,
  isFormEligible,
} from "./paramForm.ts";
import { INTENT_PARAMS } from "../intents/params.ts";

// ── isFormEligible: the exact v1 form-eligible set ───────────────────────────

const V1_FORM_ELIGIBLE = [
  "ShareBuilding",
  "ShareAggregation",
  "RevokeBuildingAccess",
  "RevokeAggregationAccess",
  "ToggleVisibility",
  "RemoveAgent",
  "DeleteAggregation",
  "RefreshAggregation",
  "CreateRoom",
  "EnterRoom",
  "ExitRoom",
  "DeleteRoom",
  "RemoveBookmark",
  "AddRoom",
].sort();

Deno.test("isFormEligible yields exactly the v1 form-eligible verb set", () => {
  assert.deepEqual(formEligibleNames().sort(), V1_FORM_ELIGIBLE);
});

Deno.test("each v1 verb is individually form-eligible", () => {
  for (const name of V1_FORM_ELIGIBLE) {
    assert.ok(isFormEligible(name), `${name} should be form-eligible`);
  }
});

// ── exclusions: opaque + bundle verbs are NOT eligible ───────────────────────

Deno.test("opaque / rich-dialog verbs are excluded", () => {
  for (
    const name of [
      "AddBuilding",
      "UpdateBuilding",
      "SaveObservation",
      "CreateAggregation",
      "SaveOrganisation",
      "UploadAttachments",
      "SaveAgent",
      "RestoreArchive",
      "DeleteBuilding",
    ]
  ) {
    assert.equal(isFormEligible(name), false, `${name} must be excluded`);
  }
});

Deno.test("fileUri+subjectUri bundle verbs are excluded", () => {
  for (const name of ["SetEnergyCertificate", "DeleteAttachment", "DeleteObservation"]) {
    assert.equal(isFormEligible(name), false, `${name} must be excluded`);
  }
});

Deno.test("SaveRoles is excluded (roles is a controlled vocab → needs a select, not text)", () => {
  assert.equal(isFormEligible("SaveRoles"), false);
});

Deno.test("AddRoom is form-eligible (its XSD_STRING input is a genuine text field)", () => {
  assert.ok(isFormEligible("AddRoom"));
});

Deno.test("CreateRoom is form-eligible (its optional name is a genuine text field)", () => {
  assert.ok(isFormEligible("CreateRoom"));
});

Deno.test("fieldKindFor resolves AddRoom.input (XSD_STRING) to a text field", () => {
  const d = fieldKindFor("AddRoom", "input", INTENT_PARAMS.AddRoom.input);
  assert.deepEqual(d, { kind: "text", multi: false, required: true });
});

Deno.test("param-less verbs are not form-eligible (nothing to capture)", () => {
  for (const name of ["CheckInbox", "ReissueGrants", "ExportArchive"]) {
    assert.equal(isFormEligible(name), false, `${name} has no params`);
  }
});

Deno.test("an unknown name is not form-eligible", () => {
  assert.equal(isFormEligible("NotAnIntent"), false);
});

// ── fieldKindFor: a representative param of each kind ─────────────────────────

Deno.test("fieldKindFor resolves the building param (single, required)", () => {
  const d = fieldKindFor(
    "ShareBuilding",
    "buildingUri",
    INTENT_PARAMS.ShareBuilding.buildingUri,
  );
  assert.deepEqual(d, { kind: "building", multi: false, required: true });
});

Deno.test("fieldKindFor resolves the agent recipients param (multi, required)", () => {
  const d = fieldKindFor(
    "ShareBuilding",
    "recipients",
    INTENT_PARAMS.ShareBuilding.recipients,
  );
  assert.deepEqual(d, { kind: "agent", multi: true, required: true });
});

Deno.test("fieldKindFor resolves a single agent webId param", () => {
  const d = fieldKindFor(
    "RevokeBuildingAccess",
    "webId",
    INTENT_PARAMS.RevokeBuildingAccess.webId,
  );
  assert.deepEqual(d, { kind: "agent", multi: false, required: true });
});

Deno.test("fieldKindFor: snapshotUri (LDP_RESOURCE) resolves to aggregation by context", () => {
  const d = fieldKindFor(
    "ShareAggregation",
    "snapshotUri",
    INTENT_PARAMS.ShareAggregation.snapshotUri,
  );
  assert.deepEqual(d, { kind: "aggregation", multi: false, required: true });
});

Deno.test("fieldKindFor: aggregationId literal-identity resolves to aggregation", () => {
  const d = fieldKindFor(
    "DeleteAggregation",
    "aggregationId",
    INTENT_PARAMS.DeleteAggregation.aggregationId,
  );
  assert.deepEqual(d, { kind: "aggregation", multi: false, required: true });
});

Deno.test("fieldKindFor: roomUri (LDP_RESOURCE) resolves to room by context", () => {
  const d = fieldKindFor(
    "EnterRoom",
    "roomUri",
    INTENT_PARAMS.EnterRoom.roomUri,
  );
  assert.deepEqual(d, { kind: "room", multi: false, required: true });
});

Deno.test("fieldKindFor resolves the boolean param", () => {
  const d = fieldKindFor(
    "ShareBuilding",
    "includeEnergyData",
    INTENT_PARAMS.ShareBuilding.includeEnergyData,
  );
  assert.deepEqual(d, { kind: "boolean", multi: false, required: true });
});

Deno.test("fieldKindFor resolves the year param (multi, optional)", () => {
  const d = fieldKindFor("ShareBuilding", "years", INTENT_PARAMS.ShareBuilding.years);
  // years is cardinality "many" → multi; required (not "optional").
  assert.deepEqual(d, { kind: "year", multi: true, required: true });
});
