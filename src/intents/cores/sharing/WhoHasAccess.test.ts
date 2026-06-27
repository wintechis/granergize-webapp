/// <reference lib="deno.ns" />
// Tier-1: WhoHasAccess folds the shared-out grants (injected here) and returns the
// distinct grantees for ONE building — Building-kind only, deduped.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
import type { ActiveGrant } from "../../../services/interop/sharingLog.ts";
import { whoHasAccessCore } from "./WhoHasAccess.ts";

const WEBID = "https://a.example/profile/card#me";
const GW: PodGateway = sessionGateway(
  { info: { isLoggedIn: true, webId: WEBID }, fetch: () => Promise.resolve(new Response("")) } as unknown as Session,
);
const A = "https://a.example/granergize/buildings/a.ttl#it";
const B = "https://a.example/granergize/buildings/b.ttl#it";
const g = (grantee: string, resource: string, kind: "Building" | "Aggregation"): ActiveGrant =>
  ({ owner: WEBID, grantee, resource, at: "2024-01-01T00:00:00Z", kind });

Deno.test("whoHasAccessCore: grantees of one building, Building-kind only, deduped", async () => {
  const grants = [
    g("https://bob.example/#me", A, "Building"),
    g("https://carol.example/#me", A, "Building"),
    g("https://bob.example/#me", A, "Building"), // duplicate grantee
    g("https://dave.example/#me", B, "Building"), // other building
    g("https://eve.example/#me", A, "Aggregation"), // wrong kind
  ];
  const who = await whoHasAccessCore(GW, { buildingUri: A }, () => Promise.resolve(grants));
  assert.deepEqual(who.sort(), ["https://bob.example/#me", "https://carol.example/#me"]);
});

Deno.test("whoHasAccessCore: a building shared with nobody → []", async () => {
  const who = await whoHasAccessCore(GW, { buildingUri: A }, () => Promise.resolve([]));
  assert.deepEqual(who, []);
});
