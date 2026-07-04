/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { SourceId } from "../../constants/dataSources.ts";
import { makeFakeSourceGateway } from "../testing/fakeSourceGateway.ts";
import { contains, deref, filter, nearby, search, within } from "./capabilities.ts";

// Short, readable test bases instead of the production wunderfacts ones.
const TEST_BASES: Partial<Record<SourceId, string>> = {
  mastr: "https://mastr.test/",
  lau: "https://lau.test/",
  nuts: "https://nuts.test/",
  "lod2-by": "https://lod2.test/",
};
const baseOf = (s: SourceId) => TEST_BASES[s] ?? `https://${s}.test/`;

const CONCEPT = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<https://lau.test/lau/DE_09562000#it> a skos:Concept ;
  skos:notation "DE_09562000" ; skos:prefLabel "Erlangen" .`;

// A fake that serves the same body for any URL, recording the requested URLs.
function gatewayServing(body: string) {
  return makeFakeSourceGateway({ baseOf, respond: () => new Response(body) });
}

Deno.test("search builds /search?q= and parses the concept", async () => {
  const fake = gatewayServing(CONCEPT);
  const store = await search(fake.gateway, "lau", "erlangen");
  assert.equal(fake.calls[0].url, "https://lau.test/search?q=erlangen");
  assert.ok(store.size >= 3, "parsed the SKOS triples");
  assert.equal(
    store.getObjects(null, "http://www.w3.org/2004/02/skos/core#notation", null)[0]
      ?.value,
    "DE_09562000",
  );
});

Deno.test("search appends extra params (level/country/count)", async () => {
  const fake = gatewayServing(CONCEPT);
  await search(fake.gateway, "lau", "erlangen", { country: "DE", count: 5 });
  assert.equal(
    fake.calls[0].url,
    "https://lau.test/search?q=erlangen&country=DE&count=5",
  );
});

Deno.test("filter builds /filter?ags=, arrays repeat the key", async () => {
  const fake = gatewayServing("");
  await filter(fake.gateway, "mastr", { ags: "09562000" });
  assert.equal(fake.calls[0].url, "https://mastr.test/filter?ags=09562000");

  const fake2 = gatewayServing("");
  await filter(fake2.gateway, "mastr", { ags: "09", carrier: ["2495", "2957"] });
  assert.equal(
    fake2.calls[0].url,
    "https://mastr.test/filter?ags=09&carrier=2495&carrier=2957",
  );
});

Deno.test("within / nearby / contains build their grammars", async () => {
  const fb = gatewayServing("");
  await within(fb.gateway, "mastr", { w: 10, s: 47, e: 13, n: 50 }, { count: 500 });
  assert.equal(fb.calls[0].url, "https://mastr.test/within?bbox=10,47,13,50&count=500");

  const fp = gatewayServing("");
  await nearby(fp.gateway, "lod2-by", { lon: 11, lat: 49, r: 300 });
  assert.equal(fp.calls[0].url, "https://lod2.test/nearby?lon=11&lat=49&r=300");

  const fc = gatewayServing("");
  await contains(fc.gateway, "nuts", { lat: 49, lon: 11 });
  assert.equal(fc.calls[0].url, "https://nuts.test/contains?lat=49&lon=11");
});

Deno.test("deref fetches the absolute IRI, fragment stripped", async () => {
  const fake = gatewayServing(CONCEPT);
  await deref(fake.gateway, "https://mastr.test/see/123#it");
  assert.equal(fake.calls[0].url, "https://mastr.test/see/123");
});

Deno.test("a wrong source+verb pairing throws (capability assert)", async () => {
  const fake = gatewayServing("");
  // lau serves deref/contains/search but NOT filter.
  await assert.rejects(
    () => filter(fake.gateway, "lau", { ags: "09" }),
    /does not serve \/filter/,
  );
  // dwd serves only deref.
  await assert.rejects(
    () => search(fake.gateway, "dwd", "nuremberg"),
    /does not serve \/search/,
  );
});

Deno.test("a non-ok response throws with status and url", async () => {
  const fake = makeFakeSourceGateway({
    baseOf,
    respond: () => new Response("nope", { status: 503 }),
  });
  await assert.rejects(
    () => search(fake.gateway, "lau", "erlangen"),
    /503 for https:\/\/lau\.test\/search/,
  );
});
