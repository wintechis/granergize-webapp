// Intent core (React-free) for DeleteRoom. See ./README.md and ./CreateRoom.ts.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { deleteRoom, normalizeRoomUri, removeKnownRoom } from "../services/interop/dataRoom.ts";
import type { RoomOutcome } from "./CreateRoom.ts";

/** Parameters of the DeleteRoom intent. */
export interface DeleteRoomParams {
  /** The room URI to delete (for everyone) and drop the bookmark of. */
  roomUri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeleteRoom}:
 * delete a room you own (for everyone), then drop the bookmark. Returns the
 * normalized URI; the adapter's `patchRooms` removes it from `known` and clears
 * `current` if it matched.
 */
export async function deleteRoomCore(
  session: Session,
  params: DeleteRoomParams,
): Promise<RoomOutcome> {
  await deleteRoom(params.roomUri, session);
  await removeKnownRoom(params.roomUri, session);
  return { room: normalizeRoomUri(params.roomUri) };
}
