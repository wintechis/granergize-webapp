// Intent core (React-free) for SaveRoles. See ./README.md. Plain write — no
// cache patch; the adapter keeps the `roomLog` invalidation (roles live in the
// room's log, not the registry).
import type { PodGateway } from "../services/pod/podGateway.ts";
import { setMyRole } from "../services/interop/dataRoom.ts";
import type { UserRole } from "../types.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SaveRoles intent. */
export interface SaveRolesParams {
  /** The room whose membership roles are being self-assigned. */
  room: string;
  /** The data-room membership roles to self-assign. */
  roles: UserRole[];
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSaveRoles}:
 * self-assign your data-room membership roles (an event on the room's log). The
 * adapter keeps the `roomLog` invalidation.
 */
export async function saveRolesCore(
  gateway: PodGateway,
  params: SaveRolesParams,
): Promise<Settled> {
  await setMyRole(params.room, params.roles, gateway);
  return { ok: true };
}
