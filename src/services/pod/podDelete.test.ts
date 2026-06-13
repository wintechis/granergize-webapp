/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  deleteContainerRecursive,
  formatResourceList,
  listContainedResources,
  listDirectChildren,
  removeAppData,
} from "./podDelete.ts";
import { _setStorageRootForTesting } from "./solidUtils.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";

// storageRoot = https://pod.example/ ; the app tree is https://pod.example/granergize/
const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");

const ROOT = "https://pod.example/";
const GRAN = `${ROOT}granergize/`;

/** An LDP container listing (Turtle) declaring `children` via ldp:contains. */
function listing(container: string, children: string[]): string {
  const refs = children.map((c) => `<${c}>`).join(", ");
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${container}> a ldp:Container, ldp:BasicContainer ;
  ldp:contains ${refs} .
`;
}

// A small nested tree under granergize/:
//   granergize/
//   ├── dataSources.ttl
//   └── buildings/
//       ├── b1.ttl
//       └── b1/
//           └── energy/
//               └── 2024-06-03.ttl
const FIXTURES: Record<string, string> = {
  [GRAN]: listing(GRAN, [`${GRAN}buildings/`, `${GRAN}dataSources.ttl`]),
  [`${GRAN}buildings/`]: listing(`${GRAN}buildings/`, [
    `${GRAN}buildings/b1.ttl`,
    `${GRAN}buildings/b1/`,
  ]),
  [`${GRAN}buildings/b1/`]: listing(`${GRAN}buildings/b1/`, [
    `${GRAN}buildings/b1/energy/`,
  ]),
  [`${GRAN}buildings/b1/energy/`]: listing(`${GRAN}buildings/b1/energy/`, [
    `${GRAN}buildings/b1/energy/2024-06-03.ttl`,
  ]),
  // An existing but empty container (present, no ldp:contains children).
  [`${GRAN}empty/`]: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${GRAN}empty/> a ldp:Container, ldp:BasicContainer .
`,
};

/**
 * Read-only fixture tree + recorded DELETEs: the fixtures stay intact (the
 * walk re-lists containers), so DELETE is overridden to record and respond
 * (.acl probes 404 — none in fixtures; real resources 205) without mutating.
 */
function makeSession(): { session: Session; deletes: string[] } {
  const deletes: string[] = [];
  const pod = makeFakeSession({
    webId: WEBID,
    resources: FIXTURES,
    respond: (url, init) => {
      if ((init?.method ?? "GET").toUpperCase() !== "DELETE") return undefined;
      deletes.push(url);
      return new Response(null, { status: url.endsWith(".acl") ? 404 : 205 });
    },
  });
  return { session: pod.session, deletes };
}

Deno.test("deleteContainerRecursive descends and deletes the whole subtree", async () => {
  const { session, deletes } = makeSession();

  await deleteContainerRecursive(GRAN, session);

  // Every resource and container (ignoring best-effort .acl probes) is deleted.
  const real = deletes.filter((u) => !u.endsWith(".acl"));
  for (
    const expected of [
      `${GRAN}buildings/b1/energy/2024-06-03.ttl`,
      `${GRAN}buildings/b1/energy/`,
      `${GRAN}buildings/b1/`,
      `${GRAN}buildings/b1.ttl`,
      `${GRAN}buildings/`,
      `${GRAN}dataSources.ttl`,
      GRAN,
    ]
  ) {
    assert.ok(real.includes(expected), `expected DELETE of ${expected}`);
  }

  // A container is only deleted after its contents (depth-first).
  const at = (u: string) => real.indexOf(u);
  assert.ok(at(`${GRAN}buildings/b1/energy/2024-06-03.ttl`) < at(`${GRAN}buildings/b1/energy/`));
  assert.ok(at(`${GRAN}buildings/b1/energy/`) < at(`${GRAN}buildings/b1/`));
  assert.ok(at(`${GRAN}buildings/`) < at(GRAN));
});

Deno.test("deleteContainerRecursive deletes each resource before its .acl (no exposure window)", async () => {
  const { session, deletes } = makeSession();
  await deleteContainerRecursive(GRAN, session);

  // The resource DELETE must precede its .acl DELETE — deleting the .acl first
  // would briefly fall the resource back to the container's (possibly more
  // permissive) inherited ACL, a TOCTOU exposure.
  const file = `${GRAN}buildings/b1.ttl`;
  const fileIdx = deletes.indexOf(file);
  const aclIdx = deletes.indexOf(`${file}.acl`);
  assert.ok(fileIdx !== -1 && aclIdx !== -1, "both the file and its .acl deleted");
  assert.ok(fileIdx < aclIdx, "resource is deleted before its .acl");
});

Deno.test("deleteContainerRecursive recovers a 403 (locked) resource: drop .acl, then retry", async () => {
  // A leaf whose own .acl locked even the owner out: the first DELETE 403s; after
  // the .acl is removed (recovery) the retry succeeds. The .acl-first widening is
  // a last resort confined to an already-broken resource being destroyed anyway.
  const LOCKED = `${GRAN}locked.ttl`;
  const order: string[] = [];
  let aclGone = false;
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch: (input: string | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString())
        .split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "DELETE") {
        return Promise.resolve(
          url === GRAN
            ? new Response(listing(GRAN, [LOCKED]), {
              status: 200,
              headers: { "Content-Type": "text/turtle" },
            })
            : new Response("Not found", { status: 404 }),
        );
      }
      order.push(`DELETE ${url}`);
      if (url === `${LOCKED}.acl`) {
        aclGone = true;
        return Promise.resolve(new Response(null, { status: 205 }));
      }
      if (url === LOCKED) {
        return Promise.resolve(new Response(null, { status: aclGone ? 205 : 403 }));
      }
      // The container itself and its (absent) .acl.
      return Promise.resolve(
        new Response(null, { status: url.endsWith(".acl") ? 404 : 205 }),
      );
    },
  } as unknown as Session;

  await deleteContainerRecursive(GRAN, session);

  assert.deepEqual(
    order.slice(0, 3),
    [`DELETE ${LOCKED}`, `DELETE ${LOCKED}.acl`, `DELETE ${LOCKED}`],
    "403 → drop .acl → retry the resource delete",
  );
});

Deno.test("deleteContainerRecursive self-corrects an INCOMPLETE listing (no silent residue)", async () => {
  // Regression for the silent-residue bug: a stale container listing omitted a child
  // (`b.ttl`), so the walk skipped it, the non-empty container DELETE 409'd, and that
  // was swallowed into a false "clean" — leaving the building behind (seen on CSS and
  // JSS). The fix: a 409 on the container is ground truth that it is still non-empty,
  // so re-read and delete again. Here the FIRST listing of C/ hides `b.ttl`; C/ DELETE
  // returns 409 while any child remains; a re-read reveals `b.ttl`.
  const C = `${GRAN}c/`;
  const a = `${C}a.ttl`;
  const b = `${C}b.ttl`;
  const exists = new Set([a, b]); // server-side truth
  const deletes: string[] = [];
  let listGets = 0;
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch: (input: string | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE") {
        deletes.push(url);
        if (url.endsWith(".acl")) return Promise.resolve(new Response(null, { status: 404 }));
        if (url === C) {
          // The container can only be removed once empty; else 409 Conflict.
          const empty = !exists.has(a) && !exists.has(b);
          return Promise.resolve(new Response(null, { status: empty ? 205 : 409 }));
        }
        exists.delete(url);
        return Promise.resolve(new Response(null, { status: 205 }));
      }
      if (url === C) {
        // FIRST listing is stale and hides b.ttl; later reads tell the truth.
        const shown = listGets++ === 0
          ? [...exists].filter((u) => u !== b)
          : [...exists];
        return Promise.resolve(
          new Response(listing(C, shown), {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;

  await deleteContainerRecursive(C, session); // must NOT throw

  const real = deletes.filter((u) => !u.endsWith(".acl"));
  assert.ok(real.includes(a), "the listed child was deleted");
  assert.ok(real.includes(b), "the INITIALLY-HIDDEN child was deleted (no residue)");
  assert.ok(real.includes(C), "the container was deleted once truly empty");
  assert.ok(listGets >= 2, "re-read the listing after the 409 instead of trusting it");
});

Deno.test("deleteContainerRecursive throws (no false success) when a container can't be emptied", async () => {
  // A container that stays non-empty no matter what (a child the server refuses to
  // remove) must surface as a thrown error, never a silent clean — the property the
  // wipe verify relies on.
  const C = `${GRAN}stuck/`;
  const stuck = `${C}x.ttl`;
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch: (input: string | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE") {
        if (url.endsWith(".acl")) return Promise.resolve(new Response(null, { status: 404 }));
        // The child won't delete (409, e.g. server-locked) and so the container stays
        // non-empty and 409s too.
        return Promise.resolve(new Response(null, { status: 409 }));
      }
      if (url === C) {
        return Promise.resolve(
          new Response(listing(C, [stuck]), {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;

  await assert.rejects(() => deleteContainerRecursive(C, session));
});

Deno.test("deleteContainerRecursive never derives a .acl.acl (an .acl has no own ACL)", async () => {
  // Some servers (JSS) list `.acl` as an `ldp:contains` member, so the walk can be
  // handed an `.acl` to delete. It must NOT then issue `DELETE <uri>.acl.acl` — an
  // `.acl` has no ACL of its own; that nonexistent request is wasted and has stalled a
  // server's teardown. Container lists its own `.acl` as a child (JSS-style).
  const C = `${GRAN}j/`;
  const deletes: string[] = [];
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch: (input: string | URL, init?: RequestInit) => {
      const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "DELETE") {
        deletes.push(url);
        return Promise.resolve(new Response(null, { status: 205 }));
      }
      if (url === C) {
        return Promise.resolve(
          new Response(listing(C, [`${C}.acl`]), {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    },
  } as unknown as Session;

  await deleteContainerRecursive(C, session);

  assert.ok(deletes.includes(`${C}.acl`), "the listed .acl child was deleted");
  assert.ok(
    !deletes.some((u) => u.endsWith(".acl.acl")),
    "no .acl.acl was ever requested",
  );
});

Deno.test("deleteContainerRecursive tolerates a missing container", async () => {
  const { session, deletes } = makeSession();
  await deleteContainerRecursive(`${ROOT}does-not-exist/`, session);
  // 404 on the listing → early return, nothing deleted, no throw.
  assert.equal(deletes.filter((u) => !u.endsWith(".acl")).length, 0);
});

Deno.test("listDirectChildren returns immediate children only (non-recursive)", async () => {
  const { session } = makeSession();
  const children = await listDirectChildren(`${GRAN}buildings/`, session);
  assert.deepEqual((children ?? []).slice().sort(), [
    `${GRAN}buildings/b1.ttl`,
    `${GRAN}buildings/b1/`,
  ].sort());
  // It must NOT descend into b1/ (that's listContainedResources' job).
  assert.ok(!(children ?? []).includes(`${GRAN}buildings/b1/energy/`));
});

Deno.test("listDirectChildren distinguishes a missing container (null) from an empty one ([])", async () => {
  const { session } = makeSession();
  assert.equal(
    await listDirectChildren(`${ROOT}does-not-exist/`, session),
    null,
    "404 → null (fresh Pod; caller may seed)",
  );
  assert.deepEqual(
    await listDirectChildren(`${GRAN}empty/`, session),
    [],
    "present but empty → [] (do not seed)",
  );
});

Deno.test("listContainedResources returns the flat subtree, read-only", async () => {
  const { session, deletes } = makeSession();
  const found = await listContainedResources(GRAN, session);
  for (
    const expected of [
      `${GRAN}buildings/`,
      `${GRAN}buildings/b1.ttl`,
      `${GRAN}buildings/b1/`,
      `${GRAN}buildings/b1/energy/`,
      `${GRAN}buildings/b1/energy/2024-06-03.ttl`,
      `${GRAN}dataSources.ttl`,
    ]
  ) {
    assert.ok(found.includes(expected), `expected ${expected} in listing`);
  }
  assert.equal(deletes.length, 0, "listing must not delete anything");
});

Deno.test("formatResourceList shows paths relative to root and caps the list", () => {
  const urls = Array.from({ length: 25 }, (_, i) => `${GRAN}buildings/b${i}.ttl`);
  const out = formatResourceList(urls, ROOT, 20);
  assert.ok(out.includes("granergize/buildings/b0.ttl"), "relative path shown");
  assert.ok(!out.includes(ROOT), "absolute root stripped");
  assert.ok(out.includes("…and 5 more"), "overflow summarised");
  assert.equal(out.split("\n").length, 21, "20 lines + the summary");
});

Deno.test("deleteContainerRecursive does nothing when the signal is already aborted", async () => {
  const { session, deletes } = makeSession();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() =>
    deleteContainerRecursive(GRAN, session, controller.signal)
  );
  assert.equal(
    deletes.filter((u) => !u.endsWith(".acl")).length,
    0,
    "a pre-aborted signal deletes nothing",
  );
});

Deno.test("deleteContainerRecursive stops part-way once aborted mid-run", async () => {
  const { session, deletes } = makeSession();
  const controller = new AbortController();
  // Abort as soon as the first DELETE is dispatched, so the run can't finish.
  const inner = session.fetch.bind(session);
  (session as { fetch: typeof fetch }).fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const p = inner(input as string, init);
    if ((init?.method ?? "GET").toUpperCase() === "DELETE") controller.abort();
    return p;
  }) as typeof fetch;

  await assert.rejects(() =>
    deleteContainerRecursive(GRAN, session, controller.signal)
  );
  const real = deletes.filter((u) => !u.endsWith(".acl"));
  assert.ok(real.length >= 1, "some deletion happened before the abort");
  assert.ok(!real.includes(GRAN), "the top container was never reached");
});

Deno.test("removeAppData wipes granergize/ and never touches profile/", async () => {
  const { session, deletes } = makeSession();

  await removeAppData(session);

  assert.ok(deletes.includes(GRAN), "granergize/ container deleted");
  assert.ok(
    deletes.every((u) => !u.includes("/profile/")),
    "no profile/ resource was deleted",
  );
});
