/// <reference lib="deno.ns" />
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";
//
// Tier-1 proof that the SaveOrganisation core is callable HEADLESS, and that the
// optional logo upload is part of the core's composition: a logo present runs BOTH
// the profile save and the logo upload; a null logo runs only the save. Driven
// with a fake offline-fixture Session — no React, no component tree.
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { saveOrganisationCore } from "./SaveOrganisation.ts";

const WEBID = "https://a.example/profile/card#me";
const PROFILE_DOC = "https://a.example/profile/card";
const LOGO = "https://a.example/profile/logo.png";

const PROFILE_TTL = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${WEBID}> a foaf:Agent .
`;

interface Call {
  url: string;
  method: string;
}

/**
 * Stateful fake one-Pod world: serves the WebID profile doc (so the conditional
 * GET→PUT of `saveOrganization` resolves) and records every call so the save vs
 * logo-upload PUTs can be distinguished by URL.
 */
function orgPod(): { session: PodGateway; calls: Call[] } {
  const store: Record<string, string> = { [PROFILE_DOC]: PROFILE_TTL };
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "PUT" || method === "POST") {
      return Promise.resolve(new Response("", { status: 201 }));
    }
    const body = store[url];
    if (body === undefined) return Promise.resolve(new Response("Not found", { status: 404 }));
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: sessionGateway({ info: { isLoggedIn: true, webId: WEBID }, fetch } as unknown as Session),
    calls,
  };
}

Deno.test("saveOrganisationCore (headless): logo present → save AND upload run", async () => {
  const { session, calls } = orgPod();
  const logo = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

  const outcome = await saveOrganisationCore(session, {
    org: { name: "Ahlmann Logistik" },
    logo,
  });

  assert.deepEqual(outcome, { ok: true });
  // The profile doc was written (the org save).
  assert.ok(
    calls.some((c) => c.method === "PUT" && c.url === PROFILE_DOC),
    "profile doc PUT (org save) ran",
  );
  // The logo image was uploaded (the optional logo step inside the composition).
  assert.ok(
    calls.some((c) => c.method === "PUT" && c.url === LOGO),
    "logo image PUT (upload) ran",
  );
});

Deno.test("saveOrganisationCore (headless): logo null → only save runs, no upload", async () => {
  const { session, calls } = orgPod();

  const outcome = await saveOrganisationCore(session, {
    org: { name: "Ahlmann Logistik" },
    logo: null,
  });

  assert.deepEqual(outcome, { ok: true });
  assert.ok(
    calls.some((c) => c.method === "PUT" && c.url === PROFILE_DOC),
    "profile doc PUT (org save) ran",
  );
  assert.ok(
    !calls.some((c) => c.url === LOGO),
    "no logo upload when logo is null",
  );
});
