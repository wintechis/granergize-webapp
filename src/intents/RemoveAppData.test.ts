/// <reference lib="deno.ns" />
//
// Tier-1 proof that the RemoveAppData core is callable HEADLESS and that a CANCEL
// is an OUTCOME, not a throw: with an already-aborted signal the recursive delete
// rejects (`throwIfAborted`) and the core resolves `{aborted: true}` rather than
// propagating. A clean run resolves `{aborted: false}`. Driven with a fake
// offline-fixture Session — no React, no component tree.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { removeAppDataCore } from "./RemoveAppData.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const WEBID = "https://a.example/profile/card#me";

/** A fake one-Pod world: an empty app collection (a HEAD/GET 200 for the root, 404
 * for anything below) so a non-aborted wipe completes cleanly. */
function pod(): Session {
  _setStorageRootForTesting(WEBID, "https://a.example/");
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "DELETE") return Promise.resolve(new Response(null, { status: 205 }));
    // The app-collection container reads back empty (no child resources to recurse).
    if (url.endsWith("/")) {
      return Promise.resolve(
        new Response("", { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return { info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session;
}

Deno.test("removeAppDataCore (headless): cancelled run resolves {aborted: true}, not a throw", async () => {
  const session = pod();
  const controller = new AbortController();
  controller.abort(); // already aborted before the wipe starts

  // The whole point: a user cancel must NOT reject — it returns the outcome.
  const outcome = await removeAppDataCore(session, { signal: controller.signal });

  assert.deepEqual(outcome, { aborted: true });
});

Deno.test("removeAppDataCore (headless): clean run resolves {aborted: false}", async () => {
  const outcome = await removeAppDataCore(pod(), {});
  assert.deepEqual(outcome, { aborted: false });
});
