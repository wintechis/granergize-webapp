/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  addContact,
  contactsUri,
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
    // No explicit kind → defaults to a person (vcard:Individual).
    kind: "person",
  });
});

Deno.test("an organisation contact round-trips kind, homepage and sameAs", async () => {
  const { session } = makeSession();
  const ACME = "https://acme.example/org#it";
  await addContact(session, {
    webId: ACME,
    name: "ACME GmbH",
    kind: "organisation",
    homepage: "https://acme.example/",
    sameAs: ["http://www.wikidata.org/entity/Q42"],
  });
  const contacts = await readContacts(session);
  assert.equal(contacts.length, 1);
  assert.deepEqual(contacts[0], {
    webId: ACME,
    name: "ACME GmbH",
    kind: "organisation",
    homepage: "https://acme.example/",
    sameAs: ["http://www.wikidata.org/entity/Q42"],
  });
});

Deno.test("an organisation contact's logo (vcard:logo) round-trips and clears", async () => {
  const { session } = makeSession();
  const ACME = "https://acme.example/org#it";
  const LOGO = "https://a.example/granergize/contacts/logos/acme.png";
  await addContact(session, {
    webId: ACME,
    name: "ACME GmbH",
    kind: "organisation",
    logoUrl: LOGO,
  });
  assert.equal(
    (await readContacts(session)).find((c) => c.webId === ACME)?.logoUrl,
    LOGO,
  );
  // Re-saving without a logoUrl clears it.
  await addContact(session, { webId: ACME, name: "ACME GmbH", kind: "organisation" });
  assert.equal(
    (await readContacts(session)).find((c) => c.webId === ACME)?.logoUrl,
    undefined,
  );
});

Deno.test("a local 'works for' edge (org:memberOf) round-trips and clears", async () => {
  const { session } = makeSession();
  const ACME = "https://acme.example/org#it";
  await addContact(session, { webId: ACME, name: "ACME GmbH", kind: "organisation" });
  await addContact(session, { webId: BOB, name: "Bob", memberOf: ACME });

  const bob = (await readContacts(session)).find((c) => c.webId === BOB);
  assert.equal(bob?.memberOf, ACME, "the works-for edge reads back");

  // Re-saving without a memberOf clears the edge (no stale affiliation lingers).
  await addContact(session, { webId: BOB, name: "Bob" });
  const cleared = (await readContacts(session)).find((c) => c.webId === BOB);
  assert.equal(cleared?.memberOf, undefined, "edge dropped when omitted");
});

Deno.test("re-saving a contact as a person clears the prior organisation type", async () => {
  const { session } = makeSession();
  await addContact(session, { webId: BOB, name: "Bob", kind: "organisation" });
  await addContact(session, { webId: BOB, name: "Bob", kind: "person" });
  const contacts = await readContacts(session);
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].kind, "person", "no stale organisation type left behind");
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
  assert.ok(!store[contactsUri(ALICE)].includes("Bob"));
});
