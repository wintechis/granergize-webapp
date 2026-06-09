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

interface Call {
  url: string;
  method: string;
}

function makeSession(): { session: Session; deletes: string[]; calls: Call[] } {
  const deletes: string[] = [];
  const calls: Call[] = [];
  const fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    if (method === "DELETE") {
      deletes.push(url);
      // .acl probes 404 (none in fixtures); real resources 205.
      return Promise.resolve(new Response(null, { status: url.endsWith(".acl") ? 404 : 205 }));
    }
    const body = FIXTURES[url];
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
    deletes,
    calls,
  };
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
