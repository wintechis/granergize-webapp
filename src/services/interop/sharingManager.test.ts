/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { _setStorageRootForTesting } from "../utils/solidUtils.ts";
import {
  appendSharingEvent,
  sharedInUrl,
  sharedOutUrl,
} from "./sharingLog.ts";
import {
  getReceivedViews,
  getSharedBuildings,
  getSharedViews,
  getSharedWithMe,
  recordSharing,
  recordViewSharing,
  revokeAccess,
  revokeAllBuildingRecipients,
  revokeAllViewRecipients,
  revokeViewAccess,
} from "./sharingManager.ts";

const WEBID = "https://me.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://me.example/");
const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const SHARED_B = "https://alice.example/granergize/buildings/b9.ttl";
const MY_B = "https://me.example/granergize/buildings/b1.ttl";
const SNAP =
  "https://me.example/granergize/views/snapshots/view-1-abc.ttl";

/** Stateful fake Pod with POST-to-append + container-listing synthesis. */
function makePod(): { session: Session; store: Record<string, string> } {
  const store: Record<string, string> = {};
  let seq = 0;
  const directChildren = (container: string): string[] => {
    const out = new Set<string>();
    for (const key of Object.keys(store)) {
      if (!key.startsWith(container) || key === container) continue;
      const rest = key.slice(container.length);
      const slash = rest.indexOf("/");
      out.add(slash === -1 ? key : `${container}${rest.slice(0, slash)}/`);
    }
    return [...out];
  };
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") {
      store[url] = String(init?.body ?? "");
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === "POST") {
      const child = `${url}evt-${seq++}`;
      store[child] = String(init?.body ?? "");
      return Promise.resolve(
        new Response(null, { status: 201, headers: { Location: child } }),
      );
    }
    if (method === "DELETE") {
      delete store[url];
      return Promise.resolve(new Response(null, { status: 205 }));
    }
    if (method === "HEAD") {
      return Promise.resolve(
        new Response(null, { status: url.endsWith("/") || url in store ? 200 : 404 }),
      );
    }
    if (url.endsWith("/")) {
      const refs = directChildren(url).map((c) => `<${c}>`).join(", ");
      const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${url}> a ldp:Container${
        refs ? ` ; ldp:contains ${refs}` : ""
      } .\n`;
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
      );
    }
    const body = store[url];
    if (body === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } }),
    );
  };
  return {
    session: {
      info: { webId: WEBID, isLoggedIn: true },
      fetch,
    } as unknown as Session,
    store,
  };
}

Deno.test("getSharedWithMe folds shared-in/ Building grants (sharer + visible)", async () => {
  const { session } = makePod();
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "grant", owner: ALICE, grantee: WEBID, resource: SHARED_B,
    kind: "Building", at: "2026-06-04T10:00:00Z",
  });

  const shared = await getSharedWithMe(session);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].buildingUri, SHARED_B);
  assert.equal(shared[0].sharedBy, ALICE);
  assert.equal(shared[0].buildingId, "b9");
  assert.equal(shared[0].isVisible, true); // nothing hidden in prefs
});

Deno.test("getSharedWithMe ignores View grants in shared-in/", async () => {
  const { session } = makePod();
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "grant", owner: ALICE, grantee: WEBID, resource: SNAP,
    kind: "View", at: "2026-06-04T10:00:00Z",
  });
  assert.deepEqual(await getSharedWithMe(session), []);
});

Deno.test("recordSharing → getSharedBuildings shows the grantee; revokeAccess drops it", async () => {
  const { session } = makePod();
  await recordSharing(MY_B, BOB, session, true);

  let shared = await getSharedBuildings(session);
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].sharedWith, [BOB]);
  assert.equal(shared[0].buildingUri, MY_B);

  // revokeAccess appends a revocation to shared-out/ (ACL/notify best-effort).
  await revokeAccess(MY_B, BOB, session);
  shared = await getSharedBuildings(session);
  assert.deepEqual(shared, []);
});

Deno.test("revokeAllBuildingRecipients revokes + notifies every grantee (for building delete)", async () => {
  const { session, store } = makePod();
  const BOB_INBOX = "https://bob.example/granergize/inbox/";
  const ALICE_INBOX = "https://alice.example/granergize/inbox/";
  store["https://bob.example/profile/card"] =
    `<${BOB}> <http://www.w3.org/ns/pim/space#storage> <https://bob.example/> .`;
  store["https://alice.example/profile/card"] =
    `<${ALICE}> <http://www.w3.org/ns/pim/space#storage> <https://alice.example/> .`;
  // MY_B shared with both BOB and ALICE (recorded in shared-out/).
  await recordSharing(MY_B, BOB, session, false);
  await recordSharing(MY_B, ALICE, session, false);

  await revokeAllBuildingRecipients(MY_B, session);

  // Each recipient got an AccessRevocation in their inbox…
  for (const inbox of [BOB_INBOX, ALICE_INBOX]) {
    const posted = Object.entries(store).find(([url]) => url.startsWith(inbox));
    assert.ok(posted, `revocation posted to ${inbox}`);
    assert.match(posted![1], /AccessRevocation/);
  }
  // …and the owner's shared-out/ no longer lists the building (revocations folded out).
  assert.deepEqual(await getSharedBuildings(session), []);
});

Deno.test("getSharedViews folds shared-out/ View grants and recovers the viewId", async () => {
  const { session } = makePod();
  await appendSharingEvent(sharedOutUrl(WEBID), session, {
    type: "grant", owner: WEBID, grantee: BOB, resource: SNAP,
    kind: "View", at: "2026-06-04T10:00:00Z",
  });

  const views = await getSharedViews(session);
  assert.equal(views.length, 1);
  assert.equal(views[0].snapshotUrl, SNAP);
  assert.equal(views[0].viewId, "view-1-abc");
  assert.deepEqual(views[0].sharedWith, [BOB]);
});

const ALICE_SNAP =
  "https://alice.example/granergize/views/snapshots/view-7-xyz.ttl";

Deno.test("getReceivedViews folds shared-in/ View grants (snapshot + sharer)", async () => {
  const { session } = makePod();
  // A View grant received from Alice…
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "grant", owner: ALICE, grantee: WEBID, resource: ALICE_SNAP,
    kind: "View", at: "2026-06-04T10:00:00Z",
  });
  // …and a Building grant that must NOT show up among received views.
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "grant", owner: ALICE, grantee: WEBID, resource: SHARED_B,
    kind: "Building", at: "2026-06-04T10:01:00Z",
  });

  const views = await getReceivedViews(session);
  assert.equal(views.length, 1);
  assert.equal(views[0].snapshotUrl, ALICE_SNAP);
  assert.equal(views[0].viewId, "view-7-xyz");
  assert.equal(views[0].sharedBy, ALICE);
});

Deno.test("getReceivedViews drops a view once its grant is revoked", async () => {
  const { session } = makePod();
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "grant", owner: ALICE, grantee: WEBID, resource: ALICE_SNAP,
    kind: "View", at: "2026-06-04T10:00:00Z",
  });
  await appendSharingEvent(sharedInUrl(WEBID), session, {
    type: "revocation", owner: ALICE, grantee: WEBID, resource: ALICE_SNAP,
    at: "2026-06-04T11:00:00Z",
  });
  assert.deepEqual(await getReceivedViews(session), []);
});

Deno.test("revokeViewAccess posts an AccessRevocation to the recipient's inbox", async () => {
  const { session, store } = makePod();
  const BOB_INBOX = "https://bob.example/granergize/inbox/";
  // Seed BOB's WebID profile with pim:storage so getRecipientInboxUrl resolves
  // BOB's storage root → granergize/ inbox (by convention; the fake granergize
  // container carries no ldp:inbox).
  store["https://bob.example/profile/card"] =
    `<${BOB}> <http://www.w3.org/ns/pim/space#storage> <https://bob.example/> .`;

  await revokeViewAccess(SNAP, BOB, session);

  // A revocation message landed in BOB's inbox, naming the snapshot + grantee, so
  // BOB's readInbox archives it into shared-in/ and getReceivedViews folds it out.
  const posted = Object.entries(store).find(([url]) => url.startsWith(BOB_INBOX));
  assert.ok(posted, "a message was posted to BOB's inbox");
  const body = posted![1];
  assert.match(body, /AccessRevocation/);
  assert.ok(body.includes(SNAP), "names the revoked snapshot");
  assert.ok(body.includes(BOB), "names the grantee");
});

Deno.test("revokeAllViewRecipients revokes + notifies every grantee (for view delete)", async () => {
  const { session, store } = makePod();
  const BOB_INBOX = "https://bob.example/granergize/inbox/";
  const ALICE_INBOX = "https://alice.example/granergize/inbox/";
  store["https://bob.example/profile/card"] =
    `<${BOB}> <http://www.w3.org/ns/pim/space#storage> <https://bob.example/> .`;
  store["https://alice.example/profile/card"] =
    `<${ALICE}> <http://www.w3.org/ns/pim/space#storage> <https://alice.example/> .`;
  // A shared SNAP with both BOB and ALICE (recorded in shared-out/).
  await recordViewSharing(SNAP, BOB, session);
  await recordViewSharing(SNAP, ALICE, session);

  await revokeAllViewRecipients(SNAP, session);

  // Each recipient got an AccessRevocation in their inbox…
  for (const inbox of [BOB_INBOX, ALICE_INBOX]) {
    const posted = Object.entries(store).find(([url]) => url.startsWith(inbox));
    assert.ok(posted, `revocation posted to ${inbox}`);
    assert.match(posted![1], /AccessRevocation/);
  }
  // …and the owner's shared-out/ no longer lists either (revocations folded out).
  assert.deepEqual(await getSharedViews(session), []);
});
