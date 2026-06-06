/// <reference lib="deno.ns" />
import assert from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { getEnergyDataUrls } from "./share.ts";
import { GRAN_NS } from "../utils/vocabularies.ts";

const BUILDING = "https://a.example/granergize/buildings/b-1.ttl";
const ENERGY = `${BUILDING.replace(/\.ttl$/, "")}/energy`;

/** A building file linking four energy datasets across two years/scenarios. */
const BUILDING_TTL = `
@prefix gran: <${GRAN_NS}> .
<${BUILDING}#b-1>
  gran:hasEnergyDataset <${ENERGY}/2024-P1Y.ttl#ds> ,
                        <${ENERGY}/2024-PT15M.ttl#ds> ,
                        <${ENERGY}/2024-P1Y-planned.ttl#ds> ,
                        <${ENERGY}/2023-P1Y.ttl#ds> .
`;

/** Fake session serving the building Turtle by URL (query stripped). */
function session(): Session {
  return {
    info: { isLoggedIn: true, webId: "https://a.example/profile/card#me" },
    fetch: (input: string | URL | Request) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      if (url === BUILDING) {
        return Promise.resolve(
          new Response(BUILDING_TTL, {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;
}

Deno.test("getEnergyDataUrls: no years filter grants every dataset (+ series container)", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session());
  const set = new Set(urls.map((t) => t.url));

  // All four dataset files are granted.
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-P1Y-planned.ttl`));
  assert.ok(set.has(`${ENERGY}/2023-P1Y.ttl`));

  // The PT15M series also grants its daily-files container (acl:default).
  const container = urls.find((t) => t.url === `${ENERGY}/2024-PT15M/`);
  assert.ok(container, "series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 5);
});

Deno.test("getEnergyDataUrls: years:[2024] excludes 2023, keeps the 2024 series container", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session(), [2024]);
  const set = new Set(urls.map((t) => t.url));

  // 2023 is excluded.
  assert.ok(!set.has(`${ENERGY}/2023-P1Y.ttl`));

  // Both 2024 scenarios (actual + planned) and the series are kept...
  assert.ok(set.has(`${ENERGY}/2024-P1Y.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-P1Y-planned.ttl`));
  assert.ok(set.has(`${ENERGY}/2024-PT15M.ttl`));
  // ...including the 2024 series container.
  const container = urls.find((t) => t.url === `${ENERGY}/2024-PT15M/`);
  assert.ok(container, "2024 series container is granted");
  assert.strictEqual(container!.isContainer, true);
  assert.strictEqual(urls.length, 4);
});

Deno.test("getEnergyDataUrls: an unmatched year grants no energy", async () => {
  const urls = await getEnergyDataUrls(BUILDING, session(), [1999]);
  assert.strictEqual(urls.length, 0);
});
