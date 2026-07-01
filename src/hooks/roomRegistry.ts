/**
 * The room-registry cache discipline, shared by the TWO surfaces that fire a
 * room verb: the per-intent mutation hooks (`mutations.ts` §Data room
 * mutations) and the ⌘K palette's direct invoke (`invokeIntent.ts`).
 *
 * The registry (`["rooms", webId]` — current + known) is OWNED by these folds:
 * each successful verb patches the cache authoritatively via `setQueryData`
 * and the registry is NEVER invalidated/refetched, because a slow or stale
 * conditional read-back can revert a room switch (diagnosed on
 * solidcommunity.net — see `queries.ts` useRooms + project memory). Keeping
 * the per-verb folds in ONE table means the hook adapters and the palette
 * cannot drift in what a verb does to the registry.
 */
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys.ts";
import { getGateway } from "./session.ts";

export interface RoomRegistry {
  known: string[];
  current: string | null;
}

const withRoom = (known: string[], room: string) =>
  known.includes(room) ? known : [...known, room];

type Fold = (reg: RoomRegistry) => RoomRegistry;

/**
 * The registry patch each room verb implies, keyed by intent name and fed the
 * verb's invoke result (every room core returns the canonical room URI it
 * acted on — `{ room }`, or `{ rooms }` for the bulk seeder). The return shape
 * MUST match what each fold consumes (the silent break-mode — the query cache
 * is browser-only, so Tier-1 can't catch a mismatch).
 */
export const ROOM_REGISTRY_FOLDS = {
  CreateRoom: ({ room }: { room: string }): Fold => (reg) => ({
    known: withRoom(reg.known, room),
    current: room,
  }),
  EnterRoom: ({ room }: { room: string }): Fold => (reg) => ({
    known: withRoom(reg.known, room),
    current: room,
  }),
  SeedDemoRooms: ({ rooms }: { rooms: string[] }): Fold => (reg) => ({
    known: rooms.reduce(withRoom, reg.known),
    current: rooms[rooms.length - 1] ?? reg.current,
  }),
  ExitRoom: ({ room }: { room: string }): Fold => (reg) => ({
    ...reg,
    current: reg.current === room ? null : reg.current,
  }),
  DeleteRoom: ({ room }: { room: string }): Fold => (reg) => ({
    known: reg.known.filter((r) => r !== room),
    current: reg.current === room ? null : reg.current,
  }),
  AddBookmark: ({ room }: { room: string }): Fold => (reg) => ({
    ...reg,
    known: withRoom(reg.known, room),
  }),
  RemoveBookmark: ({ room }: { room: string }): Fold => (reg) => ({
    known: reg.known.filter((r) => r !== room),
    current: reg.current === room ? null : reg.current,
  }),
} as const;

/** Patch the logged-in user's room-registry cache (no-op until it's loaded). */
export function patchRooms(qc: QueryClient, fold: Fold): void {
  const webId = getGateway().webId;
  qc.setQueryData<RoomRegistry>(
    [...queryKeys.rooms, webId],
    (old) => old ? fold(old) : old,
  );
}

/**
 * The palette's cache settlement after a successful `invokeByName`: apply the
 * verb's registry fold (exactly what its hook adapter's `onSuccess` would do),
 * then blanket-invalidate everything EXCEPT the registry — the palette
 * bypasses the hooks that own their invalidations, and these run rarely (a
 * manual ⌘K action, not a hot path), but the registry must not be refetched
 * (the revert hazard above; `staleTime: Infinity` does not protect an active
 * query from an explicit invalidation).
 */
export async function settlePaletteInvoke(
  qc: QueryClient,
  name: string,
  result: unknown,
): Promise<void> {
  // The result is typed per verb at the hook call sites; the palette dispatches
  // by name, so the lookup is necessarily untyped here — the fold table itself
  // declares what shape each verb's core returns.
  const fold = (ROOM_REGISTRY_FOLDS as Record<
    string,
    ((result: unknown) => Fold) | undefined
  >)[name];
  if (fold) patchRooms(qc, fold(result));
  await qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] !== queryKeys.rooms[0],
  });
}
