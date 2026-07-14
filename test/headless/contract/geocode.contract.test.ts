/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for the `addressapi` source — live geocoding via **linked-addressapi**.
 *
 * Network-only (no Pod, no actors): hits the wrapper's structured register search
 * (`<addressapi-base>search.json?country=DE&postcode=&road=&housenumber=`; base
 * `wunderfacts.com/addressapi/`, override `VITE_ADDRESSAPI_API_URI`) through the app's own
 * `geocodeFields`, proving an address resolves to the register's point. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/geocode.test.ts` stub the response.
 *
 * Polite by construction: a postcode-based full-address query hits unambiguously on the
 * first try (one request, no retries).
 */
import { assert } from "jsr:@std/assert";
import { geocodeFields } from "../../../src/services/sources/geocode.ts";

Deno.test("contract: live addressapi → app geocodes an address to Franconian coordinates", async () => {
  const hit = await geocodeFields({
    streetAddress: "Hauptmarkt 18",
    postalCode: "90403",
    locality: "Nürnberg",
  });
  assert(hit, "a geocode hit for a known Nürnberg address");

  const lat = Number.parseFloat(hit!.lat);
  const lon = Number.parseFloat(hit!.long);
  assert(lat > 49.0 && lat < 49.9, `latitude in the Nürnberg region (got ${lat})`);
  assert(lon > 10.5 && lon < 11.5, `longitude in the Nürnberg region (got ${lon})`);
  assert(hit!.precision === "Address", "a register hit is Address precision");
});
