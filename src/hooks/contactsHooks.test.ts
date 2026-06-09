/// <reference lib="deno.ns" />
import "./test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { useContacts, useResolveAgent } from "./queries.ts";
import { _setSessionForTesting } from "./session.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";
import { _resetProfileCacheForTesting } from "../services/pod/profileDocument.ts";

const WEBID = "https://pod.example/profile/card#me";
const CONTACTS = "https://pod.example/granergize/contacts.ttl";
const BOB = "https://bob.example/profile/card#me";
const BOB_DOC = "https://bob.example/profile/card";

const FIXTURES: Record<string, string> = {
  [CONTACTS]: `@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
<${CONTACTS}#book> a vcard:AddressBook ; vcard:hasMember <${BOB}> .
<${BOB}> a vcard:Individual ; vcard:fn "Bob Builder" .`,
  [BOB_DOC]: `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${BOB}> foaf:name "Bob (from profile)" ;
  foaf:img <https://bob.example/avatar.png> .`,
};

function fakeSession(store: Record<string, string> = { ...FIXTURES }): Session {
  const fetch = (input: string | URL): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const body = store[url];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return { info: { webId: WEBID, isLoggedIn: true }, fetch } as unknown as Session;
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

Deno.test("useContacts reads the address book from the session", async () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useContacts(), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    assert.equal(result.current.data?.length, 1);
    assert.equal(result.current.data?.[0].webId, BOB);
    assert.equal(result.current.data?.[0].name, "Bob Builder");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useResolveAgent resolves a WebID's name + avatar from its profile", async () => {
  _resetProfileCacheForTesting();
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useResolveAgent(BOB), { wrapper });
    await waitFor(() => assert.ok(result.current.isSuccess));
    assert.equal(result.current.data?.name, "Bob (from profile)");
    assert.equal(result.current.data?.avatarUrl, "https://bob.example/avatar.png");
  } finally {
    _setSessionForTesting(null);
  }
});

Deno.test("useResolveAgent is disabled until a WebID is given", () => {
  _setStorageRootForTesting(WEBID, "https://pod.example/");
  _setSessionForTesting(fakeSession());
  const { wrapper } = makeWrapper();
  try {
    const { result } = renderHook(() => useResolveAgent(undefined), { wrapper });
    assert.equal(result.current.fetchStatus, "idle"); // disabled, not fetching
    assert.equal(result.current.data, undefined);
  } finally {
    _setSessionForTesting(null);
  }
});
