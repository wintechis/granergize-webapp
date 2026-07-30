/// <reference lib="deno.ns" />
/**
 * Make the headless runner **hermetic on external sources**. Tier-2 is hermetic on
 * the Pod (a throwaway local CSS/JSS) but its task ops can still reach public
 * sources — the file-import geocoder resolves each building (the addressapi register
 * search + the linked-lau `/contains` region lookup). Before the SourceGateway port
 * there was no seam to redirect those, so `headless:local` silently hit
 * `wunderfacts.com` under Deno (the known gap; see plans/plan-test-lane-naming.md).
 *
 * This installs a fake {@link SourceGateway} (the same port the app reads through)
 * that serves deterministic fixtures for the reads the suite actually makes and 404s
 * everything else — so geocoding resolves offline to a fixed Nürnberg point + AGS
 * (demo buildings still map, deterministically), and any *other* external read a task
 * might trigger degrades best-effort instead of touching the network. The authed Pod
 * transport is unaffected (it uses the session, not this gateway).
 *
 * The remote contract lane (`headless:remote:contract`) does NOT import this — it
 * intentionally hits real Wikidata/Commons.
 */
import { _setSourceGatewayForTesting } from "../../src/services/sources/sourceGateway.ts";
import { makeFakeSourceGateway } from "../../src/services/testing/fakeSourceGateway.ts";

/** The fixed locality every headless geocode resolves to (Nürnberg). */
const NUERNBERG = { lat: "49.4521", lon: "11.0767", ags: "09564000" };

/**
 * Install the hermetic source gateway for the duration of the run. Idempotent;
 * call once at runner startup, before any task runs.
 */
export function installHeadlessSourceStub(): void {
  const { gateway } = makeFakeSourceGateway({
    respond: (url) => {
      // addressapi register search (JSON) → one unambiguous fixed point, so a
      // demo building maps offline.
      if (url.includes("search.json?") && url.includes("country=DE")) {
        return new Response(
          JSON.stringify({
            count: 1,
            results: [{ lat: Number(NUERNBERG.lat), lon: Number(NUERNBERG.lon) }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // linked-lau /contains → the containing Gemeinde as a lean SKOS concept, so
      // `fetchContainingGemeindeAgs` yields the 8-digit AGS.
      if (url.includes("/contains?")) {
        return new Response(
          `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n` +
            `<lau/DE_${NUERNBERG.ags}#it> a skos:Concept ; ` +
            `skos:notation "DE_${NUERNBERG.ags}" .`,
          { status: 200, headers: { "Content-Type": "text/turtle" } },
        );
      }
      // Anything else: fall through to the fake's 404 — hermetic (no network), and a
      // best-effort reader degrades exactly as it would against a real 404.
      return undefined;
    },
  });
  _setSourceGatewayForTesting(gateway);
}
