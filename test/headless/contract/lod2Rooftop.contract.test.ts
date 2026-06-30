/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-lod2-by` — the live rooftop-PV source.
 *
 * Like `wikidataLogo.contract.test.ts`, this is the **network-only** flavour: no Pod, no
 * actors, a standalone Deno I/O test that hits the real wrapper host (`wunderfacts.com/lod2-by`,
 * override with `LOD2_BASE`) and drives the app's OWN pure parsers + PV calc over the live
 * response — so it proves the data the app renders is actually present in what the deployed
 * wrapper serves today. It is NOT in the hermetic `unit` lane (the unit tests at
 * `src/services/sources/lod2Rooftop.test.ts` use fixtures); run it with
 * `deno task headless:remote:contract`.
 *
 * Guards two app surfaces against the post-untangle wrapper (which serves geometry only —
 * the PV kWp/kWh is computed app-side, and the native-UTM `POLYGON Z` surfaces replaced the
 * old 2D-WGS84 + `installableCapacity` shape):
 *  1. the building rooftop-PV card (`/nearby` → deref → `parseBuildingRoofs` → `computePotential`);
 *  2. the open-buildings / nearby layer (`/nearby` summary → per-building kWp), which must NOT
 *     rely on a wrapper-served `installableCapacity` (the wrapper no longer emits it).
 */
import { assert, assertEquals } from "jsr:@std/assert";
import {
  parseBuildingRoofs,
  parseNearbyBuildings,
  parseNearbyRooftops,
  parseNearestBuilding,
} from "../../../src/services/sources/lod2Rooftop.ts";
import { computePotential } from "../../../src/services/sources/rooftopPv.ts";

const LOD2 = Deno.env.get("LOD2_BASE") ?? "https://wunderfacts.com/lod2-by/";
// A point in central Nürnberg (inside the pilot dump's coverage).
const NBG = { lat: 49.4521, lon: 11.0767 };

async function getTurtle(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);
  return await res.text();
}

Deno.test("contract: live lod2-by /nearby → deref → app computes rooftop-PV from the geometry", async () => {
  const pointUrl = `${LOD2}nearby?lon=${NBG.lon}&lat=${NBG.lat}&r=250`;
  // parseNearestBuilding picks a real building (and skips the LIDS call entity).
  const nearest = parseNearestBuilding(await getTurtle(pointUrl), pointUrl, NBG.lat, NBG.lon);
  assert(nearest && nearest.iri.includes("/building/"), "a nearest building (not the call entity)");

  // The app computes PV app-side from the served roof surfaces. Not every building has a
  // suitable roof (near-vertical facets are excluded), so assert over a handful that AT LEAST
  // ONE yields a positive kWp — proving the rooftop-PV card renders from live geometry.
  const buildings = parseNearbyBuildings(await getTurtle(pointUrl), pointUrl, NBG.lat, NBG.lon)
    .slice(0, 8);
  assert(buildings.length > 0, "the live summary lists nearby buildings");
  let withPv = 0;
  for (const b of buildings) {
    const roofs = parseBuildingRoofs(await getTurtle(b.iri), b.iri);
    if (!roofs || roofs.roofs.length === 0) continue;
    const pv = computePotential(roofs.roofs);
    if (pv && pv.installableKwp > 0) withPv++;
  }
  assert(withPv > 0, `app computes installable kWp for ≥1 live building (got ${withPv}/8)`);
});

Deno.test("contract: live /nearby summary lists buildings but NO wrapper installableCapacity", async () => {
  const pointUrl = `${LOD2}nearby?lon=${NBG.lon}&lat=${NBG.lat}&r=250`;
  const ttl = await getTurtle(pointUrl);

  // The geometry-only summary lists nearby buildings (coords) — the basis of the open-buildings
  // layer; the app computes kWp per building by dereferencing each.
  const list = parseNearbyBuildings(ttl, pointUrl, NBG.lat, NBG.lon);
  assert(list.length > 0, "the live summary lists nearby buildings");

  // The PV-calc untangle removed installableCapacity from the wrapper, so the OLD summary-only
  // path (parseNearbyRooftops, which requires it) now finds nothing — the open-buildings layer
  // must NOT depend on it. This assertion documents/locks the wrapper's post-untangle shape.
  assertEquals(
    parseNearbyRooftops(ttl, pointUrl, NBG.lat, NBG.lon).length,
    0,
    "wrapper no longer serves lod2:installableCapacity in the /nearby summary",
  );
});
