/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { deleteContainerRecursive } from "./podDelete.ts";

// Reproduces the "Remove all app data" stall (jss issue
// delete-acl-of-acl-hangs-tier3): the per-container mapPooled cap bounds
// concurrency PER LEVEL, but deleteContainerRecursive recurses INSIDE its own
// pool, so a nested tree multiplies — peak in-flight ≈ pool^depth, not pool.
// In a browser (≈6 connections/host) that flood of simultaneous fetch()
// queues behind the connection limit and an unlucky request sits `pending`
// past the test budget. The bound must be GLOBAL across the whole walk.

const WEBID = "https://pod.example/profile/card#me";
const ROOT = "https://pod.example/";

/** Turtle container listing declaring `children` via ldp:contains. */
function listing(container: string, children: string[]): string {
  const refs = children.map((c) => `<${c}>`).join(", ");
  return `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${container}> a ldp:Container, ldp:BasicContainer${refs ? " ;\n  ldp:contains " + refs : ""} .
`;
}

/**
 * Build a fixture tree `branch` containers wide and `depth` containers deep,
 * each leaf container holding `leaves` files. With branch=leaves=4, depth=3
 * the per-level cap of 8 leaves ~4^3 = 64 simultaneous leaf deletes >> 8.
 */
function buildTree(branch: number, depth: number, leaves: number) {
  const fixtures: Record<string, string[]> = {};
  const base = `${ROOT}granergize/`;
  const walk = (container: string, level: number) => {
    if (level === depth) {
      // leaf container: holds files only
      fixtures[container] = Array.from({ length: leaves }, (_, i) => `${container}f${i}.ttl`);
      return;
    }
    const kids = Array.from({ length: branch }, (_, i) => `${container}c${i}/`);
    fixtures[container] = kids;
    for (const k of kids) walk(k, level + 1);
  };
  walk(base, 0);
  return { base, fixtures };
}

/**
 * A fake session that tracks the number of fetch() calls in flight at once,
 * with a real async gap (a timer) so overlapping calls genuinely overlap.
 * Returns the recorded peak.
 */
function trackingSession(fixtures: Record<string, string[]>) {
  let inFlight = 0;
  let peak = 0;
  const session = {
    info: { webId: WEBID, isLoggedIn: true },
    fetch: async (input: string | URL, init?: RequestInit) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 5)); // hold the "socket" briefly
        const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "DELETE") {
          return new Response(null, { status: url.endsWith(".acl") ? 404 : 205 });
        }
        if (fixtures[url]) {
          return new Response(listing(url, fixtures[url]), {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          });
        }
        return new Response("Not found", { status: 404 });
      } finally {
        inFlight--;
      }
    },
  } as unknown as Session;
  return { session, peak: () => peak };
}

Deno.test("deleteContainerRecursive bounds GLOBAL concurrency across recursion depth", async () => {
  const { base, fixtures } = buildTree(4, 3, 4);
  const { session, peak } = trackingSession(fixtures);

  await deleteContainerRecursive(base, session);

  // The whole walk must never have more than DELETE_CONCURRENCY (8) requests
  // in flight at once, no matter how deep/wide the tree. A small slack (≤ a
  // couple) tolerates the listing-vs-delete handoff, but a per-level cap
  // multiplied by depth lands in the dozens — that is the bug.
  assert.ok(
    peak() <= 10,
    `peak in-flight fetches was ${peak()} — concurrency is not globally bounded ` +
      `(per-level cap multiplies with recursion depth; flood queues behind the ` +
      `browser's ~6-connection-per-host limit and stalls "Remove all app data")`,
  );
});
