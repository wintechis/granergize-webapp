/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  addContact,
  contactsUrl,
  readContacts,
  removeContact,
} from "./contacts.ts";
import { _setStorageRootForTesting } from "./pod/solidUtils.ts";
import { makeFakeSession } from "./testing/fakeSession.ts";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const CARL = "https://carl.example/profile/card#me";

_setStorageRootForTesting(ALICE, "https://alice.example/");

/** In-memory Pod with ETags, so the If-Match read-modify-write path runs. */
const makeSession = () => makeFakeSession({ webId: ALICE, etags: true });

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
  assert.ok(!store[contactsUrl(ALICE)].includes("Bob"));
});
