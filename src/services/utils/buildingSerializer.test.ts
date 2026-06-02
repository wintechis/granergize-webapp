/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory, Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  addBuildingToRegistry,
  deleteBuilding,
  newBuildingUri,
  removeBuildingFromRegistry,
  seedDemoBuildings,
  serializeBuildingToTurtle,
  synthDayReadings,
  uploadBuilding,
} from "./buildingSerializer.ts";
import { toggleBuildingVisibility } from "../interop/sharingManager.ts";
import { parseBuildings } from "./buildingParser.ts";
import { _setStorageRootForTesting, podResources } from "./solidUtils.ts";
import { GRAN_NS, INVESTOR_NS, RDF_TYPE, SOSA_NS } from "./vocabularies.ts";

const { namedNode } = DataFactory;

// Offline data-layer tests: a fake Session serves/records Turtle by URL so the
// create / register / hide paths run with no network or Pod. WebID resolves to
// storageRoot = https://pod.example/ ; all app paths hang off granergize/.
const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");

const REGISTRY_URL = podResources(WEBID).registry;
const HIDDEN_URL = podResources(WEBID).hiddenBuildings;
const REC_BUILDING = "https://w3id.org/rec#Building";

/** Parse a Turtle string into an n3 Store (absolute IRIs, default graph). */
function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

interface Call {
  url: string;
  method: string;
  body?: string;
}

/**
 * A stateful fake Session: GET reads the in-memory store, PUT/POST writes back to
 * it (so read-append-write flows accumulate), HEAD returns `headStatus`. Records
 * every call for assertions. The registry's `?t=` cache-buster is stripped.
 */
function makeSession(
  initial: Record<string, string> = {},
  headStatus = 200,
): { session: Session; calls: Call[]; store: Record<string, string> } {
  const store: Record<string, string> = { ...initial };
  const calls: Call[] = [];
  const fetch = (
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const raw = typeof input === "string" ? input : input.toString();
    const url = raw.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body != null ? String(init.body) : undefined;
    calls.push({ url, method, body });

    if (method === "HEAD") {
      return Promise.resolve(new Response("", { status: headStatus }));
    }
    if (method === "PUT" || method === "POST") {
      if (body !== undefined) store[url] = body;
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "DELETE") {
      const existed = url in store;
      delete store[url];
      return Promise.resolve(
        new Response(null, { status: existed ? 205 : 404 }),
      );
    }
    const content = store[url];
    if (content === undefined) {
      return Promise.resolve(
        new Response("Not found", { status: 404, statusText: "Not Found" }),
      );
    }
    return Promise.resolve(
      new Response(content, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      }),
    );
  };
  return {
    session: {
      info: { webId: WEBID, isLoggedIn: true },
      fetch,
    } as unknown as Session,
    calls,
    store,
  };
}

const REGISTRY_TTL =
  `@prefix gran: <${GRAN_NS}> .\n<${REGISTRY_URL}> a gran:DataSourceRegistry .\n`;

// ── serialize (the create path) ────────────────────────────────────────────────

Deno.test("serializeBuildingToTurtle types the subject as rec:Building (capital B)", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const store = parse(serializeBuildingToTurtle({ streetAddress: "X" }, uri));
  const types = store.getQuads(null, namedNode(RDF_TYPE), null, null);
  assert.ok(
    types.some((q) => q.object.value === REC_BUILDING),
    "expected rec:Building (capital)",
  );
  assert.ok(
    !types.some((q) => q.object.value === "https://w3id.org/rec#building"),
    "must not emit the lowercase rec:building",
  );
});

Deno.test("serializeBuildingToTurtle round-trips core fields through the parser", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle(
    { streetAddress: "Nordostpark 84", locality: "Nürnberg", lat: "49.4", long: "11.1" },
    uri,
  );
  const b = parseBuildings(new Parser().parse(ttl)).get("b-1");
  assert.ok(b, "building parsed back");
  assert.equal(b!.streetAddress, "Nordostpark 84");
  assert.equal(b!.locality, "Nürnberg");
  assert.equal(b!.lat, 49.4);
  assert.equal(b!.long, 11.1);
});

Deno.test("serializeBuildingToTurtle declares PT15M + type on energy datasets, surfacing them on energyData", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const location = `${uri.replace(/\.ttl$/, "")}/energy/2024-06-03.ttl`;
  const ttl = serializeBuildingToTurtle({ streetAddress: "X" }, uri, [
    { date: "2024-06-03", location },
  ]);

  // Raw shape: the dataset node declares granularity + type.
  const store = parse(ttl);
  const gran = store.getQuads(null, namedNode(`${GRAN_NS}granularity`), null, null);
  assert.equal(gran.length, 1);
  assert.equal(gran[0].object.value, "PT15M");

  // Parsed shape: it reaches building.energyData (which the loader dispatches on).
  const b = parseBuildings(new Parser().parse(ttl)).get("b-1");
  assert.ok(b);
  assert.equal(b!.energyData!.length, 1);
  assert.equal(b!.energyData![0].granularity, "PT15M");
  assert.equal(b!.energyData![0].type, "electricity");
  assert.equal(b!.energyData![0].location, location);
});

Deno.test("serializeBuildingToTurtle emits annual SOSA observations from _inv_* fields", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle(
    { streetAddress: "X", _inv_elec_2023: "121500" },
    uri,
  );
  const store = parse(ttl);
  const obs = store.getQuads(
    null,
    namedNode(`${SOSA_NS}observedProperty`),
    namedNode(`${INVESTOR_NS}AnnualElectricityConsumption`),
    null,
  );
  assert.equal(obs.length, 1, "one annual electricity observation");

  // And it parses back into the building's annualData.
  const b = parseBuildings(new Parser().parse(ttl)).get("b-1");
  assert.ok(b);
  const y2023 = b!.annualData!.find((a) => a.year === 2023);
  assert.ok(y2023, "2023 annual entry present");
  assert.equal(y2023!.electricityConsumption, 121500);
});

// ── upload + registry (write to the Pod) ────────────────────────────────────────

Deno.test("uploadBuilding PUTs the Turtle to the building URI", async () => {
  const { session, calls, store } = makeSession();
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle({ streetAddress: "X" }, uri);

  await uploadBuilding(session, uri, ttl, WEBID);

  const put = calls.find((c) => c.method === "PUT" && c.url === uri);
  assert.ok(put, "building was PUT to its URI");
  assert.equal(put!.body, ttl);
  assert.equal(store[uri], ttl);
});

Deno.test("addBuildingToRegistry appends the source + role and PUTs the registry", async () => {
  const { session, store } = makeSession({ [REGISTRY_URL]: REGISTRY_TTL });
  const uri = newBuildingUri(WEBID, "b-1");

  await addBuildingToRegistry(session, WEBID, uri, "investor");

  const reg = parse(store[REGISTRY_URL]);
  assert.equal(
    reg.getQuads(null, namedNode(`${GRAN_NS}hasBuildingDataSource`), namedNode(uri), null).length,
    1,
    "registry lists the new building source",
  );
  const roleQuads = reg.getQuads(namedNode(uri), namedNode(`${GRAN_NS}dataSourceRole`), null, null);
  assert.equal(roleQuads.length, 1);
  assert.equal(roleQuads[0].object.value, `${GRAN_NS}InvestorRole`);
});

// ── hide / unhide (the "delete" path) ───────────────────────────────────────────

Deno.test("toggleBuildingVisibility hides a visible building", async () => {
  const { session, store } = makeSession(); // no hidden file yet → 404
  const buildingUri = "https://other.example/granergize/buildings/x.ttl#x";

  await toggleBuildingVisibility(buildingUri, session);

  const hidden = parse(store[HIDDEN_URL]);
  assert.equal(
    hidden.getQuads(
      namedNode(HIDDEN_URL),
      namedNode(`${GRAN_NS}hiddenBuilding`),
      namedNode(buildingUri),
      null,
    ).length,
    1,
    "building is now marked hidden",
  );
});

Deno.test("toggleBuildingVisibility unhides an already-hidden building", async () => {
  const buildingUri = "https://other.example/granergize/buildings/x.ttl#x";
  const existing =
    `@prefix gran: <${GRAN_NS}> .\n<${HIDDEN_URL}> gran:hiddenBuilding <${buildingUri}> .\n`;
  const { session, store } = makeSession({ [HIDDEN_URL]: existing });

  await toggleBuildingVisibility(buildingUri, session);

  const hidden = parse(store[HIDDEN_URL]);
  assert.equal(
    hidden.getQuads(null, namedNode(`${GRAN_NS}hiddenBuilding`), null, null).length,
    0,
    "the hidden mark was removed",
  );
});

// ── synthetic readings + full demo seed ─────────────────────────────────────────

Deno.test("synthDayReadings yields a full UTC day of 15-minute slots", () => {
  const r = synthDayReadings("2024-06-03");
  assert.equal(r.length, 96);
  assert.equal(r[0].beginTs, "2024-06-03T00:00:00Z");
  assert.equal(r[0].slotId, "0000");
  assert.equal(r[1].beginTs, "2024-06-03T00:15:00Z");
  assert.equal(r[95].endTs, "2024-06-04T00:00:00Z");
  // values are non-negative kWh-per-slot strings
  assert.ok(r.every((x) => parseFloat(x.valueKwh) >= 0));
});

Deno.test("seedDemoBuildings seeds two buildings with different granularities", async () => {
  const { session, calls, store } = makeSession({ [REGISTRY_URL]: REGISTRY_TTL });

  // Stub the geocoder (global fetch) so the seed runs offline.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("nominatim")) {
      return Promise.resolve(
        new Response(JSON.stringify([{ lat: "49.45", lon: "11.08" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  }) as typeof fetch;

  try {
    await seedDemoBuildings(session, WEBID);
  } finally {
    globalThis.fetch = realFetch;
  }

  // Two building files written (under granergize/buildings/, not the energy files).
  const buildingPuts = calls.filter((c) =>
    c.method === "PUT" &&
    /\/granergize\/buildings\/[^/]+\.ttl$/.test(c.url)
  );
  assert.equal(buildingPuts.length, 2, "two demo buildings uploaded");

  // Exactly one daily 15-minute energy file written (for the series building).
  const energyPuts = calls.filter((c) =>
    c.method === "PUT" && c.url.endsWith("/energy/2024-06-03.ttl")
  );
  assert.equal(energyPuts.length, 1, "one 15-min energy file uploaded");

  // The two buildings carry different granularities: one PT15M series, one annual.
  const bodies = buildingPuts.map((c) => c.body ?? "");
  assert.equal(
    bodies.filter((b) => b.includes("PT15M")).length,
    1,
    "exactly one building declares the PT15M series",
  );
  assert.equal(
    bodies.filter((b) => b.includes("AnnualElectricityConsumption")).length,
    1,
    "exactly one building carries inline annual observations",
  );

  // The registry accumulated both sources, one per role (provenance).
  const reg = parse(store[REGISTRY_URL]);
  const roles = reg
    .getQuads(null, namedNode(`${GRAN_NS}dataSourceRole`), null, null)
    .map((q) => q.object.value)
    .sort();
  assert.deepEqual(roles, [`${GRAN_NS}InvestorRole`, `${GRAN_NS}UserRoleInstance`]);
});

// ── delete a building (hard delete) ─────────────────────────────────────────────

Deno.test("removeBuildingFromRegistry drops both the source and role triples", async () => {
  const a = newBuildingUri(WEBID, "a");
  const b = newBuildingUri(WEBID, "b");
  const reg = `@prefix gran: <${GRAN_NS}> .
<${REGISTRY_URL}> a gran:DataSourceRegistry ;
  gran:hasBuildingDataSource <${a}>, <${b}> .
<${a}> gran:dataSourceRole gran:UserRoleInstance .
<${b}> gran:dataSourceRole gran:InvestorRole .
`;
  const { session, store } = makeSession({ [REGISTRY_URL]: reg });

  await removeBuildingFromRegistry(session, WEBID, a);

  const r = parse(store[REGISTRY_URL]);
  assert.equal(
    r.getQuads(null, namedNode(`${GRAN_NS}hasBuildingDataSource`), namedNode(a), null).length,
    0,
    "removed building's source link is gone",
  );
  assert.equal(
    r.getQuads(namedNode(a), namedNode(`${GRAN_NS}dataSourceRole`), null, null).length,
    0,
    "removed building's role triple is gone",
  );
  // The other building is untouched.
  assert.equal(
    r.getQuads(null, namedNode(`${GRAN_NS}hasBuildingDataSource`), namedNode(b), null).length,
    1,
    "the other building is preserved",
  );
});

Deno.test("removeBuildingFromRegistry is a no-op when there is no registry", async () => {
  const { session } = makeSession(); // GET registry → 404
  await removeBuildingFromRegistry(session, WEBID, newBuildingUri(WEBID, "a"));
  // no throw == pass
});

Deno.test("deleteBuilding de-registers and deletes the building file", async () => {
  const uri = newBuildingUri(WEBID, "gone");
  const reg = `@prefix gran: <${GRAN_NS}> .
<${REGISTRY_URL}> a gran:DataSourceRegistry ;
  gran:hasBuildingDataSource <${uri}> .
<${uri}> gran:dataSourceRole gran:UserRoleInstance .
`;
  const { session, calls, store } = makeSession({
    [REGISTRY_URL]: reg,
    [uri]: "<#gone> a <x> .",
  });

  await deleteBuilding(session, WEBID, `${uri}#gone`);

  assert.ok(!(uri in store), "building file was DELETEd");
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url === uri),
    "a DELETE was issued for the building file",
  );
  const r = parse(store[REGISTRY_URL]);
  assert.equal(
    r.getQuads(null, namedNode(`${GRAN_NS}hasBuildingDataSource`), namedNode(uri), null).length,
    0,
    "building no longer registered",
  );
});

Deno.test("deleteBuilding refuses a building outside the user's own Pod", async () => {
  const { session } = makeSession();
  await assert.rejects(
    () =>
      deleteBuilding(
        session,
        WEBID,
        "https://other.example/granergize/buildings/x.ttl#x",
      ),
    /outside your own Pod/,
  );
});
