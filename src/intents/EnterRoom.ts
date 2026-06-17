// Intent core (React-free) for EnterRoom. See ./README.md and ./CreateRoom.ts
// (`RoomOutcome`). The reachability throw stays IN the core.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { extractRoomUri, normalizeRoomUri, openRoom } from "../services/interop/dataRoom.ts";
import type { RoomOutcome } from "./CreateRoom.ts";

/** Parameters of the EnterRoom intent. */
export interface EnterRoomParams {
  /** A room URI or invite link to join. */
  roomUri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useEnterRoom}:
 * enter (join) a room — leaving whatever room you were in. Throws (in the core)
 * if the room is not reachable; otherwise returns the normalized URI the
 * adapter's `patchRooms` adds to `known` and sets `current`.
 */
export async function enterRoomCore(
  gateway: PodGateway,
  params: EnterRoomParams,
): Promise<RoomOutcome> {
  if (!(await openRoom(params.roomUri, gateway))) {
    throw new Error("Data room is not reachable");
  }
  return { room: normalizeRoomUri(extractRoomUri(params.roomUri)) };
}
