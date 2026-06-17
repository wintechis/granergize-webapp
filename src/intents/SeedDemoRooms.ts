// Intent core (React-free) for SeedDemoRooms. See ./README.md. A dev-mode
// seeder: per-room best-effort (the service swallows per-room failures and
// returns the created set + the attempted total). The adapter's `patchRooms`
// folds the created `rooms` into the registry cache.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { seedDemoRooms } from "../services/demoConnect.ts";

/**
 * SeedDemoRooms outcome — a bespoke tally that also carries the created room
 * URIs the adapter's `patchRooms` needs (it adds them to `known` and sets the
 * last as `current`). The plain {@link import("./outcomes.ts").Tally} can't carry
 * the URIs, so this is the room-seed shape: `{ rooms, total }` (exactly what the
 * `onSuccess({ rooms })` patch consumes).
 */
export interface SeedDemoRoomsOutcome {
  /** The room URIs actually created (best-effort; may be fewer than `total`). */
  readonly rooms: string[];
  /** The number of rooms attempted. */
  readonly total: number;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSeedDemoRooms}:
 * seed the demo data rooms (per-room best-effort). Returns the created room set +
 * attempted total.
 */
export function seedDemoRoomsCore(gateway: PodGateway): Promise<SeedDemoRoomsOutcome> {
  return seedDemoRooms(gateway);
}
