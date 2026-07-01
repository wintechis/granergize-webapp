/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-regionalstatistik` — the live regional Data Cube source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/regionalstatistik`,
 * override `VITE_REGIONALSTATISTIK_API_URI`) and drives the app's OWN parsers. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/regionalCube.test.ts` use fixtures.
 *
 * The app path is a `data/{tableId}` deref → `parseRegionalObservations` (one region across years)
 * and `parseRegionalChoropleth` (latest value per region). Exercises the primary Land table
 * (86251-Z-02, renewable-electricity share) — `qb:Observation`s with `#dim-geo` (→ `/ags/{code}`),
 * `#dim-TIME_PERIOD`, `#measure-OBS_VALUE`, `#unit`.
 */
import { assert } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import {
  parseRegionalChoropleth,
  parseRegionalObservations,
  REGIONAL_TABLES,
  regionalTableDataUrl,
} from "../../../src/services/sources/regionalCube.ts";

const TABLE = REGIONAL_TABLES.find((t) => t.tableId === "86251-Z-02")!;

Deno.test("contract: live regionalstatistik cube → app parses a region's yearly series + choropleth", async () => {
  const url = regionalTableDataUrl(TABLE.tableId);
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);
  const store = parseRdfText(await res.text(), url);

  // Per-region across years: Bayern (Land AGS "09").
  const bayern = parseRegionalObservations(store, TABLE, "09");
  assert(bayern.length > 0, "Bayern renewable-share series is non-empty");
  const o = bayern[0];
  assert(Number.isInteger(o.year) && o.year >= 1990 && o.year <= 2100, "a plausible year");
  assert(Number.isFinite(o.value), "a numeric measure value");

  // Whole-table choropleth: one latest value per Land (≥16 German Länder).
  const byAgs = parseRegionalChoropleth(store, TABLE);
  assert(byAgs.size >= 16, `≥16 Länder in the choropleth (got ${byAgs.size})`);
  assert(byAgs.has("09"), "Bayern (09) present in the choropleth");
});
