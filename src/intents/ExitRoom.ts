// Intent core (React-free) for ExitRoom. See ./README.md and ./CreateRoom.ts.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { exitRoom, normalizeRoomUri } from "../services/interop/dataRoom.ts";
import type { RoomOutcome } from "./CreateRoom.ts";

/** Parameters of the ExitRoom intent. */
export interface ExitRoomParams {
  /** The room URI to leave. */
  roomUri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useExitRoom}: leave
 * a room. Returns the normalized URI; the adapter's `patchRooms` clears
 * `current` if it matched.
 */
export async function exitRoomCore(
  session: Session,
  params: ExitRoomParams,
): Promise<RoomOutcome> {
  await exitRoom(params.roomUri, session);
  return { room: normalizeRoomUri(params.roomUri) };
}
