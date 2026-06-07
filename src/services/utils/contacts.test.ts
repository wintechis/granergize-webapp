/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  addContact,
  contactsUrl,
  readContacts,
  removeContact,
} from "./contacts.ts";
import { _setStorageRootForTesting } from "./solidUtils.ts";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CARL = "https://carl.example/profile/card#me";

_setStorageRootForTesting(ALICE, "https://alice.example/");

/**
 * Minimal in-memory Pod: GET returns the stored body (+ ETag) or 404, PUT stores
 * the body. Enough for readContacts/addContact/removeContact's read-modify-write.
 */
function makeSession(): { session: Session; store: Map<string, string> } {
  const store = new Map<string, string>();
  let seq = 0;
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store.set(url, String(init?.body ?? ""));
      return Promise.resolve(new Response("", { status: 201 }));
    }
    const body = store.get(url);
    if (body === undefined) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/turtle", ETag: `etag-${++seq}` },
      }),
    );
  };
  return {
    session: { info: { isLoggedIn: true, webId: ALICE }, fetch } as unknown as Session,
    store,
  };
}

Deno.test("addContact → readContacts round-trips WebID, name and avatar", async () => {
  const { session } = makeSession();
  await addContact(session, {
    webId: BOB,
    name: "Bob Builder",
    avatarUrl: "https://bob.example/avatar.png",
  });
  const contacts = await readContacts(session);
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0], {
    webId: BOB,
    name: "Bob Builder",
    avatarUrl: "https://bob.example/avatar.png",
  });
});

Deno.test("readContacts on a missing file yields an empty list", async () => {
  const { session } = makeSession();
  assert.deepEqual(await readContacts(session), []);
});

Deno.test("addContact is idempotent — re-adding updates name, doesn't duplicate", async () => {
  const { session } = makeSession();
  await addContact(session, { webId: BOB, name: "Bob" });
  await addContact(session, { webId: BOB, name: "Bob Builder" });
  const contacts = await readContacts(session);
  assert.equal(contacts.length, 1, "no duplicate member");
  assert.equal(contacts[0].name, "Bob Builder", "name updated in place");
});

Deno.test("removeContact drops the member and its cached fields", async () => {
  const { session, store } = makeSession();
  await addContact(session, { webId: BOB, name: "Bob" });
  await addContact(session, { webId: CARL, name: "Carl" });
  await removeContact(session, BOB);

  const contacts = await readContacts(session);
  assert.deepEqual(contacts.map((c) => c.webId), [CARL]);
  // Bob's vCard fields are gone from the document, not just the membership.
  assert.ok(!store.get(contactsUrl(ALICE))!.includes("Bob"));
});
