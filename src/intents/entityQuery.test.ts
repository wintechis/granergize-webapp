import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
/// <reference lib="deno.ns" />
//
// Tier-1 proof that the EntityQuery resolver turns a bare IRI into the typed
// instance the intent layer's `applies()` guards consume — HEADLESS: driven with
// a fake offline-fixture Session (no React, no component tree, no collection
// fold), exactly the binding seam a deep link / palette / LLM tool needs. A
// building IRI → a `BuildingType` (with the own-vs-shared guard fact set), an
// aggregation IRI → an `AggregationDefinition`, an unknown IRI / unsupported
// entity → `undefined`; `applicableForIri` then yields the state-filtered verbs.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { applicableForIri, resolve } from "./entityQuery.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { CONSUMPTION_NS, REC_BUILDING } from "../services/rdf/vocabularies.ts";
import type { AggregationDefinition, BuildingType } from "../types.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);

const OWN_BUILDING = `${ROOT}granergize/buildings/b-1.ttl`;
const FOREIGN_BUILDING = "https://bob.example/granergize/buildings/x.ttl";
const AGGREGATION = `${ROOT}granergize/aggregations/agg-1.ttl`;

// An own building carrying one energy dataset link — enough to exercise both the
// own-vs-shared guard and the has-energy guard the affordances read. The link is
// a time-first observation IRI (year in the path) so the real parser derives a ref.
const DATASET = `${ROOT}granergize/observations/2024/d1.ttl#ds`;
const OWN_BUILDING_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${OWN_BUILDING}#it> a <${REC_BUILDING}> ;
  cons:hasEnergyDataset <${DATASET}> .
<${DATASET}> cons:granularity "P1Y" ; cons:scenario cons:Actual .
`;

// A foreign building (lives off the viewer's storage root → shared-with-me).
const FOREIGN_BUILDING_TTL = `
<${FOREIGN_BUILDING}#it> a <${REC_BUILDING}> .
`;

// An aggregation definition matching `parseAggregationDefinition`'s shape.
const AGGREGATION_TTL = `
@prefix cons: <${CONSUMPTION_NS}> .
<${AGGREGATION}#aggregation> a cons:AggregationDefinition ;
  cons:aggregationId "agg-1" ;
  cons:aggregationName "Portfolio average" ;
  cons:aggregationType "average" ;
  cons:createdAt "2024-01-01T00:00:00Z" ;
  cons:lastComputedAt "2024-02-01T00:00:00Z" ;
  cons:includesBuilding <${OWN_BUILDING}#it> ;
  cons:includesMetric "electricityConsumption" .
`;

/** A read-only offline fixture serving in-memory Turtle per URL (no network). */
function fakeSession(store: Record<string, string>): PodGateway {
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split(
      "?",
    )[0];
    const body = store[url];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      }),
    );
  };
  return sessionGateway({
    info: { isLoggedIn: true, webId: WEBID },
    fetch,
  } as unknown as Session);
}

Deno.test("resolve(building): own building IRI → BuildingType, isShared=false, has energy", async () => {
  const session = fakeSession({ [OWN_BUILDING]: OWN_BUILDING_TTL });

  const obj = await resolve("building", `${OWN_BUILDING}#it`, session);
  assert.ok(obj, "resolved an object");
  const b = obj as BuildingType;

  // Identity + type came through the real parser.
  assert.equal(b.uri, `${OWN_BUILDING}#it`);
  assert.equal(b.type, REC_BUILDING);
  // The own-vs-shared guard fact: lives under the viewer's storage root → own.
  assert.equal(b.isShared, false);
  // The has-energy guard fact: the dataset link was parsed.
  assert.equal((b.energyDatasets?.length ?? 0) > 0, true);
});

Deno.test("resolve(building): foreign building IRI → BuildingType, isShared=true", async () => {
  const session = fakeSession({ [FOREIGN_BUILDING]: FOREIGN_BUILDING_TTL });

  const obj = await resolve("building", `${FOREIGN_BUILDING}#it`, session);
  assert.ok(obj);
  const b = obj as BuildingType;
  // Source off the viewer's storage root → shared-with-me.
  assert.equal(b.isShared, true);
});

Deno.test("resolve(aggregation): aggregation IRI → AggregationDefinition", async () => {
  const session = fakeSession({ [AGGREGATION]: AGGREGATION_TTL });

  const obj = await resolve("aggregation", `${AGGREGATION}#aggregation`, session);
  assert.ok(obj, "resolved an object");
  const a = obj as AggregationDefinition;
  assert.equal(a.id, "agg-1");
  assert.equal(a.name, "Portfolio average");
  assert.equal(a.aggregationType, "average");
  // The snapshot-exists guard fact (RefreshAggregation/ShareAggregation gate on it).
  assert.equal(a.lastComputedAt != null, true);
});

Deno.test("resolve: unknown IRI → undefined; unsupported entity → undefined", async () => {
  const session = fakeSession({});

  // A building IRI that 404s.
  assert.equal(
    await resolve("building", `${OWN_BUILDING}#it`, session),
    undefined,
  );
  // An entity with no per-object guard (no resolver).
  assert.equal(await resolve("room", `${ROOT}whatever`, session), undefined);
});

Deno.test("applicableForIri(building): own building affords owner-only verbs", async () => {
  const session = fakeSession({ [OWN_BUILDING]: OWN_BUILDING_TTL });

  const verbs = await applicableForIri(
    "building",
    `${OWN_BUILDING}#it`,
    {},
    session,
  );
  const names = verbs.map((v) => v.name);
  // Owner-only verbs are offered on an own building...
  assert.ok(names.includes("ShareBuilding"), "own building affords ShareBuilding");
  assert.ok(names.includes("UpdateBuilding"), "own building affords UpdateBuilding");
  // ...and DeleteObservation, gated on own + has-energy, is too (the fixture has a dataset).
  assert.ok(
    names.includes("DeleteObservation"),
    "own building with energy affords DeleteObservation",
  );
  // ToggleVisibility is shared-only → not offered on an own building.
  assert.ok(
    !names.includes("ToggleVisibility"),
    "own building does NOT afford ToggleVisibility",
  );
});

Deno.test("applicableForIri: unresolvable IRI → empty verb set", async () => {
  const session = fakeSession({});
  const verbs = await applicableForIri("building", `${OWN_BUILDING}#it`, {}, session);
  assert.deepEqual(verbs, []);
});
