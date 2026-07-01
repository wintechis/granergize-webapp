/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for the `osm` source — live **Nominatim** geocoding.
 *
 * Network-only (no Pod, no actors): hits the real Nominatim host
 * (`nominatim.openstreetmap.org`, override `VITE_NOMINATIM_API_URI`) through the app's own
 * `geocodeFields`, proving an address resolves to coordinates the app can read. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/geocode.test.ts` stub Nominatim.
 *
 * Polite by construction: a full-address query hits on the first try (one request, no retry
 * delay), and `geocodeFields` sends the required `User-Agent`. In the app, `osm` is Nominatim
 * geocoding (JSON) — not a linked-* RDF wrapper (that's the pipeline's linked-osm).
 */
import { assert } from "jsr:@std/assert";
import { geocodeFields } from "../../../src/services/sources/geocode.ts";

Deno.test("contract: live Nominatim → app geocodes an address to Franconian coordinates", async () => {
  const hit = await geocodeFields({
    streetAddress: "Hauptmarkt 18",
    postalCode: "90403",
    locality: "Nürnberg",
    region: "Bayern",
  });
  assert(hit, "a geocode hit for a known Nürnberg address");

  const lat = Number.parseFloat(hit!.lat);
  const lon = Number.parseFloat(hit!.long);
  assert(lat > 49.0 && lat < 49.9, `latitude in the Nürnberg region (got ${lat})`);
  assert(lon > 10.5 && lon < 11.5, `longitude in the Nürnberg region (got ${lon})`);
  assert(
    ["Address", "Postcode", "City"].includes(hit!.precision),
    `a precision tag (got ${hit!.precision})`,
  );
});
