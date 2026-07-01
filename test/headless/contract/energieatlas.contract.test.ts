/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-energieatlas` — the live per-Gemeinde energy-profile source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/energieatlas`,
 * override `VITE_LINKED_ENERGIEATLAS_API_URI`) and drives the app's OWN parser. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/standortEnergieprofil.test.ts` use fixtures.
 *
 * The app path is a single `area/{ags}` deref → `parseAreaProfile` (one `vocab:AreaPotential`
 * document carries every card: rooftop / ground PV Ausbaulücke, renewable share + mix, biomass).
 * Bavaria-only pilot — 09564000 (Nürnberg) is covered.
 */
import { assert } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import {
  areaUrl,
  parseAreaProfile,
} from "../../../src/services/sources/standortEnergieprofil.ts";

Deno.test("contract: live energieatlas area/{ags} → app parses the Gemeinde energy profile", async () => {
  const url = areaUrl("09564000"); // Nürnberg (in the Bavarian pilot scope)
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const profile = parseAreaProfile(parseRdfText(await res.text(), url));
  assert(profile, "a vocab:AreaPotential profile is parsed");
  assert(profile!.name.length > 0, "the Gemeinde name is present");
  assert(
    !!(profile!.rooftop || profile!.ground || profile!.green || profile!.biomass),
    "at least one card (rooftop / ground / green / biomass) is populated",
  );
});
