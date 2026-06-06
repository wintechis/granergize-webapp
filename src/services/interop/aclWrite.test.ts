/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { grantReadAccess } from "./share.ts";
import { removeFromACL } from "./sharingManager.ts";
import { ACL_NS } from "../utils/vocabularies.ts";

const OWNER = "https://owner.example/profile/card#me";
const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const RESOURCE = "https://owner.example/granergize/buildings/b1.ttl";
const ACL_URL = `${RESOURCE}.acl`;

/**
 * A single-ACL fake with CSS-like ETag + If-Match/If-None-Match semantics, so the
 * optimistic-lock retry path in readModifyWrite is actually exercised.
 * `failNextPuts` forces N leading PUTs to 412 (a concurrent writer winning the race).
 */
function aclServer(
  initialBody: string | null,
  opts: { failNextPuts?: number } = {},
) {
  let body = initialBody;
  let version = 0;
  let etag = initialBody ? `"v0"` : null;
  let fail = opts.failNextPuts ?? 0;
  let puts = 0;

  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    assert.equal(url, ACL_URL, `unexpected fetch to ${url}`);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      if (body === null) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle", ETag: etag! },
        }),
      );
    }
    if (method === "PUT") {
      puts++;
      const h = new Headers(init?.headers);
      if (fail > 0) {
        fail--;
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      if (h.get("If-None-Match") === "*" && body !== null) {
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      if (h.get("If-Match") && h.get("If-Match") !== etag) {
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      body = String(init?.body ?? "");
      etag = `"v${++version}"`;
      return Promise.resolve(new Response(null, { status: 205 }));
    }
    return Promise.resolve(new Response(null, { status: 405 }));
  };

  return {
    session: { info: { webId: OWNER, isLoggedIn: true }, fetch } as unknown as
      Session,
    get body() {
      return body;
    },
    get puts() {
      return puts;
    },
  };
}

/** Parse the ACL and return, per agent WebID, the set of authorization subjects. */
function authsByAgent(ttl: string): Map<string, Set<string>> {
  const store = new Store(new Parser({ baseIRI: ACL_URL }).parse(ttl));
  const out = new Map<string, Set<string>>();
  for (const q of store.getQuads(null, `${ACL_NS}agent`, null, null)) {
    const agent = q.object.value;
    if (!out.has(agent)) out.set(agent, new Set());
    out.get(agent)!.add(q.subject.value);
  }
  return out;
}

/** Count quads carrying a given subject — used to assert no duplicate triples. */
function quadsForSubject(ttl: string, subject: string): number {
  const store = new Store(new Parser({ baseIRI: ACL_URL }).parse(ttl));
  return store.getQuads(subject, null, null, null).length;
}

Deno.test("grant on a missing ACL writes owner Control + recipient Read", async () => {
  const srv = aclServer(null);
  await grantReadAccess(RESOURCE, ALICE, srv.session);

  const agents = authsByAgent(srv.body!);
  // Owner keeps full control, Alice gets a Read authorization.
  assert.ok(agents.has(OWNER), "owner authorization present");
  assert.ok(agents.has(ALICE), "recipient authorization present");

  const store = new Store(new Parser({ baseIRI: ACL_URL }).parse(srv.body!));
  const ownerSubj = [...agents.get(OWNER)!][0];
  const ownerModes = new Set(
    store.getQuads(ownerSubj, `${ACL_NS}mode`, null, null).map((q) =>
      q.object.value
    ),
  );
  assert.deepEqual(
    [...ownerModes].sort(),
    [`${ACL_NS}Control`, `${ACL_NS}Read`, `${ACL_NS}Write`].sort(),
  );
});

Deno.test("re-granting the same recipient is idempotent (no duplicate auth)", async () => {
  const srv = aclServer(null);
  await grantReadAccess(RESOURCE, ALICE, srv.session);
  const after1 = srv.body!;
  const aliceSubj = [...authsByAgent(after1).get(ALICE)!][0];
  const quads1 = quadsForSubject(after1, aliceSubj);

  await grantReadAccess(RESOURCE, ALICE, srv.session);
  const after2 = srv.body!;

  // Still exactly one authorization subject for Alice, with the same triple count.
  assert.equal(authsByAgent(after2).get(ALICE)!.size, 1);
  assert.equal(quadsForSubject(after2, aliceSubj), quads1);
});

Deno.test("granting a second recipient preserves the first and the owner", async () => {
  const srv = aclServer(null);
  await grantReadAccess(RESOURCE, ALICE, srv.session);
  await grantReadAccess(RESOURCE, BOB, srv.session);

  const agents = authsByAgent(srv.body!);
  assert.ok(agents.has(OWNER), "owner kept");
  assert.ok(agents.has(ALICE), "first recipient kept");
  assert.ok(agents.has(BOB), "second recipient added");
});

Deno.test("a container grant adds acl:default", async () => {
  const srv = aclServer(null);
  await grantReadAccess(`${RESOURCE}`, ALICE, srv.session, true);
  const store = new Store(new Parser({ baseIRI: ACL_URL }).parse(srv.body!));
  const defaults = store.getQuads(null, `${ACL_NS}default`, null, null);
  assert.ok(defaults.length >= 1, "acl:default written for container");
});

Deno.test("grant retries on a 412 from a concurrent writer, then succeeds", async () => {
  const srv = aclServer(null, { failNextPuts: 1 });
  await grantReadAccess(RESOURCE, ALICE, srv.session);
  assert.equal(srv.puts, 2, "one failed PUT, one successful retry");
  assert.ok(authsByAgent(srv.body!).has(ALICE), "grant landed after retry");
});

/** An ACL seeded with the owner's control block + Read auths for Alice and Bob. */
function seededAcl(): string {
  const auth = (label: string, agent: string, modes: string[]) =>
    [
      `<${ACL_URL}#${label}> a <${ACL_NS}Authorization> ;`,
      `  <${ACL_NS}agent> <${agent}> ;`,
      `  <${ACL_NS}accessTo> <${RESOURCE}> ;`,
      modes.map((m) => `  <${ACL_NS}mode> <${ACL_NS}${m}> `).join(";\n"),
      `.`,
    ].join("\n");
  return [
    auth("Control", OWNER, ["Read", "Write", "Control"]),
    auth("Read_alice", ALICE, ["Read"]),
    auth("Read_bob", BOB, ["Read"]),
  ].join("\n") + "\n";
}

Deno.test("revoke drops only the recipient, keeping owner and other grantees", async () => {
  const srv = aclServer(seededAcl());
  await removeFromACL(RESOURCE, ALICE, srv.session);

  const agents = authsByAgent(srv.body!);
  assert.ok(!agents.has(ALICE), "Alice revoked");
  assert.ok(agents.has(OWNER), "owner kept");
  assert.ok(agents.has(BOB), "other recipient kept");
});

Deno.test("revoke of an absent recipient skips the PUT entirely", async () => {
  const srv = aclServer(seededAcl());
  const carol = "https://carol.example/profile/card#me";
  await removeFromACL(RESOURCE, carol, srv.session);
  assert.equal(srv.puts, 0, "no write when there's nothing to remove");
});

Deno.test("revoke on a missing ACL is a no-op (no throw, no PUT)", async () => {
  const srv = aclServer(null);
  await removeFromACL(RESOURCE, ALICE, srv.session);
  assert.equal(srv.puts, 0);
});

Deno.test("revoke retries on a 412 from a concurrent writer, then succeeds", async () => {
  const srv = aclServer(seededAcl(), { failNextPuts: 1 });
  await removeFromACL(RESOURCE, BOB, srv.session);
  assert.equal(srv.puts, 2, "one failed PUT, one successful retry");
  assert.ok(!authsByAgent(srv.body!).has(BOB), "revoke landed after retry");
});
