/// <reference lib="deno.ns" />
import assert from "node:assert";
import {
  BUILDING_FRAGMENT,
  buildingFileUri,
  buildingFileUriFor,
  buildingIdFor,
  buildingIdStem,
  buildingSubjectFor,
  isAbsoluteIri,
  mintBuildingSubject,
} from "./buildingId.ts";

const ROOT = "https://alice.pod.example/";
const FILE = `${ROOT}granergize/buildings/2d1218ed-768c-4bb1.ttl`;
const SUBJECT = `${FILE}#it`;
const RELATIVE_ID = "granergize/buildings/2d1218ed-768c-4bb1.ttl#it";

Deno.test("mintBuildingSubject appends the constant fragment", () => {
  assert.equal(mintBuildingSubject(FILE), SUBJECT);
  assert.equal(BUILDING_FRAGMENT, "it");
});

Deno.test("isAbsoluteIri: scheme before any slash decides", () => {
  assert.equal(isAbsoluteIri("https://x.example/a#it"), true);
  assert.equal(isAbsoluteIri("urn:uuid:123"), true);
  assert.equal(isAbsoluteIri(RELATIVE_ID), false);
  // A ":" only AFTER the first "/" is not a scheme — still relative.
  assert.equal(isAbsoluteIri("granergize/odd:name.ttl#it"), false);
  // RFC 3986: "a:b/c" IS absolute (scheme "a").
  assert.equal(isAbsoluteIri("a:b/c"), true);
  assert.equal(isAbsoluteIri(""), false);
});

Deno.test("buildingIdFor: relative under own root, verbatim otherwise", () => {
  assert.equal(buildingIdFor(SUBJECT, ROOT), RELATIVE_ID);
  // Foreign subject: the absolute IRI verbatim, fragment preserved.
  const foreign = "https://bob.pod.example/granergize/buildings/x.ttl#building-1";
  assert.equal(buildingIdFor(foreign, ROOT), foreign);
  // No root resolved (fixtures, headless): absolute verbatim.
  assert.equal(buildingIdFor(SUBJECT), SUBJECT);
});

Deno.test("buildingSubjectFor inverts buildingIdFor for both shapes", () => {
  assert.equal(buildingSubjectFor(RELATIVE_ID, ROOT), SUBJECT);
  const foreign = "https://bob.pod.example/granergize/buildings/x.ttl#it";
  assert.equal(buildingSubjectFor(foreign, ROOT), foreign);
  // Round-trips.
  assert.equal(buildingSubjectFor(buildingIdFor(SUBJECT, ROOT), ROOT), SUBJECT);
  assert.equal(buildingIdFor(buildingSubjectFor(RELATIVE_ID, ROOT), ROOT), RELATIVE_ID);
});

Deno.test("buildingFileUri strips the fragment (only)", () => {
  assert.equal(buildingFileUri(SUBJECT), FILE);
  assert.equal(buildingFileUri(FILE), FILE); // already fragment-free
  assert.equal(buildingFileUriFor(RELATIVE_ID, ROOT), FILE);
  assert.equal(
    buildingFileUriFor("https://bob.pod.example/b.ttl#building-2", ROOT),
    "https://bob.pod.example/b.ttl",
  );
});

Deno.test("buildingIdStem: meaningful fragment, else file stem", () => {
  // Own building: "#it" is structural → the file stem.
  assert.equal(buildingIdStem(RELATIVE_ID), "2d1218ed-768c-4bb1");
  assert.equal(buildingIdStem(SUBJECT), "2d1218ed-768c-4bb1");
  // Foreign building with a meaningful fragment → the fragment.
  assert.equal(
    buildingIdStem("https://bob.pod.example/legacy.ttl#building-1"),
    "building-1",
  );
  // Fragment-free ref → the file stem.
  assert.equal(buildingIdStem("https://bob.pod.example/b9.ttl"), "b9");
});
