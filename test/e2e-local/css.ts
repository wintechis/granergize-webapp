/// <reference lib="deno.ns" />
/**
 * Playwright-managed local CSS for Tier 3 (E2E_LOCAL=1). Boots a throwaway CSS via
 * startLocalCss() (the same one the headless tier uses) and keeps it up for the
 * run. Also runs a tiny control server on LOCAL_CSS_CONTROL_PORT giving each spec a
 * pristine, freshly-seeded pod so specs never share mutable pod state — via one of
 * two operations the caller chooses (`login()` hits one once per spec file, see
 * helpers/login.ts): `POST /restart` RESTARTS the pod server from scratch (safe,
 * slow, the default), `POST /wipe` deletes each app collection in place + restores
 * the WebID profile (fast, CSS only — see the two handlers below).
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
import {
  deleteContainerRecursive,
  listDirectChildren,
} from "../../src/services/pod/podDelete.ts";
import {
  type BenchActor,
  lastAnnualYears,
  SEED_ANNUAL_YEARS,
  seedBuildings,
  seedProfile,
  seedRoomMembers,
  setupShareRoom,
  shareBuildingsViaRoom,
  wipeBuildings,
  wipeRooms,
} from "../bench/seed.ts";
import { shareBuildingData } from "../../src/services/interop/share.ts";
import { createViewDefinition } from "../../src/services/aggregation/viewManager.ts";
import {
  computeAndStoreSnapshot,
  summarizeContributors,
} from "../../src/services/aggregation/viewComputer.ts";
import { getSharedWithMe } from "../../src/services/interop/sharingManager.ts";
import { CONSUMPTION_METRIC_KEYS } from "../../src/constants/annualMetrics.ts";

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
 * per-spec `/restart` lost the race, the orphan kept 3456, and EVERY later boot
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
 * This is what makes the per-spec `/restart` reliable instead of a coin-flip.
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

// Boot-time snapshot of each account's PRISTINE WebID profile document, keyed by
// slot. A per-spec `/wipe` restores these after wiping the pod: the app mutates
// the profile OUTSIDE the granergize/ tree (`saveOrganization` writes org fields
// into the WebID card), so a data-only wipe would leak an org edit into the next
// spec — a full CSS restart reset the profile for free, so the in-place wipe must
// too. Captured once after boot; the accounts and their data dir live for the
// whole run (and are re-snapshotted if the restart fallback ever fires).
const pristineProfiles = new Map<
  "A" | "B" | "C",
  { cardDoc: string; body: string; contentType: string }
>();

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

// Capture each account's pristine WebID profile so a per-spec `/wipe` can restore
// it in place after the pod wipe (see `pristineProfiles`/`resetToPristine`). Done
// once at boot, before any spec runs.
await snapshotProfiles();

// GET each account's WebID card document and stash its body + content-type, so
// `resetToPristine` can PUT it back verbatim. The card doc is the WebID minus its
// fragment. Throws on a non-OK read — a missing pristine profile would silently
// turn `/wipe` into a data-only wipe (no profile restore).
async function snapshotProfiles(): Promise<void> {
  for (const slot of ["A", "B", "C"] as const) {
    const { live, actor } = await actorSession(slot);
    try {
      const cardDoc = actor.webId.split("#")[0];
      const r = await actor.session.fetch(cardDoc);
      if (!r.ok) throw new Error(`profile snapshot ${cardDoc} → HTTP ${r.status}`);
      pristineProfiles.set(slot, {
        cardDoc,
        body: await r.text(),
        contentType: r.headers.get("content-type") ?? "text/turtle",
      });
    } finally {
      await live.dispose().catch(() => {});
    }
  }
}

// Per-spec clean slate WITHOUT a CSS restart: for each of A/B/C wipe the whole
// granergize/ app collection — returning the pod to its freshly-booted state,
// which the app re-provisions (inbox, ACLs, prefs) at login — then restore the
// WebID profile to its boot snapshot (undoing any org edit). All three run in
// parallel. Throws if any account can't reach a clean slate (wipeAppData verifies
// emptiness and retries); the caller falls back to a full restart on throw.
async function resetToPristine(): Promise<void> {
  await Promise.all((["A", "B", "C"] as const).map(async (slot) => {
    const { live, actor } = await actorSession(slot);
    try {
      await wipeAppData(actor);
      const snap = pristineProfiles.get(slot);
      if (snap) {
        const r = await actor.session.fetch(snap.cardDoc, {
          method: "PUT",
          headers: { "content-type": snap.contentType },
          body: snap.body,
        });
        if (!r.ok) throw new Error(`profile restore ${snap.cardDoc} → HTTP ${r.status}`);
      }
    } finally {
      await live.dispose().catch(() => {});
    }
  }));
}

// Seed N buildings into account A's pod for the Tier-3 render BENCHMARK
// (manage-render.spec.ts). Done here, in Deno, because the data layer pulls in
// Deno-only deps (npm:jose in liveSession, the npm import map) that don't load
// under Playwright's Node loader — so the spec drives this over HTTP instead. A
// fresh client-credentials session is minted per call so it can't go stale across
// a /restart. Replaces whatever buildings/ held (wipe then seed) → exactly N.
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

// Wipe an actor's whole app collection, VERIFIED: recursive deletes under a
// write-heavy tree have been observed to leave residue (a later seed found 5
// stale events past the wipe), so confirm the container is actually gone and
// retry a couple of times — a benchmark substrate must start exactly empty.
async function wipeAppData(x: BenchActor): Promise<void> {
  const root = appRoot(x.webId);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await deleteContainerRecursive(root, x.session).catch(() => {});
    const left = await listDirectChildren(root, x.session);
    if (left === null || left.length === 0) return;
    console.error(`wipe ${root}: ${left.length} children left after attempt ${attempt}`);
  }
  throw new Error(`wipe ${root}: residue remains after 3 attempts`);
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
// login/reload drain (the first-visit cost the spec times). Returns the series
// building's SUBJECT IRI (when `seriesDays` made one), so the series-render
// spec can deep-link it verbatim — identity is the IRI, never reconstructed.
async function seedSharedPair(
  n: number,
  drained: boolean,
  years: number,
  seriesDays: number,
): Promise<{ seriesSubject: string | null }> {
  const [a, b] = await Promise.all([actorSession("A"), actorSession("B")]);
  try {
    await Promise.all([wipeAppData(a.actor), wipeAppData(b.actor)]);
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
    // Verify the substrate before letting the spec time anything against it —
    // a silent seeding shortfall (observed: stale JSS listings after wipes, see
    // ../../javascript-solid-server/jss-open-suspects.md) must fail HERE, not
    // as a mysterious browser-side timeout.
    const log = drained ? "shared-in" : "inbox";
    const children =
      await listDirectChildren(`${appRoot(a.actor.webId)}${log}/`, a.actor.session) ?? [];
    const events = children.filter((c) => !c.endsWith(".acl"));
    if (events.length !== n) {
      throw new Error(`post-seed verify: ${log}/ holds ${events.length} events, want ${n}`);
    }
    if (n > 0) {
      const b0 = await a.actor.session.fetch(seeded[0].uri);
      if (!b0.ok) {
        throw new Error(`post-seed verify: ${seeded[0].uri} → HTTP ${b0.status} for A`);
      }
    }
    return {
      seriesSubject: seriesDays > 0 && seeded.length > 0
        ? seeded[0].subjectUri
        : null,
    };
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
    await Promise.all([a, b, c].map((x) => wipeAppData(x.actor)));
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

// Human + company identities for the three seeded actors: a `foaf:name` +
// public avatar on each WebID profile, plus an organisation (`<#org>` node with
// name/homepage/logo) — so the handbuch screenshots show recognisable people
// AND firms (the map's producer-logo marker resolves the org logo from a
// building's `attributedTo`). Names follow the A=Alice / B=Bob / C=Charlie role
// model; the invented companies carry a real-estate ring matching each role
// (A Logistikerin — a USER of her own halls, B Bestandshalter, C
// Benchmark-Dienstleister). Fixture paths are relative to the repo root (the
// webServer's cwd).
const PROFILE_SEED: Record<
  "A" | "B" | "C",
  {
    name: string;
    avatar: string;
    org: { name: string; homepage: string; logo: string };
  }
> = {
  A: {
    name: "Alice Ahlmann",
    avatar: "test/e2e/fixtures/alice-avatar.png",
    org: {
      name: "Ahlmann Logistik",
      homepage: "https://ahlmann-logistik.example/",
      logo: "test/e2e/fixtures/ahlmann-logistik-logo.svg",
    },
  },
  B: {
    name: "Bob Bauer",
    avatar: "test/e2e/fixtures/bob-avatar.png",
    org: {
      name: "Bauer Grundbesitz",
      homepage: "https://bauer-grundbesitz.example/",
      logo: "test/e2e/fixtures/bauer-grundbesitz-logo.svg",
    },
  },
  C: {
    name: "Charlie Conrad",
    avatar: "test/e2e/fixtures/charlie-avatar.png",
    org: {
      name: "Conrad Kennwert",
      homepage: "https://conrad-kennwert.example/",
      logo: "test/e2e/fixtures/conrad-kennwert-logo.svg",
    },
  },
};

// Seed all three actor profiles; returns slot → WebID so the caller can use the
// REAL WebIDs (e.g. as a contact entry) instead of constructing them.
async function seedProfiles(): Promise<Record<string, string>> {
  const webIds: Record<string, string> = {};
  for (const slot of ["A", "B", "C"] as const) {
    const { live, actor } = await actorSession(slot);
    try {
      const seed = PROFILE_SEED[slot];
      const bytes = await Deno.readFile(seed.avatar);
      const logoBytes = await Deno.readFile(seed.org.logo);
      await seedProfile(actor, seed.name, { bytes, mime: "image/png" }, {
        name: seed.org.name,
        homepage: seed.org.homepage,
        logo: { bytes: logoBytes, mime: "image/svg+xml" },
      });
      webIds[slot] = actor.webId;
    } finally {
      await live.dispose().catch(() => {});
    }
  }
  return webIds;
}

// The BSP contribution + computation seeded over the pods' CURRENT contents
// (no wipe — the screenshots spec calls this after the demo buildings exist):
// A's owned buildings plus two seeded B buildings are shared (energy included)
// to C, the benchmark service provider, who folds the shared-with-me roster
// into a benchmark view and computes the snapshot. The share-BACK is NOT
// seeded: the screenshots spec performs it through C's real share dialog (the
// "Add all contributors" figure) — which also keeps that button enabled here.
async function seedBenchmark(viewName: string): Promise<void> {
  const [a, b, c] = await Promise.all([
    actorSession("A"),
    actorSession("B"),
    actorSession("C"),
  ]);
  try {
    // B and C never logged in at this point, so their inboxes don't exist yet.
    await Promise.all([a, b, c].map((x) => ensureOwnInbox(x.actor.session)));
    const children = await listDirectChildren(
      `${appRoot(a.actor.webId)}buildings/`,
      a.actor.session,
    ) ?? [];
    const aBuildings = children.filter((u) => u.endsWith(".ttl"));
    if (aBuildings.length === 0) {
      throw new Error("seed-benchmark: A owns no buildings to contribute");
    }
    const bSeeded = await seedBuildings(b.actor.session, b.actor.webId, 2, "contrib");
    for (const uri of aBuildings) {
      await shareBuildingData(uri, c.actor.webId, a.actor.session, {
        includeEnergyData: true,
      });
    }
    for (const s of bSeeded) {
      await shareBuildingData(s.uri, c.actor.webId, b.actor.session, {
        includeEnergyData: true,
      });
    }
    await drainInbox(c.actor.session);
    const { buildingUris } = summarizeContributors(
      await getSharedWithMe(c.actor.session),
    );
    if (buildingUris.length === 0) {
      throw new Error("seed-benchmark: C's contributor roster is empty");
    }
    const view = await createViewDefinition(
      c.actor.session,
      viewName,
      buildingUris,
      "average",
      CONSUMPTION_METRIC_KEYS,
      { benchmark: true },
    );
    await computeAndStoreSnapshot(c.actor.session, view.id);
  } finally {
    for (const x of [a, b, c]) await x.live.dispose().catch(() => {});
  }
}

// Control server (separate port): the per-spec clean-slate ops are POST /restart
// (boot a fresh server) and POST /wipe (in-place) — each replies once the pod is
// ready, so the caller can await a clean slate. Plus the /seed* and /stop ops.
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
      const out = await seedSharedPair(
        Number.isFinite(n) && n >= 0 ? n : 0,
        drained,
        Number.isFinite(years) && years >= 0 ? years : SEED_ANNUAL_YEARS.length,
        Number.isFinite(seriesDays) && seriesDays >= 0 ? seriesDays : 0,
      );
      // JSON body: callers that only check res.ok are unaffected; the
      // series-render spec reads `seriesSubject` to deep-link the series
      // building by its subject IRI.
      return Response.json(out);
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
  // Seed N owned buildings (annual baseline, attributed to the actor) for ONE
  // slot — e.g. B's own surroundings in the two-actor walkthrough video,
  // without dragging in the benchmark roundtrip that `/seed-benchmark` seeds.
  if (req.method === "POST" && pathname === "/seed-actor-buildings") {
    const slotParam = (searchParams.get("slot") ?? "B").toUpperCase();
    const n = Number(searchParams.get("n") ?? "2");
    if (!["A", "B", "C"].includes(slotParam)) {
      return new Response(`unknown slot ${slotParam}\n`, { status: 400 });
    }
    const slot = slotParam as "A" | "B" | "C";
    try {
      const x = await actorSession(slot);
      try {
        await seedBuildings(
          x.actor.session,
          x.actor.webId,
          Number.isFinite(n) && n >= 0 ? n : 2,
          `own-${slot.toLowerCase()}`,
        );
      } finally {
        await x.live.dispose().catch(() => {});
      }
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed-actor-buildings failed: ${e}`);
      return new Response(`seed-actor-buildings failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/seed-profiles") {
    try {
      return Response.json(await seedProfiles());
    } catch (e) {
      console.error(`/seed-profiles failed: ${e}`);
      return new Response(`seed-profiles failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/seed-benchmark") {
    const name = searchParams.get("name") ?? "Energie-Benchmark";
    try {
      await seedBenchmark(name);
      return new Response("ok\n");
    } catch (e) {
      console.error(`/seed-benchmark failed: ${e}`);
      return new Response(`seed-benchmark failed: ${e}\n`, { status: 500 });
    }
  }
  // Per-spec clean slate, split into two EXPLICIT operations so the caller picks
  // the tradeoff (see `resetLocalPodsOnce` in helpers/login.ts) rather than the
  // server guessing:
  //   /restart — the safe, slow default. Stop the pod server and boot a fresh one
  //              with a fresh data dir → genuinely empty pods, no container listing
  //              involved. The only reliable reset on JSS, whose post-write
  //              container listings go stale and defeat an in-place delete (see
  //              ../../javascript-solid-server/issues/stale-container-listing-
  //              after-writes-defeats-recursive-delete-tier3.md).
  //   /wipe    — the fast path. Delete each account's app collection in place and
  //              restore the WebID profile, against the running server — no process
  //              bounce, no port wait, no re-seed. ~Free on a warm CSS; NOT safe on
  //              JSS. No fallback: a wipe that can't reach a clean slate returns 500
  //              so the caller sees it, instead of a silent restart masking a bug.
  if (req.method === "POST" && pathname === "/wipe") {
    try {
      await resetToPristine();
      return new Response("ok\n");
    } catch (e) {
      console.error(`/wipe failed to reach a clean slate: ${e}`);
      return new Response(`wipe failed: ${e}\n`, { status: 500 });
    }
  }
  if (req.method === "POST" && pathname === "/restart") {
    restarting = true;
    await css.stop();
    try {
      css = await bootCss(); // waits for port release + retries; no blind delay
    } catch (e) {
      restarting = false;
      console.error(`/restart failed to reboot the pod server: ${e}`);
      return new Response("restart failed\n", { status: 500 });
    }
    restarting = false;
    watchExit(css);
    // Fresh data dir + re-seeded accounts → re-capture the pristine profiles so a
    // later /wipe restores the right baseline.
    await snapshotProfiles().catch((e) =>
      console.error(`/restart re-snapshot failed: ${e}`)
    );
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
