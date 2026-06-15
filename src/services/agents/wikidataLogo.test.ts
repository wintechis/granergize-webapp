/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { fetchWikidataLogo, wikidataEntityId } from "./wikidataLogo.ts";

const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/";

/** A fake fetch returning the given JSON; records whether it was called. */
function fakeJsonFetch(json: unknown): typeof fetch & { called: boolean } {
  const fn = (() => {
    fn.called = true;
    return Promise.resolve(
      new Response(JSON.stringify(json), { status: 200 }),
    );
  }) as unknown as typeof fetch & { called: boolean };
  fn.called = false;
  return fn;
}

/** EntityData JSON with the given claim properties on entity Q123. */
function entityData(
  id: string,
  claims: Record<string, unknown>,
): unknown {
  return { entities: { [id]: { claims } } };
}

/** A single claim statement carrying a Commons filename string value. */
function imageStatement(filename: string): unknown {
  return [{ mainsnak: { datavalue: { value: filename } } }];
}

Deno.test("wikidataEntityId parses entity and wiki IRIs, rejects others", () => {
  assert.equal(
    wikidataEntityId("http://www.wikidata.org/entity/Q42"),
    "Q42",
  );
  assert.equal(
    wikidataEntityId("https://www.wikidata.org/wiki/Q987"),
    "Q987",
  );
  assert.equal(
    wikidataEntityId("https://wikidata.org/entity/Q5"),
    "Q5",
  );
  assert.equal(wikidataEntityId("https://example.org/org#it"), undefined);
  assert.equal(
    wikidataEntityId("https://www.wikidata.org/wiki/Property:P154"),
    undefined,
  );
});

Deno.test("fetchWikidataLogo returns the Commons FilePath URL from P154", async () => {
  const fetchFn = fakeJsonFetch(
    entityData("Q123", { P154: imageStatement("Acme logo.svg") }),
  );
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/entity/Q123",
    fetchFn,
  );
  assert.equal(url, `${COMMONS}${encodeURIComponent("Acme logo.svg")}`);
  assert.equal(fetchFn.called, true);
});

Deno.test("fetchWikidataLogo falls back to P18 when no P154", async () => {
  const fetchFn = fakeJsonFetch(
    entityData("Q123", { P18: imageStatement("Acme building.jpg") }),
  );
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/wiki/Q123",
    fetchFn,
  );
  assert.equal(url, `${COMMONS}${encodeURIComponent("Acme building.jpg")}`);
});

Deno.test("fetchWikidataLogo prefers P154 over P18 when both present", async () => {
  const fetchFn = fakeJsonFetch(
    entityData("Q123", {
      P154: imageStatement("logo.svg"),
      P18: imageStatement("photo.jpg"),
    }),
  );
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/entity/Q123",
    fetchFn,
  );
  assert.equal(url, `${COMMONS}logo.svg`);
});

Deno.test("fetchWikidataLogo: non-Wikidata IRI returns undefined and does NOT fetch", async () => {
  const fetchFn = fakeJsonFetch({});
  const url = await fetchWikidataLogo("https://example.org/org#it", fetchFn);
  assert.equal(url, undefined);
  assert.equal(fetchFn.called, false, "no fetch for a non-Wikidata IRI");
});

Deno.test("fetchWikidataLogo: missing claims returns undefined", async () => {
  const fetchFn = fakeJsonFetch(entityData("Q123", {}));
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/entity/Q123",
    fetchFn,
  );
  assert.equal(url, undefined);
});

Deno.test("fetchWikidataLogo: fetch error returns undefined (never throws)", async () => {
  const throwing = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/entity/Q123",
    throwing,
  );
  assert.equal(url, undefined);
});

Deno.test("fetchWikidataLogo: non-OK response returns undefined", async () => {
  const notFound = (() =>
    Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
  const url = await fetchWikidataLogo(
    "https://www.wikidata.org/entity/Q123",
    notFound,
  );
  assert.equal(url, undefined);
});
