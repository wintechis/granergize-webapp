/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-mastr` — the live nearby-installations source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/mastr`,
 * override `MASTR_BASE`) and drives the app's OWN parsers over the live response, proving the
 * nearby renewable-installation layer renders from what the deployed wrapper serves today. Run
 * with `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/mastrNearby.test.ts` use fixtures.
 *
 * Guards the 2026-06-30 wrapper rename: the spatial-area endpoint moved `/bbox` → `/within`
 * (the `bbox=` query parameter kept), so the app must query `/within` — and the LIDS call
 * entity (`<within?…#id> a mastr:BoundingBox`) must not be mistaken for a unit.
 */
import { assert, assertEquals } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import { parseNearbyInstallations } from "../../../src/services/sources/mastrNearby.ts";

const MASTR = Deno.env.get("MASTR_BASE") ?? "https://wunderfacts.com/mastr/";
const NBG = { lat: 49.4521, lon: 11.0767 };

Deno.test("contract: live mastr /within → app parses nearby renewable installations", async () => {
  const dLat = 3 / 111;
  const dLon = 3 / (111 * Math.cos((NBG.lat * Math.PI) / 180));
  const box = `${NBG.lon - dLon},${NBG.lat - dLat},${NBG.lon + dLon},${NBG.lat + dLat}`;
  const url = `${MASTR}within?bbox=${box}&count=500`;
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const store = parseRdfText(await res.text(), url);
  const units = parseNearbyInstallations(store, NBG.lat, NBG.lon);
  assert(units.length > 0, "renewable installations parsed from the live /within listing");

  // The nearest unit has the fields the nearby layer + reverse-geocode need; the LIDS
  // BoundingBox call entity (no geo:lat) is not among them.
  const u = units[0];
  assert(["solar", "wind", "hydro", "biomass"].includes(u.kind), "a renewable kind");
  assert(Number.isFinite(u.lat) && Number.isFinite(u.long), "coordinates");
  assert(u.ags === "" || /^\d{8}$/.test(u.ags), "8-digit Gemeinde AGS (or empty)");
  assert((u.distanceKm ?? Infinity) >= 0, "a distance from the query point");
});

Deno.test("contract: the old mastr /bbox path is gone (renamed to /within)", async () => {
  const res = await fetch(`${MASTR}bbox?bbox=11.0,49.4,11.12,49.5&count=5`, {
    headers: { Accept: "text/turtle" },
  });
  await res.body?.cancel();
  assertEquals(res.status, 404);
});
