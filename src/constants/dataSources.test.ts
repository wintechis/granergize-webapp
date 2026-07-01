/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  DATA_SOURCES,
  SOURCES,
  sourceBase,
  sourceCapabilities,
} from "./dataSources.ts";

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

Deno.test("ids are the canonical wrapper path segments (lod2-by, wetterdienst, nuts, lau)", () => {
  const ids = new Set(DATA_SOURCES.map((s) => s.id));
  for (const id of ["lod2-by", "wetterdienst", "nuts", "lau", "mastr"]) {
    assert.ok(ids.has(id), `${id} present`);
  }
  // The old grouped/provider ids are gone (no backwards-compat alias).
  for (const gone of ["lod2", "dwd", "geo"]) {
    assert.ok(!ids.has(gone), `${gone} removed`);
  }
});

Deno.test("sourceBase resolves the registered base, env overrides it", () => {
  assert.equal(sourceBase("mastr"), "https://wunderfacts.com/mastr/");
  assert.equal(sourceBase("lod2-by"), "https://wunderfacts.com/lod2-by/");
  // Env override (Deno.env arm of the runtime-agnostic resolver).
  Deno.env.set("VITE_MASTR_API_URI", "https://mastr.test/");
  try {
    assert.equal(sourceBase("mastr"), "https://mastr.test/");
  } finally {
    Deno.env.delete("VITE_MASTR_API_URI");
  }
  assert.equal(sourceBase("mastr"), "https://wunderfacts.com/mastr/");
});

Deno.test("capabilities are declared for the gateway-discovery sources", () => {
  assert.deepEqual([...sourceCapabilities("mastr")], ["deref", "within", "search", "filter"]);
  assert.ok(sourceCapabilities("lau").includes("search"));
  assert.ok(sourceCapabilities("lau").includes("contains"));
  assert.ok(!sourceCapabilities("lau").includes("filter"));
  assert.deepEqual([...sourceCapabilities("osm")], []); // Nominatim JSON, no RDF verb
});
