// Intent core (React-free) for AddRoom. See ./README.md and ./CreateRoom.ts. The
// existence (`roomExists`) throw stays IN the core.
import type { PodGateway } from "../services/pod/podGateway.ts";
import {
  addKnownRoom,
  extractRoomUri,
  normalizeRoomUri,
  roomExists,
} from "../services/interop/dataRoom.ts";
import type { RoomOutcome } from "./CreateRoom.ts";

/** Parameters of the AddRoom intent. */
export interface AddRoomParams {
  /** A raw room URI or invite link to bookmark (NOT necessarily an IRI). */
  input: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useAddRoom}: bookmark
 * a room URI (raw or invite link) without entering it. Throws (in the core) if
 * the room does not exist; otherwise returns the normalized URI the adapter's
 * `patchRooms` adds to `known`.
 */
export async function addRoomCore(
  gateway: PodGateway,
  params: AddRoomParams,
): Promise<RoomOutcome> {
  const room = extractRoomUri(params.input);
  if (!(await roomExists(room, gateway))) {
    throw new Error("Data room is not reachable");
  }
  await addKnownRoom(room, gateway);
  return { room: normalizeRoomUri(room) };
}
