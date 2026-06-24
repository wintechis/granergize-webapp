/// <reference lib="deno.ns" />
// Tier-1: FindRegionalStatistics lists the public regionalstatistik datasets for a
// region — by explicit Bundesland (name or AGS), by a building's region (offline
// fixture), or the whole visible portfolio (injected loader). Pure/offline; the
// figures themselves are never fetched here.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { REC_BUILDING, VCARD_NS } from "../services/rdf/vocabularies.ts";
import type { BuildingType } from "../types.ts";
import { findRegionalStatisticsCore } from "./FindRegionalStatistics.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);
const BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
const TTL = `<${BUILDING}#it> a <${REC_BUILDING}> ; <${VCARD_NS}region> "Bayern" .`;

function fakePod(): PodGateway {
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    if (url === BUILDING) {
      return Promise.resolve(
        new Response(TTL, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return sessionGateway(
    { info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session,
  );
}
const noLoad = () => Promise.resolve([] as BuildingType[]);

Deno.test("findRegionalStatisticsCore: an explicit Bundesland name lists only that region's datasets", async () => {
  const items = await findRegionalStatisticsCore(fakePod(), { region: "Bayern" }, noLoad);
  assert.ok(items.length > 0);
  assert.ok(items.every((it) => it.ags === "09"));
});

Deno.test("findRegionalStatisticsCore: a Bundesland AGS works as well as its name", async () => {
  const items = await findRegionalStatisticsCore(fakePod(), { region: "09" }, noLoad);
  assert.ok(items.length > 0);
  assert.ok(items.every((it) => it.ags === "09"));
});

Deno.test("findRegionalStatisticsCore: no scope → the visible portfolio's regions (injected load)", async () => {
  const buildings = [{ region: "Bayern" }, { region: "Hessen" }] as BuildingType[];
  const items = await findRegionalStatisticsCore(
    fakePod(),
    {},
    () => Promise.resolve(buildings),
  );
  const ags = [...new Set(items.map((it) => it.ags))].sort();
  assert.deepEqual(ags, ["06", "09"]); // Hessen = 06, Bayern = 09
});

Deno.test("findRegionalStatisticsCore: a building scopes to its own region", async () => {
  const items = await findRegionalStatisticsCore(
    fakePod(),
    { building: `${BUILDING}#it` },
    noLoad,
  );
  assert.ok(items.length > 0);
  assert.ok(items.every((it) => it.ags === "09"));
});
