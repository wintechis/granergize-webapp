/// <reference lib="deno.ns" />
/**
 * Playwright-managed local CSS for Tier 3 (E2E_LOCAL=1). Boots a throwaway CSS via
 * startLocalCss() (the same one the headless tier uses) and keeps it up for the
 * run. Also runs a tiny control server on LOCAL_CSS_CONTROL_PORT whose `POST /reset`
 * RESTARTS CSS from scratch — giving each spec pristine, freshly-seeded pods so
 * specs never share mutable pod state. `login()` hits it once per spec file (see
 * helpers/login.ts).
 *
 * Shutdown is owned by Playwright's lifecycle: its `globalTeardown`
 * (`test/e2e-local/globalTeardown.ts`) hits `POST /stop`, which does the orderly
 * `css.stop()` and exits. (A SIGTERM/SIGINT handler does the same, as a fallback
 * for a manual kill.) The CSS is spawned under `setsid`, so it only dies via this
 * explicit stop — not by a kill of this process's tree — which is why a clean
 * stop has to go through here. It blocks forever in between.
 */
import { type LocalPod, startLocalPod } from "../headless/localPod.ts";
import { LOCAL_CSS_CONTROL_PORT, LOCAL_CSS_PORT } from "../config/localSeed.ts";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  appRoot,
  podResources,
  resolveStorageRoot,
} from "../../src/services/pod/solidUtils.ts";
import { createRoom } from "../../src/services/interop/dataRoom.ts";
import { drainInbox, ensureOwnInbox } from "../../src/services/interop/inbox.ts";
import { deleteContainerRecursive } from "../../src/services/pod/podDelete.ts";
import {
  type BenchActor,
  lastAnnualYears,
  SEED_ANNUAL_YEARS,
  seedBuildings,
  seedRoomMembers,
  setupShareRoom,
  shareBuildingsViaRoom,
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
 * Kill whatever still holds `port`. An orphaned CSS from a lost stop/boot race
 * never releases the socket on its own — observed 2026-06-09 in a full run: one
 * per-spec `/reset` lost the race, the orphan kept 3456, and EVERY later boot
 * attempt failed for the remaining ~25 specs. Waiting alone can't recover from
 * that; killing the holder can. TERM first, escalate to KILL.
 */
async function killPortHolder(port: number): Promise<void> {
  for (const sig of ["-TERM", "-KILL"] as const) {
    try {
      const out = await new Deno.Command("fuser", {
        args: [sig, `${port}/tcp`],
        stdout: "null",
        stderr: "null",
      }).output();
      if (!out.success) return; // nothing holds the port
      console.error(`killed orphaned holder of :${port} (${sig})`);
    } catch {
      return; // fuser unavailable — fall back to the plain port wait
    }
    await new Promise((r) => setTimeout(r, 500));
    try {
      Deno.listen({ hostname: "127.0.0.1", port }).close();
      return; // freed
    } catch {
      // still held — escalate to the next signal
    }
  }
}

/**
 * Boot CSS robustly: wait for the port to be free, then start — retrying a couple
 * times if we lose the tiny TOCTOU window between the probe and CSS's own bind.
 * From the second attempt on, forcibly free the port first: a holder that
 * survived a full waitForPortFree deadline is an orphan that will never leave.
 * This is what makes the per-spec `/reset` reliable instead of a coin-flip.
 */
async function bootCss(): Promise<LocalPod> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await killPortHolder(LOCAL_CSS_PORT);
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

// One live actor session per slot for the multi-actor seeding below. Disposed by
// the caller; storage root pre-resolved so the data-layer path builders work.
async function actorSession(
  slot: "A" | "B" | "C",
): Promise<{ live: Awaited<ReturnType<LocalPod["liveSession"]>>; actor: BenchActor }> {
  const live = await css.liveSession(slot);
  const session = live as unknown as Session;
  await resolveStorageRoot(session);
  return { live, actor: { webId: css[slot].webId, session } };
}

// Seed the PAIR substrate for the Tier-3 share-render / login-settle /
// series-render BENCHMARKS: B owns N buildings — each carrying the seeded
// annual-data baseline (2020–2025, or the most recent `years` of it), the FIRST
// optionally a PT15M series of `seriesDays` daily files — ALL shared with A via
// a data room, energy included (the Tier-2 D3 scenario). Both actors' app
// collections are wiped first so each size starts clean (stale shared-in grants
// from a previous size would otherwise be pruned during A's timed load and
// distort it). `drained` archives A's inbox into shared-in/ up front
// (steady-state recipient); undrained leaves the N notifications for the app's
// login/reload drain (the first-visit cost the spec times).
async function seedSharedPair(
  n: number,
  drained: boolean,
  years: number,
  seriesDays: number,
): Promise<void> {
  const [a, b] = await Promise.all([actorSession("A"), actorSession("B")]);
  try {
    await Promise.all([
      deleteContainerRecursive(appRoot(a.actor.webId), a.actor.session).catch(() => {}),
      deleteContainerRecursive(appRoot(b.actor.webId), b.actor.session).catch(() => {}),
    ]);
    await ensureOwnInbox(a.actor.session);
    const seeded = await seedBuildings(
      b.actor.session,
      b.actor.webId,
      n,
      "bench",
      lastAnnualYears(years),
      seriesDays,
    );
    const room = await setupShareRoom(a.actor, b.actor);
    await shareBuildingsViaRoom(b.actor, room, seeded);
    if (drained) await drainInbox(a.actor.session);
  } finally {
    await a.live.dispose().catch(() => {});
    await b.live.dispose().catch(() => {});
  }
}

// Seed the TRIO substrate for the Tier-3 view-roundtrip BENCHMARK: B and C each
// own N buildings carrying the annual-data baseline (2020–2025), all shared
// (energy included) to A via a pair room each, and A's inbox drained — so A's
// browser can build a benchmark view over the 2N contributed buildings and
// share it back.
async function seedContribTrio(n: number): Promise<void> {
  const [a, b, c] = await Promise.all([
    actorSession("A"),
    actorSession("B"),
    actorSession("C"),
  ]);
  try {
    await Promise.all(
      [a, b, c].map((x) =>
        deleteContainerRecursive(appRoot(x.actor.webId), x.actor.session).catch(() => {})
      ),
    );
    // Re-provision EVERY actor's inbox: the wipe took them, and the share-back
    // (A → B, C) posts each grant to the recipient's inbox — in the real flow
    // they'd exist because each actor logged in once (ensureOwnInbox at login).
    await Promise.all([a, b, c].map((x) => ensureOwnInbox(x.actor.session)));
    for (const [contributor, prefix] of [[b, "bench-b"], [c, "bench-c"]] as const) {
      const seeded = await seedBuildings(
        contributor.actor.session,
        contributor.actor.webId,
        n,
        prefix,
      );
      const room = await setupShareRoom(a.actor, contributor.actor);
      await shareBuildingsViaRoom(contributor.actor, room, seeded);
    }
    await drainInbox(a.actor.session);
  } finally {
    for (const x of [a, b, c]) await x.live.dispose().catch(() => {});
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
  if (req.method === "POST" && pathname === "/seed-shared") {
    const n = Number(searchParams.get("n") ?? "0");
    const drained = searchParams.get("drained") !== "0";
    // Energy-depth knobs: `years=K` keeps the most recent K of the 2020–2025
    // annual baseline (default: all); `seriesDays=D` puts a PT15M series of D
    // daily files on the first building (default: none).
    const years = Number(searchParams.get("years") ?? `${SEED_ANNUAL_YEARS.length}`);
    const seriesDays = Number(searchParams.get("seriesDays") ?? "0");
    try {
      await seedSharedPair(
        Number.isFinite(n) && n >= 0 ? n : 0,
        drained,
        Number.isFinite(years) && years >= 0 ? years : SEED_ANNUAL_YEARS.length,
        Number.isFinite(seriesDays) && seriesDays >= 0 ? seriesDays : 0,
      );
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed-shared failed: ${e}`);
      return new Response(`seed-shared failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/seed-contrib") {
    const n = Number(searchParams.get("n") ?? "0");
    try {
      await seedContribTrio(Number.isFinite(n) && n >= 0 ? n : 0);
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed-contrib failed: ${e}`);
      return new Response(`seed-contrib failed: ${e}\n`, { status: 500 });
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
  if (req.method === "POST" && pathname === "/stop") {
    // Playwright's globalTeardown calls this at the end of a run so the test
    // lifecycle owns the shutdown. Stop CSS fully (`css.stop()` kills the
    // setsid-detached server group), reply so the caller's fetch resolves, then
    // exit — `stopping` keeps watchExit from treating it as a crash.
    if (!stopping) {
      stopping = true;
      await css.stop();
    }
    setTimeout(() => Deno.exit(0), 50);
    return new Response("stopped\n");
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
