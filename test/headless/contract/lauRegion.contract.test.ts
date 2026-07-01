/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-lau` — the live Gemeinde point-in-region + choropleth source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/lau`, override
 * `LAU_BASE`) and drives the app's OWN parsers. Run with `deno task headless:remote:contract`;
 * the hermetic unit tests at `src/services/sources/regionGeometry.test.ts` use fixtures.
 *
 * Three app surfaces: the point-in-region `/contains` reverse-geocode (`gemeindeAgsFromContains`),
 * the gemeinde GeoJSON choropleth (`geojson?bbox=` → `normalizeRegionGeometry`), and region
 * `/search` (`parseRegionMatches`). Guards the 2026-06-30 `#point`→`#id` rename: the `/contains`
 * LIDS call entity (`<?lat=…#id> a geo:Point`) has no `skos:notation`, so it must NOT be mistaken
 * for the containing Gemeinde.
 */
import { assert } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import {
  gemeindeAgsFromContains,
  normalizeRegionGeometry,
  parseRegionMatches,
} from "../../../src/services/sources/regionGeometry.ts";

const LAU = Deno.env.get("LAU_BASE") ?? "https://wunderfacts.com/lau/";
// Central Nürnberg → Gemeinde AGS 09564000.
const NBG = { lat: 49.4521, lon: 11.0767 };

Deno.test("contract: live lau /contains → app reads the containing Gemeinde AGS (not the #id call entity)", async () => {
  const url = `${LAU}contains?lat=${NBG.lat}&lon=${NBG.lon}`;
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const ags = gemeindeAgsFromContains(parseRdfText(await res.text(), url));
  assert(ags === "09564000", `Nürnberg Gemeinde AGS (got ${ags})`);
});

Deno.test("contract: live lau gemeinde geojson → app normalizes the Gemeinde choropleth", async () => {
  const url = `${LAU}geojson?bbox=11.0,49.4,11.12,49.5`;
  const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const fc = normalizeRegionGeometry(await res.json());
  assert(fc.features.length >= 1, "≥1 Gemeinde feature in the bbox");
  const nbg = fc.features.find((f) => f.properties.ags === "09564000");
  assert(nbg && nbg.properties.label.includes("Nürnberg"), "Nürnberg present with its label");
  assert(/^\d{8}$/.test(fc.features[0].properties.ags), "an 8-digit Gemeinde AGS");
});

Deno.test("contract: live lau /search → app parses Gemeinde matches with an 8-digit AGS", async () => {
  const url = `${LAU}search?q=Erlangen`;
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const matches = parseRegionMatches(parseRdfText(await res.text(), url));
  // A German LAU GISCO_ID `DE_<digits>` yields an 8-digit ags; at least one such match exists.
  const de = matches.find((m) => /^\d{8}$/.test(m.ags) && m.label.includes("Erlangen"));
  assert(de, "an Erlangen Gemeinde match with an 8-digit AGS");
  assert(!matches.some((m) => m.iri.includes("#id")), "the call entity is not returned as a region");
});
