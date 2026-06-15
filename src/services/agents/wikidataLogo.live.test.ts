/// <reference lib="deno.ns" />
/**
 * Tier-4 (REAL NETWORK) live check of the Wikidata logo fallback — the live
 * counterpart to the offline fixtures in `wikidataLogo.test.ts`. It hits real
 * `www.wikidata.org` + Wikimedia Commons, so it must NOT run on the hermetic local
 * tiers: `deno task test` (Tier-1) picks the file up but every case is
 * `ignore`d unless `LIVE` is set. Run it with:
 *
 *   deno task test:live
 *
 * Uses **Fiege Logistik = Q1411530**, whose `P154` ("logo image") is the stable
 * `Fiege Logo 2019.svg`. The risk these cover — and that mocks can't — is the real
 * `Special:EntityData` JSON shape + CORS and the Commons `Special:FilePath`
 * redirect actually serving an image. (The owl:sameAs → resolveAgentOrg WIRING is
 * unit-tested with a mock fetch; here we exercise the external boundary for real.)
 */
import { strict as assert } from "node:assert";
import { fetchWikidataLogo } from "./wikidataLogo.ts";

const LIVE = !!Deno.env.get("LIVE");
/** Fiege Logistik — a real entity with a stable P154 logo claim. */
const FIEGE = "http://www.wikidata.org/entity/Q1411530";

Deno.test({
  name: "live: fetchWikidataLogo resolves Fiege's P154 logo from real Wikidata",
  ignore: !LIVE,
  fn: async () => {
    const url = await fetchWikidataLogo(FIEGE, fetch);
    assert.ok(url, "expected a logo URL for Q1411530 (P154 = Fiege Logo 2019.svg)");
    // P154 → a Wikimedia Commons Special:FilePath URL for the logo file.
    assert.match(url!, /commons\.wikimedia\.org\/wiki\/Special:FilePath\//);
    assert.match(url!, /Fiege/i);
  },
});

Deno.test({
  name: "live: the resolved Commons FilePath actually serves an image",
  ignore: !LIVE,
  fn: async () => {
    const url = await fetchWikidataLogo(FIEGE, fetch);
    assert.ok(url, "expected a logo URL");
    // Special:FilePath redirects to the real upload.wikimedia.org file — follow it
    // and confirm it's an image (proves the URL an <img src> would load works).
    const res = await fetch(url!, { redirect: "follow" });
    assert.equal(res.ok, true, `Commons FilePath should 200 (got ${res.status})`);
    assert.match(res.headers.get("content-type") ?? "", /image\//);
    await res.body?.cancel();
  },
});

Deno.test({
  name: "live: a non-Wikidata IRI resolves to no logo (and is not fetched)",
  ignore: !LIVE,
  fn: async () => {
    let called = false;
    const spyFetch: typeof fetch = (...args) => {
      called = true;
      return fetch(...args);
    };
    const url = await fetchWikidataLogo("https://example.org/org#it", spyFetch);
    assert.equal(url, undefined);
    assert.equal(called, false, "a non-Wikidata IRI must not trigger a network call");
  },
});
