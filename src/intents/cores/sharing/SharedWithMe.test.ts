/// <reference lib="deno.ns" />
// Tier-1: SharedWithMe folds the viewer's shared-in log → buildings shared with
// them. Driven over an offline fixture serving a shared-in grant; the underlying
// fold/prefs reads are covered in their own tests, so this proves the core wires
// them and shapes the result.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";
import { sharedWithMeCore } from "./SharedWithMe.ts";

const WEBID = "https://a.example/profile/card#me";
const ROOT = "https://a.example/";
_setStorageRootForTesting(WEBID, ROOT);

/** A permissive offline Pod: every GET 200s with the given body (empty by default). */
function fakePod(bodies: Record<string, string> = {}): PodGateway {
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const body = bodies[url] ?? "";
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return sessionGateway(
    { info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session,
  );
}

Deno.test("sharedWithMeCore: an empty shared-in log → []", async () => {
  const out = await sharedWithMeCore(fakePod());
  assert.deepEqual(out, []);
});
