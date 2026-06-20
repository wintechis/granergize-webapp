// Intent core (React-free) for CreateRoom. See ./README.md for the core/adapter
// split. The 6 cache-patching room cores return the normalized room URI the
// adapter's `patchRooms` race-guard folds into the `["rooms", webId]` cache.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { createRoom } from "../services/interop/dataRoom.ts";

/**
 * A room write's outcome: the normalized room URI the adapter's `patchRooms`
 * `setQueryData` race-guard folds into the registry cache. The cores return
 * EXACTLY this shape (the silent-break-mode: a mismatch corrupts the cache with
 * no Tier-1 catching it — the query cache is browser-only).
 */
export interface RoomOutcome {
  /** The normalized canonical room URI the core acted on. */
  readonly room: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useCreateRoom}:
 * create a new data room and return its (already-normalized) URI. The adapter's
 * `patchRooms` adds it to `known` and sets it `current`.
 */
export interface CreateRoomParams {
  /** Optional human name for the room (written as its `rdfs:label`). */
  readonly name?: string;
}

export async function createRoomCore(
  gateway: PodGateway,
  params: CreateRoomParams,
): Promise<RoomOutcome> {
  return { room: await createRoom(gateway, params.name) };
}
