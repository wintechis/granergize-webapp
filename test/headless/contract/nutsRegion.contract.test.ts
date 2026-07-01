/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-nuts` — the live region choropleth + search source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/nuts`,
 * override `NUTS_BASE`) and drives the app's OWN normalizer/parser over the live response. Run
 * with `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/regionGeometry.test.ts` use fixtures.
 *
 * Two app surfaces: the bulk GeoJSON choropleth (`geojson?level={1|3}&parent=DE` →
 * `normalizeRegionGeometry`) and region `/search` (`parseRegionMatches`). Guards the 2026-06-30
 * nuts changes (the `/search` LIDS call entity `<search?…#id> a vocab:Query` + `vocab:result`
 * links) — the call entity must NOT surface as a region match (it has no `skos:notation`).
 */
import { assert } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import {
  normalizeRegionGeometry,
  parseRegionMatches,
} from "../../../src/services/sources/regionGeometry.ts";

const NUTS = Deno.env.get("NUTS_BASE") ?? "https://wunderfacts.com/nuts/";

Deno.test("contract: live nuts bulk geojson → app normalizes the Land choropleth", async () => {
  const url = `${NUTS}geojson?level=1&parent=DE`;
  const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const fc = normalizeRegionGeometry(await res.json());
  assert(fc.features.length >= 16, `≥16 Bundesländer kept (got ${fc.features.length})`);
  const f = fc.features[0];
  assert(/^\d{2}$/.test(f.properties.ags), "a 2-digit Land AGS join key");
  assert(f.properties.code.startsWith("DE"), "a NUTS code");
  assert(f.properties.label.length > 0, "a human label");
  assert(
    f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
    "a shadeable polygon geometry",
  );
});

Deno.test("contract: live nuts /search → app parses region matches; LIDS call entity is not one", async () => {
  const url = `${NUTS}search?q=Mittelfranken`;
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const matches = parseRegionMatches(parseRdfText(await res.text(), url));
  assert(matches.length >= 1, "≥1 region match");
  const mfr = matches.find((m) => m.notation === "DE25");
  assert(mfr && mfr.label.includes("Mittelfranken"), "Mittelfranken matched with its label");
  // The <search?…#id> vocab:Query call entity carries no skos:notation → never a region match.
  assert(!matches.some((m) => m.iri.includes("#id")), "the call entity is not returned as a region");
});
