/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { geocodeFields, geocodeWithRegion } from "./geocode.ts";
import {
  abbreviateRegisterCity,
  displayCaseRegisterStreet,
  normalizeRegisterCity,
  parseAddressApiPoint,
  parseAddressApiResults,
  splitStreetAddress,
} from "./addressApi.ts";

/** A linked-addressapi `search.json` response with `n` register hits at one point. */
function searchResponse(n: number, hit = { lat: 49.45, lon: 11.07 }): string {
  return JSON.stringify({ count: n, results: Array.from({ length: n }, () => hit) });
}

/**
 * Stub the global `fetch` (geocode goes through `trackedFetch` → bare `fetch`).
 * `hits` maps a stringified `postcode=…`/`city=…` discriminator to a hit count;
 * an unmatched query returns `count: 0` (a miss, which drives the candidate
 * spellings). Records every queried discriminator so tests can assert order.
 */
function stubFetch(hits: Record<string, number>) {
  const queried: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input.toString());
    const key = url.searchParams.has("postcode")
      ? `postcode=${url.searchParams.get("postcode")}`
      : `city=${url.searchParams.get("city")}`;
    queried.push(key);
    return Promise.resolve(
      new Response(searchResponse(hits[key] ?? 0), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { queried, restore: () => (globalThis.fetch = orig) };
}

Deno.test("geocodeFields resolves a full address postcode-first to Address precision", async () => {
  const { queried, restore } = stubFetch({ "postcode=90402": 1 });
  try {
    const got = await geocodeFields({
      streetAddress: "Hauptstraße 1",
      postalCode: "90402",
      locality: "Nürnberg",
    });
    assert.deepEqual(got, { lat: "49.45", long: "11.07", precision: "Address" });
    assert.deepEqual(queried, ["postcode=90402"], "a postcode hit makes exactly one request");
  } finally {
    restore();
  }
});

Deno.test("geocodeFields falls back to normalised then abbreviated city spellings", async () => {
  // No postcode; the normalised spelling misses, the register's abbreviated one hits.
  const { queried, restore } = stubFetch({ "city=SCHWAIG B.NÜRNBERG": 1 });
  try {
    const got = await geocodeFields({
      streetAddress: "Oberer Röthelweg 64",
      locality: "Schwaig bei Nürnberg",
    });
    assert.equal(got?.precision, "Address");
    assert.deepEqual(queried, ["city=SCHWAIG BEI NÜRNBERG", "city=SCHWAIG B.NÜRNBERG"]);
  } finally {
    restore();
  }
});

Deno.test("geocodeFields treats an ambiguous (multi-hit) result as a miss", async () => {
  // Road-level ambiguity (count > 1) must not place the building on an arbitrary hit.
  const { restore } = stubFetch({ "postcode=90402": 90 });
  try {
    assert.equal(
      await geocodeFields({ streetAddress: "Hauptstraße 1", postalCode: "90402" }),
      null,
    );
  } finally {
    restore();
  }
});

Deno.test("geocodeFields returns null without a splittable street address (no request)", async () => {
  const { queried, restore } = stubFetch({});
  try {
    // The addressapi is structured: postcode- or city-only never geocodes.
    assert.equal(await geocodeFields({ locality: "Nürnberg" }), null);
    assert.equal(await geocodeFields({ streetAddress: "Musterstraße" }), null);
    assert.equal(await geocodeFields({}), null);
    assert.equal(queried.length, 0, "no full address → no request");
  } finally {
    restore();
  }
});

Deno.test("geocodeFields returns null with a street but neither postcode nor city", async () => {
  const { queried, restore } = stubFetch({});
  try {
    assert.equal(await geocodeFields({ streetAddress: "Hauptstraße 1" }), null);
    assert.equal(queried.length, 0);
  } finally {
    restore();
  }
});

/** Stub the addressapi search (a single hit) + the linked-lau `/contains` lookup (a SKOS reply). */
function stubGeocodeAndContains(contains: Response) {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("/contains")) return Promise.resolve(contains.clone());
    return Promise.resolve(
      new Response(searchResponse(1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return () => (globalThis.fetch = orig);
}

const FULL_ADDRESS = {
  streetAddress: "Hauptstraße 1",
  postalCode: "90402",
  locality: "Nürnberg",
};

Deno.test("geocodeWithRegion adds the Gemeinde AGS from the /contains lookup", async () => {
  const restore = stubGeocodeAndContains(
    new Response(
      `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
       <r> a skos:Concept ; skos:notation "DE_09564000" .`,
      { status: 200, headers: { "content-type": "text/turtle" } },
    ),
  );
  try {
    const got = await geocodeWithRegion(FULL_ADDRESS);
    assert.equal(got?.lat, "49.45");
    assert.equal(got?.precision, "Address");
    assert.equal(got?.regionAgs, "09564000");
  } finally {
    restore();
  }
});

Deno.test("geocodeWithRegion: coords still returned when /contains has no region", async () => {
  const restore = stubGeocodeAndContains(new Response("", { status: 404 }));
  try {
    const got = await geocodeWithRegion(FULL_ADDRESS);
    assert.equal(got?.lat, "49.45");
    assert.equal(got?.regionAgs, undefined);
  } finally {
    restore();
  }
});

// ---- pure addressApi.ts helpers ----------------------------------------------

Deno.test("splitStreetAddress: greedy road / housenumber split", () => {
  assert.deepEqual(splitStreetAddress("Rother Straße 1 a"), {
    road: "Rother Straße",
    housenumber: "1 a",
  });
  assert.deepEqual(splitStreetAddress("Straße des 17. Juni 5"), {
    road: "Straße des 17. Juni",
    housenumber: "5",
  });
  assert.equal(splitStreetAddress("Musterstraße"), undefined);
  assert.equal(splitStreetAddress(undefined), undefined);
});

Deno.test("normalizeRegisterCity / abbreviateRegisterCity match the register's spellings", () => {
  // Already-abbreviated source forms: only the dot spacing is tightened.
  assert.equal(normalizeRegisterCity("Neunkirchen a. Sand"), "NEUNKIRCHEN A.SAND");
  assert.equal(normalizeRegisterCity("Röthenbach a. d. Pegnitz"), "RÖTHENBACH A.D.PEGNITZ");
  // Spelled-out prepositions survive normalisation ("FRANKFURT AM MAIN" is served
  // spelled out) — the abbreviated variant is the retry.
  const norm = normalizeRegisterCity("Schwaig bei Nürnberg");
  assert.equal(norm, "SCHWAIG BEI NÜRNBERG");
  assert.equal(abbreviateRegisterCity(norm), "SCHWAIG B.NÜRNBERG");
  assert.equal(
    abbreviateRegisterCity("RÖTHENBACH AN DER PEGNITZ"),
    "RÖTHENBACH A.D.PEGNITZ",
  );
  assert.equal(abbreviateRegisterCity("NEUNKIRCHEN AM BRAND"), "NEUNKIRCHEN A.BRAND");
  assert.equal(abbreviateRegisterCity("NÜRNBERG"), "NÜRNBERG"); // nothing to abbreviate
});

Deno.test("parseAddressApiResults / parseAddressApiPoint", () => {
  const hit = {
    lat: 49.3358783,
    lon: 11.1136298,
    thoroughfare: "ROTHER STRASSE",
    locatorDesignator: "1 A",
    postCode: "90530",
    postName: "WENDELSTEIN",
  };
  assert.deepEqual(parseAddressApiResults({ count: 1, results: [hit] }), [hit]);
  assert.deepEqual(parseAddressApiResults({ count: 1, results: [{ lat: 1 }] }), []); // no lon
  assert.deepEqual(parseAddressApiResults(null), []);
  assert.deepEqual(parseAddressApiPoint({ count: 1, results: [hit] }), {
    lat: hit.lat,
    lon: hit.lon,
  });
  // Ambiguous (road-level) and empty results are no point.
  assert.equal(parseAddressApiPoint({ count: 2, results: [hit, hit] }), undefined);
  assert.equal(parseAddressApiPoint({ count: 0, results: [] }), undefined);
});

Deno.test("displayCaseRegisterStreet restores display case incl. straße", () => {
  assert.equal(displayCaseRegisterStreet("ROTHER STRASSE"), "Rother Straße");
  assert.equal(displayCaseRegisterStreet("ZOLLHAUSSTRASSE"), "Zollhausstraße");
  assert.equal(displayCaseRegisterStreet("DR.-MACK-STRASSE"), "Dr.-Mack-Straße");
  assert.equal(displayCaseRegisterStreet("AM STEINACHER KREUZ"), "Am Steinacher Kreuz");
});
