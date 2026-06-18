/// <reference lib="deno.ns" />
//
// Tier-1 for the FindBuildings read core: it loads the visible set (loader
// injected here, so no Pod) and narrows it with the selector. The selector itself
// is proven in selector.test.ts; this proves the compose + the no-selector path.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
import type { BuildingType } from "../types.ts";
import { findBuildingsCore } from "./FindBuildings.ts";

const GW: PodGateway = sessionGateway(
  { info: { isLoggedIn: true, webId: "https://a.example/profile/card#me" }, fetch: () => Promise.resolve(new Response("")) } as unknown as Session,
);

const b = (o: Record<string, unknown>) => o as unknown as BuildingType;
const FIXTURE = [
  b({ id: "1", hallArea: 6000, hasHeatPump: true }),
  b({ id: "2", hallArea: 1500, hasHeatPump: false }),
];
const load = () => Promise.resolve(FIXTURE);
const ids = (bs: BuildingType[]) => bs.map((x) => (x as unknown as { id: string }).id);

Deno.test("findBuildingsCore: no selector → the whole visible set", async () => {
  const out = await findBuildingsCore(GW, {}, load);
  assert.deepEqual(ids(out), ["1", "2"]);
});

Deno.test("findBuildingsCore: narrows by the selector", async () => {
  const out = await findBuildingsCore(
    GW,
    { selector: { and: [{ field: "hallArea", op: "gt", value: 5000 }] } },
    load,
  );
  assert.deepEqual(ids(out), ["1"]);
});
