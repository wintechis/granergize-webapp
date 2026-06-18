/// <reference lib="deno.ns" />
/**
 * Catalog task `seed-demos` (headless): the dev-mode demo seeders run the way the
 * Account-menu drives them when a developer clicks the two items in quick
 * succession — `seedDemoBuildings`, `seedDemoContacts` and `seedDemoRooms` all
 * IN FLIGHT AT ONCE. The browser e2e (`seed-demos.spec.ts`) can't deterministically
 * provoke the user-reported "Added {n} of {total}" partial on a fast clean Pod, so
 * this hunts it directly against the local CSS, with full ETag enforcement and no
 * browser/Cloudflare noise.
 *
 * Each iteration fires the three seeders concurrently and asserts every one
 * returns its FULL tally (`seeded === total`, `rooms.length === total`). Set
 * `SEED_DEMOS_ITERS` to repeat the burst and surface intermittency (default 3).
 *
 * The three seeders write disjoint resources — buildings under `buildings/`,
 * `demo-contacts/` + `contacts.ttl`, and `rooms/` + `bookmarks.ttl`/`prefs.ttl` —
 * so the only deterministic contention they could share is concurrent CONTAINER
 * creation under `appRoot`; a partial here would pin that (or a real per-write
 * fragility) rather than a transient remote blip.
 *
 * Self-cleaning: A's `prefs.ttl`/`bookmarks.ttl`/`contacts.ttl` are snapshotted and
 * restored, and the `buildings/`, `demo-contacts/` and `rooms/` containers (which
 * accumulate across iterations — `seedDemoRooms` is not idempotent) are deleted.
 */
import { restore, snapshot, type TaskContext } from "../taskContext.ts";
import { appRoot, podResources } from "../../../src/services/pod/solidUtils.ts";
import { deleteContainerRecursive } from "../../../src/services/pod/podDelete.ts";
import { seedDemoBuildings } from "../../../src/services/rdf/building/buildingSerializer.ts";
import {
  DEMO_CONTACT_NAMES,
  DEMO_ROOM_COUNT,
  seedDemoContacts,
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
      // Fire all three at once — the concurrent burst the menu triggers.
      const [buildings, contacts, rooms] = await Promise.all([
        seedDemoBuildings(a.session, a.webId),
        seedDemoContacts(a.session),
        seedDemoRooms(a.session),
      ]);

      check(
        `iter ${i}/${iters}: all demo buildings seeded concurrently`,
        buildings.seeded === buildings.total,
        `seeded ${buildings.seeded}/${buildings.total}`,
      );
      check(
        `iter ${i}/${iters}: all ${DEMO_CONTACT_NAMES.length} demo contacts seeded concurrently`,
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
    await deleteContainerRecursive(res.buildings, a.session).catch(() => {});
    await deleteContainerRecursive(`${root}demo-contacts/`, a.session).catch(() => {});
    await deleteContainerRecursive(`${root}rooms/`, a.session).catch(() => {});
    await restore(a.raw, res.prefs, prefsSnap);
    await restore(a.raw, res.bookmarks, bookmarksSnap);
    await restore(a.raw, res.contacts, contactsSnap);
  }
}
