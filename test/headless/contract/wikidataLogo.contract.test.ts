/// <reference lib="deno.ns" />
/**
 * `headless:remote` external-host CONTRACT check (judge of a real service's shape) —
 * the live counterpart to the offline fixtures in
 * `src/services/agents/wikidataLogo.test.ts` (which stay `unit:local`). It hits real
 * `www.wikidata.org` + Wikimedia Commons, so it is **not** in the hermetic `unit`
 * glob (excluded in `deno.json`) and runs only on demand:
 *
 *   deno task headless:remote:contract
 *
 * No Pod, no actors — a standalone Deno I/O test, the network-only flavour of
 * `headless:remote` (distinct from the runner-based `it:remote`). The lane IS the
 * gate; there is no `LIVE` env switch.
 *
 * Uses **Fiege Logistik = Q1411530**, whose `P154` ("logo image") is the stable
 * `Fiege Logo 2019.svg`. The risk these cover — and that mocks can't — is the real
 * `Special:EntityData` JSON shape + CORS and the Commons `Special:FilePath`
 * redirect actually serving an image. (The owl:sameAs → resolveAgentOrg WIRING is
 * unit-tested with a mock fetch; here we exercise the external boundary for real.)
 */
import { strict as assert } from "node:assert";
import { fetchWikidataLogo } from "../../../src/services/agents/wikidataLogo.ts";

/** Fiege Logistik — a real entity with a stable P154 logo claim. */
const FIEGE = "http://www.wikidata.org/entity/Q1411530";

Deno.test("contract: fetchWikidataLogo resolves Fiege's P154 logo from real Wikidata", async () => {
  const url = await fetchWikidataLogo(FIEGE, fetch);
  assert.ok(url, "expected a logo URL for Q1411530 (P154 = Fiege Logo 2019.svg)");
  // P154 → a Wikimedia Commons Special:FilePath URL for the logo file.
  assert.match(url!, /commons\.wikimedia\.org\/wiki\/Special:FilePath\//);
  assert.match(url!, /Fiege/i);
});

Deno.test("contract: the resolved Commons FilePath actually serves an image", async () => {
  const url = await fetchWikidataLogo(FIEGE, fetch);
  assert.ok(url, "expected a logo URL");
  // Special:FilePath redirects to the real upload.wikimedia.org file — follow it
  // and confirm it's an image (proves the URL an <img src> would load works).
  const res = await fetch(url!, { redirect: "follow" });
  assert.equal(res.ok, true, `Commons FilePath should 200 (got ${res.status})`);
  assert.match(res.headers.get("content-type") ?? "", /image\//);
  await res.body?.cancel();
});

Deno.test("contract: a non-Wikidata IRI resolves to no logo (and is not fetched)", async () => {
  let called = false;
  const spyFetch: typeof fetch = (...args) => {
    called = true;
    return fetch(...args);
  };
  const url = await fetchWikidataLogo("https://example.org/org#it", spyFetch);
  assert.equal(url, undefined);
  assert.equal(called, false, "a non-Wikidata IRI must not trigger a network call");
});
