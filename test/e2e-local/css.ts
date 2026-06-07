/// <reference lib="deno.ns" />
/**
 * Playwright-managed local CSS for Tier 3 (E2E_LOCAL=1). Boots a throwaway CSS via
 * startLocalCss() (the same one the headless tier uses) and keeps it up for the
 * run. Also runs a tiny control server on LOCAL_CSS_CONTROL_PORT whose `POST /reset`
 * RESTARTS CSS from scratch — giving each spec pristine, freshly-seeded pods so
 * specs never share mutable pod state. `login()` hits it once per spec file (see
 * helpers/login.ts).
 *
 * Playwright's `webServer` runs this command and sends SIGTERM on teardown; the
 * signal handler does the orderly stop(). It blocks forever in between.
 */
import { type LocalPod, startLocalPod } from "../headless/localPod.ts";
import { LOCAL_CSS_CONTROL_PORT, LOCAL_CSS_PORT } from "../config/localSeed.ts";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { podResources, resolveStorageRoot } from "../../src/services/utils/solidUtils.ts";
import { createRoom } from "../../src/services/interop/dataRoom.ts";
import {
  seedBuildings,
  seedRoomMembers,
  wipeBuildings,
  wipeRooms,
} from "../bench/seed.ts";

/**
 * Resolve once `port` is actually bindable again — i.e. the previous CSS has fully
 * released its socket. A blind `setTimeout` is a guess: under full-suite load the
 * old node can still hold the port past it, so the next CSS fails to bind and exits
 * code 1 (then startLocalCss burns its 60s readiness poll before throwing). Probing
 * with a throwaway listen is precise. Bind 127.0.0.1: while CSS holds 0.0.0.0:port
 * this still fails with AddrInUse, so a success genuinely means free.
 */
async function waitForPortFree(port: number, deadlineMs = 10_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      Deno.listen({ hostname: "127.0.0.1", port }).close();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/**
 * Boot CSS robustly: wait for the port to be free, then start — retrying a couple
 * times if we lose the tiny TOCTOU window between the probe and CSS's own bind.
 * This is what makes the per-spec `/reset` reliable instead of a coin-flip.
 */
async function bootCss(): Promise<LocalPod> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await waitForPortFree(LOCAL_CSS_PORT);
    try {
      return await startLocalPod(LOCAL_CSS_PORT);
    } catch (e) {
      lastErr = e;
      console.error(`CSS boot attempt ${attempt}/3 failed: ${e}`);
    }
  }
  throw lastErr;
}

let css = await bootCss();
console.log(`local CSS up at ${css.baseUrl} (A=${css.A.webId}, B=${css.B.webId})`);

let stopping = false;
let restarting = false;

// Fail-fast: if CSS exits on its own (crash/hang-kill) — NOT our restart/stop —
// abort with a non-zero code instead of leaving a dead server that every spec
// times out against.
function watchExit(c: LocalPod) {
  c.status.then((s) => {
    if (stopping || restarting) return;
    console.error(`local CSS exited unexpectedly (code ${s.code}) — aborting the run`);
    Deno.exit(1);
  });
}
watchExit(css);

// Seed N buildings into account A's pod for the Tier-3 render BENCHMARK
// (manage-render.spec.ts). Done here, in Deno, because the data layer pulls in
// Deno-only deps (npm:jose in liveSession, the npm import map) that don't load
// under Playwright's Node loader — so the spec drives this over HTTP instead. A
// fresh client-credentials session is minted per call so it can't go stale across
// a /reset. Replaces whatever buildings/ held (wipe then seed) → exactly N.
async function seedPodA(n: number): Promise<void> {
  const live = await css.liveSession("A");
  try {
    const session = live as unknown as Session;
    await resolveStorageRoot(session);
    await wipeBuildings(session, css.A.webId);
    await seedBuildings(session, css.A.webId, n);
  } finally {
    await live.dispose().catch(() => {});
  }
}

// Seed a data ROOM with N members into account A's pod for the Tier-3 room-render
// BENCHMARK (room-render.spec.ts). Like seedPodA, this runs in Deno (the data
// layer needs Deno-only deps). It resets A's room state, hosts ONE fresh room
// (createRoom auto-joins A and makes it A's active room, so the Connect tab
// auto-expands it on load), then seeds N synthetic members into the room's log.
// The browser then times how long the member list takes to render.
async function seedRoomPodA(n: number): Promise<void> {
  const live = await css.liveSession("A");
  try {
    const session = live as unknown as Session;
    await resolveStorageRoot(session);
    // Reset room state so each size starts from exactly one room: drop prior rooms
    // and the bookmarks/current-room pointer (stale bookmarks would otherwise pile
    // up across sizes and could push the active room off the list's first page).
    await wipeRooms(session, css.A.webId);
    const res = podResources(css.A.webId);
    await session.fetch(res.bookmarks, { method: "DELETE" }).catch(() => {});
    await session.fetch(res.prefs, { method: "DELETE" }).catch(() => {});
    const room = await createRoom(session); // A auto-joins; becomes A's active room
    await seedRoomMembers(session, room, n);
  } finally {
    await live.dispose().catch(() => {});
  }
}

// Control server (separate port): POST /reset restarts CSS and replies once the
// fresh instance is ready, so the caller can await a clean slate.
Deno.serve({ port: LOCAL_CSS_CONTROL_PORT }, async (req) => {
  const { pathname, searchParams } = new URL(req.url);
  if (req.method === "POST" && pathname === "/seed") {
    const n = Number(searchParams.get("n") ?? "0");
    try {
      await seedPodA(Number.isFinite(n) && n >= 0 ? n : 0);
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed failed: ${e}`);
      return new Response(`seed failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/seed-room") {
    const n = Number(searchParams.get("n") ?? "0");
    try {
      await seedRoomPodA(Number.isFinite(n) && n >= 0 ? n : 0);
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed-room failed: ${e}`);
      return new Response(`seed-room failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/reset") {
    restarting = true;
    await css.stop();
    try {
      css = await bootCss(); // waits for port release + retries; no blind delay
    } catch (e) {
      restarting = false;
      console.error(`/reset failed to reboot CSS: ${e}`);
      return new Response("reset failed\n", { status: 500 });
    }
    restarting = false;
    watchExit(css);
    return new Response("ok\n");
  }
  // Any GET is a health check. Playwright's webServer waits on this — and the
  // control server only starts listening AFTER the first startLocalCss() resolves
  // (CSS booted + seeded), so a 200 here guarantees CSS is ready too.
  return new Response("ok\n");
});

const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await css.stop();
  Deno.exit(0);
};
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  Deno.addSignalListener(sig, shutdown);
}

await new Promise(() => {}); // block until Playwright stops the webServer
