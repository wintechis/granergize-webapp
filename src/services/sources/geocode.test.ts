/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { geocodeFields, geocodeWithRegion } from "./geocode.ts";

/**
 * Stub the global `fetch` (geocode goes through `trackedFetch` → bare `fetch`).
 * `hits` maps a Nominatim `q=` value to a single result; anything else returns an
 * empty array (a miss, which drives the progressive coarsening). Records every
 * queried `q` so tests can assert the order / dedup.
 */
function stubFetch(hits: Record<string, { lat: string; lon: string }>) {
  const queried: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input.toString());
    const q = url.searchParams.get("q") ?? "";
    queried.push(q);
    const hit = hits[q];
    return Promise.resolve(
      new Response(JSON.stringify(hit ? [hit] : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { queried, restore: () => (globalThis.fetch = orig) };
}

Deno.test("geocodeFields returns an address-precision hit on the first try (no delay)", async () => {
  const { queried, restore } = stubFetch({
    "Hauptstr 1, 90402, Nürnberg, Bayern": { lat: "49.45", lon: "11.07" },
  });
  try {
    const got = await geocodeFields({
      streetAddress: "Hauptstr 1",
      postalCode: "90402",
      locality: "Nürnberg",
      region: "Bayern",
    });
    assert.deepEqual(got, { lat: "49.45", long: "11.07", precision: "Address" });
    assert.equal(queried.length, 1, "a first-try hit makes exactly one request");
  } finally {
    restore();
  }
});

Deno.test("geocodeFields coarsens to postcode when the full address misses", async () => {
  // Address query misses; the next (coarser) postcode query hits.
  const { queried, restore } = stubFetch({
    "90402, Nürnberg": { lat: "49.45", lon: "11.07" },
  });
  try {
    const got = await geocodeFields({
      streetAddress: "Nonexistent 999",
      postalCode: "90402",
      locality: "Nürnberg",
    });
    assert.deepEqual(got, { lat: "49.45", long: "11.07", precision: "Postcode" });
    assert.deepEqual(queried, ["Nonexistent 999, 90402, Nürnberg", "90402, Nürnberg"]);
  } finally {
    restore();
  }
});

Deno.test("geocodeFields tags a city-only resolution as city precision", async () => {
  const { queried, restore } = stubFetch({ "Nürnberg": { lat: "49.45", lon: "11.07" } });
  try {
    const got = await geocodeFields({ locality: "Nürnberg" });
    assert.equal(got?.precision, "City");
    assert.equal(queried.length, 1);
  } finally {
    restore();
  }
});

Deno.test("geocodeFields returns null when nothing resolves", async () => {
  const { restore } = stubFetch({});
  try {
    assert.equal(await geocodeFields({ locality: "Atlantis" }), null);
  } finally {
    restore();
  }
});

Deno.test("geocodeFields returns null when no address fields are present", async () => {
  const { queried, restore } = stubFetch({});
  try {
    assert.equal(await geocodeFields({}), null);
    assert.equal(queried.length, 0, "no fields → no request");
  } finally {
    restore();
  }
});

/** Stub Nominatim (a single hit) + the linked-lau `/contains` lookup (a SKOS reply). */
function stubGeocodeAndContains(contains: Response) {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = input.toString();
    if (url.includes("/contains")) return Promise.resolve(contains.clone());
    return Promise.resolve(
      new Response(JSON.stringify([{ lat: "49.45", lon: "11.07" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return () => (globalThis.fetch = orig);
}

Deno.test("geocodeWithRegion adds the Gemeinde AGS from the /contains lookup", async () => {
  const restore = stubGeocodeAndContains(
    new Response(
      `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
       <r> a skos:Concept ; skos:notation "DE_09564000" .`,
      { status: 200, headers: { "content-type": "text/turtle" } },
    ),
  );
  try {
    const got = await geocodeWithRegion({ locality: "Nürnberg" });
    assert.equal(got?.lat, "49.45");
    assert.equal(got?.precision, "City");
    assert.equal(got?.regionAgs, "09564000");
  } finally {
    restore();
  }
});

Deno.test("geocodeWithRegion: coords still returned when /contains has no region", async () => {
  const restore = stubGeocodeAndContains(new Response("", { status: 404 }));
  try {
    const got = await geocodeWithRegion({ locality: "Nürnberg" });
    assert.equal(got?.lat, "49.45");
    assert.equal(got?.regionAgs, undefined);
  } finally {
    restore();
  }
});
