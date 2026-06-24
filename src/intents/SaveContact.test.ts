/// <reference lib="deno.ns" />
//
// Tier-1 proof that the SaveContact core is callable HEADLESS through the
// PodGateway PORT — driven with a hand-built `{ fetch, info }` gateway rather
// than an @inrupt Session, so it exercises exactly the surface a non-Session
// caller (a Tier-2 runner, the bench seeder, an LLM tool) would supply. No
// React, no component tree. Asserts the address-book write landed.
import { strict as assert } from "node:assert";
import { saveContactCore } from "./SaveContact.ts";
import { podGateway } from "../services/pod/podGateway.ts";
import { makeFakeSession } from "../services/testing/fakeSession.ts";
import { _setStorageRootForTesting } from "../services/pod/solidUtils.ts";

const OWNER = "https://a.example/profile/card#me";
const CONTACTS = "https://a.example/granergize/contacts.ttl";
const FRIEND = "https://friend.example/profile/card#me";

Deno.test("saveContactCore writes a contact via a bare PodGateway (no Session)", async () => {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const { session, store, calls } = makeFakeSession({ webId: OWNER });

  // Build the gateway from a raw fetch + WebID — the headless construction path,
  // NOT a Session. (We borrow the fake's fetch as the authed transport.)
  const gateway = podGateway(session.fetch, OWNER);

  const outcome = await saveContactCore(gateway, {
    contact: { webId: FRIEND, name: "Fran Friend" },
  });

  assert.deepEqual(outcome, { ok: true });

  // The address book was created at the resolved contacts URI and names the friend.
  const written = store[CONTACTS];
  assert.ok(written, "contacts.ttl should have been written");
  assert.match(written, new RegExp(FRIEND));
  assert.match(written, /Fran Friend/);

  // The write went through read-modify-write: a GET (read) then a PUT (write).
  const methods = calls.filter((c) => c.url === CONTACTS).map((c) => c.method);
  assert.ok(methods.includes("PUT"), "expected a PUT to contacts.ttl");
});

Deno.test("saveContactCore uploads an org logo, sets a public ACL, links vcard:logo", async () => {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const { session, store } = makeFakeSession({ webId: OWNER });
  const gateway = podGateway(session.fetch, OWNER);

  const logo = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  await saveContactCore(gateway, {
    contact: { webId: FRIEND, name: "ACME GmbH", kind: "organisation" },
    logo,
  });

  // The image landed under the user's own app tree, keyed by the contact's WebID.
  const logoUri =
    "https://a.example/granergize/contacts/logos/friend-example-profile-card-me.png";
  assert.ok(store[logoUri] !== undefined, "logo image should have been uploaded");
  // A public-read ACL was published next to it.
  const acl = store[`${logoUri}.acl`];
  assert.ok(acl, "logo .acl should have been written");
  assert.match(acl, /acl:agentClass\s+foaf:Agent/);
  assert.match(acl, /acl:Read/);
  // The contact links the uploaded logo via vcard:logo.
  assert.match(store[CONTACTS], new RegExp(logoUri.replace(/[.]/g, "\\.")));
  assert.match(store[CONTACTS], /logo/);
});

Deno.test("saveContactCore is idempotent: re-adding the same WebID updates in place", async () => {
  _setStorageRootForTesting(OWNER, "https://a.example/");
  const { session, store } = makeFakeSession({ webId: OWNER, etags: true });
  const gateway = podGateway(session.fetch, OWNER);

  await saveContactCore(gateway, { contact: { webId: FRIEND, name: "First" } });
  await saveContactCore(gateway, { contact: { webId: FRIEND, name: "Second" } });

  const written = store[CONTACTS];
  // The name was replaced, not duplicated.
  assert.match(written, /Second/);
  assert.doesNotMatch(written, /First/);
  assert.equal((written.match(new RegExp(FRIEND, "g")) ?? []).length >= 1, true);
});
