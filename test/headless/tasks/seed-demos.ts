/// <reference lib="deno.ns" />
/**
 * Catalog task `seed-demos` (headless): the dev-mode demo seeders run the way the
 * Account-menu drives them when a developer clicks the item — `seedDemoAgents`
 * and `seedDemoRooms` BOTH IN FLIGHT AT ONCE (one click fires both). The browser
 * e2e (`seed-demos.spec.ts`) can't deterministically provoke the user-reported
 * "Added {n} of {total}" partial on a fast clean Pod, so this hunts it directly
 * against the local CSS, with full ETag enforcement and no browser/Cloudflare
 * noise.
 *
 * Each iteration fires both seeders concurrently and asserts every one returns
 * its FULL tally (`seeded === total`, `rooms.length === total`). Set
 * `SEED_DEMOS_ITERS` to repeat the burst and surface intermittency (default 3).
 *
 * (Example BUILDINGS are no longer seeded programmatically — they arrive through
 * the file importer, whose parse contract is unit-covered by
 * `scripts/genExampleFiles.test.ts` and whose write path is covered by the
 * `add-building` task and the `excel-import` e2e.)
 *
 * The two seeders write disjoint resources — `demo-agents/` + `agents.ttl`, and
 * `rooms/` + `bookmarks.ttl`/`prefs.ttl` — so the only deterministic contention
 * they share is concurrent CONTAINER creation under `appRoot`; a partial here
 * would pin that (or a real per-write fragility) rather than a transient remote
 * blip.
 *
 * Self-cleaning: A's `prefs.ttl`/`bookmarks.ttl`/`agents.ttl` are snapshotted and
 * restored, and the `demo-agents/` and `rooms/` containers (which accumulate
 * across iterations — `seedDemoRooms` is not idempotent) are deleted.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { appRoot, podResources } from "../../../src/services/pod/solidUtils.ts";
import { deleteContainerRecursive } from "../../../src/services/pod/podDelete.ts";
import {
  DEMO_AGENT_NAMES,
  DEMO_ROOM_COUNT,
  seedDemoAgents,
  seedDemoRooms,
} from "../../../src/services/demoConnect.ts";

export const name = "seed-demos";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const res = podResources(a.webId);
  const iters = Number(Deno.env.get("SEED_DEMOS_ITERS") ?? "3");

  const prefsSnap = await snapshot(a.raw, res.prefs);
  const bookmarksSnap = await snapshot(a.raw, res.bookmarks);
  const contactsSnap = await snapshot(a.raw, res.contacts);

  try {
    for (let i = 1; i <= iters; i++) {
      // Fire both at once — the concurrent burst the menu triggers.
      const [contacts, rooms] = await Promise.all([
        seedDemoAgents(a.session),
        seedDemoRooms(a.session),
      ]);

      check(
        `iter ${i}/${iters}: all ${DEMO_AGENT_NAMES.length} demo contacts seeded concurrently`,
        contacts.seeded === contacts.total,
        `seeded ${contacts.seeded}/${contacts.total}`,
      );
      check(
        `iter ${i}/${iters}: all ${DEMO_ROOM_COUNT} demo data rooms seeded concurrently`,
        rooms.rooms.length === rooms.total,
        `created ${rooms.rooms.length}/${rooms.total}`,
      );
    }
  } finally {
    const root = appRoot(a.webId);
    await deleteContainerRecursive(`${root}demo-agents/`, a.session).catch(() => {});
    await deleteContainerRecursive(`${root}rooms/`, a.session).catch(() => {});
    await restore(a.raw, res.prefs, prefsSnap);
    await restore(a.raw, res.bookmarks, bookmarksSnap);
    await restore(a.raw, res.contacts, contactsSnap);
  }
}
