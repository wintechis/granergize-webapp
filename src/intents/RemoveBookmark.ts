// Intent core (React-free) for RemoveBookmark. See ./README.md and ./CreateRoom.ts.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { normalizeRoomUri, removeKnownRoom } from "../services/interop/dataRoom.ts";
import type { RoomOutcome } from "./CreateRoom.ts";

/** Parameters of the RemoveBookmark intent. */
export interface RemoveBookmarkParams {
  /** The room URI to drop from the bookmark list (does not delete the room). */
  roomUri: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRemoveBookmark}:
 * remove a room from your bookmark list (does not delete the room itself).
 * Returns the normalized URI; the adapter's `patchRooms` removes it from `known`
 * and clears `current` if it matched.
 */
export async function removeBookmarkCore(
  gateway: PodGateway,
  params: RemoveBookmarkParams,
): Promise<RoomOutcome> {
  await removeKnownRoom(params.roomUri, gateway);
  return { room: normalizeRoomUri(params.roomUri) };
}
