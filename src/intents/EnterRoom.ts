// Intent core (React-free) for EnterRoom. See ./README.md and ./CreateRoom.ts
// (`RoomOutcome`). The reachability throw stays IN the core.
import type { Session } from "@inrupt/solid-client-authn-browser";
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
  session: Session,
  params: EnterRoomParams,
): Promise<RoomOutcome> {
  if (!(await openRoom(params.roomUri, session))) {
    throw new Error("Data room is not reachable");
  }
  return { room: normalizeRoomUri(extractRoomUri(params.roomUri)) };
}
