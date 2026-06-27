/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../../../services/pod/podGateway.ts";
//
// Tier-1 proof that the ToggleVisibility core is callable HEADLESS (a
// representative PLAIN core): it flips a shared-in building's dashboard
// visibility by writing prefs.ttl and returns the `Settled` outcome the adapter
// reads.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { toggleVisibilityCore } from "./ToggleVisibility.ts";
import { _setStorageRootForTesting } from "../../../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const PREFS = "https://a.example/granergize/prefs.ttl";
const SHARED = "https://b.example/granergize/buildings/b-9.ttl#b-9";

interface Call {
  url: string;
  method: string;
  body?: string;
}

function ownerPod(): { session: PodGateway; calls: Call[]; store: Record<string, string> } {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const store: Record<string, string> = {};
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init?.body ? String(init.body) : undefined });
    if (method === "PUT" || method === "POST") {
      if (init?.body != null) store[url] = String(init.body);
      return Promise.resolve(new Response("", { status: 201 }));
    }
    if (method === "HEAD") {
      return Promise.resolve(
        new Response("", { status: url.endsWith("/") || url in store ? 200 : 404 }),
      );
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: sessionGateway({ info: { isLoggedIn: true, webId: OWNER }, fetch } as unknown as Session),
    calls,
    store,
  };
}

Deno.test("toggleVisibilityCore (headless): hides a shared-in building → prefs.ttl written, Settled", async () => {
  const { session, calls, store } = ownerPod();

  const outcome = await toggleVisibilityCore(session, { buildingUri: SHARED });

  // A plain write returns the Settled outcome the adapter reads.
  assert.deepEqual(outcome, { ok: true });

  // The toggle wrote prefs.ttl (the single resource every visibility reader follows).
  assert.ok(calls.some((c) => c.method === "PUT" && c.url === PREFS), "prefs.ttl written");
  assert.ok(store[PREFS]?.includes(SHARED.split("#")[0]) || store[PREFS]?.includes(SHARED));
});
