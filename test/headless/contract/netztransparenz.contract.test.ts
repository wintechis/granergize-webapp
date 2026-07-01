/// <reference lib="deno.ns" />
/**
 * REMOTE contract test for `linked-netztransparenz` — the live settled-generation source.
 *
 * Network-only (no Pod, no actors): hits the real wrapper host (`wunderfacts.com/netztransparenz`,
 * override `NETZTRANSPARENZ_BASE`) and drives the app's OWN parser. Run with
 * `deno task headless:remote:contract`; the hermetic unit tests at
 * `src/services/sources/netztransparenz.test.ts` use fixtures.
 *
 * The app path is a per-plant deref (`eeg/{number}` → `parsePlantSettlements`), keyed by a MaStR
 * unit's EEG number — NOT the `/filter` LIDS service (the 2026-06-30 retrofit is additive and
 * unused here). Discovers a live plant number from `/filter`, then derefs it and asserts the app
 * reads settled kWh per year (the `vocab:strommengeKWh` + `vocab:year` per `vocab:Settlement`).
 */
import { assert } from "jsr:@std/assert";
import { parseRdfText } from "../../../src/services/rdf/rdfHelpers.ts";
import {
  parsePlantSettlements,
  plantUrl,
} from "../../../src/services/sources/netztransparenz.ts";
import { sourceBase } from "../../../src/constants/dataSources.ts";

async function anEegNumber(): Promise<string> {
  const url = `${sourceBase("netztransparenz")}filter?count=5`;
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);
  const m = (await res.text()).match(/eeg\/(\d+)/);
  assert(m, "a plant number discoverable from /filter");
  return m![1];
}

Deno.test("contract: live netztransparenz plant deref → app parses settled kWh per year", async () => {
  const num = await anEegNumber();
  const url = plantUrl(num);
  const res = await fetch(url, { headers: { Accept: "text/turtle" } });
  assert(res.ok, `HTTP ${res.status} for ${url}`);

  const byYear = parsePlantSettlements(parseRdfText(await res.text(), url));
  assert(byYear.size > 0, `≥1 settled year for plant ${num}`);
  for (const [year, kWh] of byYear) {
    assert(year >= 2000 && year <= 2100, `plausible settlement year (got ${year})`);
    assert(kWh > 0, `positive settled kWh for ${year} (got ${kWh})`);
  }
});
