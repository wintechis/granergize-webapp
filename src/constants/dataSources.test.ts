/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DATA_SOURCES, SOURCES } from "./dataSources.ts";

Deno.test("every data source has an id, name and use note", () => {
  for (const s of DATA_SOURCES) {
    assert.ok(s.id, "id present");
    assert.ok(s.name, `name present for ${s.id}`);
    assert.ok(s.note, `note present for ${s.id}`);
  }
});

Deno.test("ids are unique and the array mirrors the keyed map", () => {
  const ids = DATA_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "ids unique");
  assert.equal(DATA_SOURCES.length, Object.keys(SOURCES).length);
});

Deno.test("a licensed source links its licence document", () => {
  for (const s of DATA_SOURCES) {
    if (s.license) {
      assert.ok(
        s.licenseHref?.startsWith("https://"),
        `${s.id} has a licence URL when it states a licence`,
      );
    }
  }
});

Deno.test("the two provenance-recorded sources are present (OSM, Commons)", () => {
  // These back the provenance now written into the Pod Turtle.
  assert.equal(SOURCES.osm.license, "ODbL");
  assert.ok(SOURCES.commons.homepage?.includes("commons.wikimedia.org"));
});
