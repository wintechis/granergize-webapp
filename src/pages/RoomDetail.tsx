import { sessionGateway } from "../services/pod/podGateway.ts";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Box, Button, Chip, Divider, Stack, Typography } from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import { normalizeRoomUri, ownsRoom } from "../services/interop/dataRoom.ts";
import { queryKeys, useRoomState } from "../hooks/queries.ts";
import { useDeleteRoom, useEnterRoom, useExitRoom } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { msg } from "../lib/messages.ts";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { backTarget, FINDERS, type NavState } from "../routes.ts";
import { BackLink, RdfSourceLink } from "../components/detail/DetailView.tsx";
import RoomInviteSection from "../components/room/RoomInviteSection.tsx";
import RoomRolesSection from "../components/room/RoomRolesSection.tsx";
import RoomMembersSection from "../components/room/RoomMembersSection.tsx";
import { logError } from "../lib/logError.ts";

/** Host of a room URI, for the "Hosted by …" badge (the Pod that owns the room). */
function roomHost(roomUri: string): string {
  try {
    return new URL(roomUri).host;
  } catch (err) {
    logError("parse room URI for host label", err);
    return roomUri;
  }
}

/**
 * The ROOM PAGE — a standalone master-detail page for one data room, on the same
 * pattern as the building page. The route param is the (URL-encoded) room URI;
 * this is what the room QR code / invite link points at.
 *
 * On mount the page ENTERS the room via {@link useEnterRoom} (idempotent: validate
 * → join → enter → bookmark → make current, the same mutation the Connect tab
 * uses), so simply *navigating* to a room enters it — the page is the active-room
 * surface. Going through the mutation (not the raw service `openRoom`) is what
 * patches the React Query room registry, so `useRoomState().current` flips to
 * this room and its members/roles fold loads. The page never redirects; it
 * renders detail in place.
 */
export default function RoomDetail(
  { roomUri, session }: { roomUri: string; session: Session },
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  // Back/leave = the newest location on the navigation trail (Connect, a member
  // list, …) carried in history state, falling back to the rooms finder for a deep
  // link / invite link — see backTarget.
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    const trail = (location.state as NavState | null)?.trail ?? [];
    const rest = trail.slice(0, -1);
    void navigate(backTarget(trail, FINDERS.rooms), {
      state: rest.length ? { trail: rest } : undefined,
    });
  };

  const room = normalizeRoomUri(roomUri);
  const owned = ownsRoom(room, sessionGateway(session));

  // Enter (join + bookmark + make current) on mount — preserves invite links.
  // useEnterRoom patches the registry cache, so `current` updates and the room
  // log fold runs. Guard against re-entering the same room on every render (and
  // React 18 StrictMode's double-invoke) with a ref keyed on the room IRI.
  const enter = useEnterRoom();
  const exit = useExitRoom();
  const enteredRef = useRef<string | null>(null);
  useEffect(() => {
    if (enteredRef.current === room) return;
    enteredRef.current = room;
    enter.mutate(room, {
      onError: () => showNotification(msg("roomUnreachable"), "error"),
    });
    // enter/showNotification are stable; room identifies the room to enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // The room log is CROSS-AGENT state: a peer's join/role change is appended by
  // THEM into the room container, so no local write invalidates it — and the global
  // policy is refetch-on-invalidation only (refetchOnMount: false). Opening this page
  // is the user's "look" at the membership (the pull topology: readers fold the
  // container when they look), so it triggers the one refetch — once per open, mirroring
  // ShareAggregationDialog / RoomsFinder. Without it, a peer who joined while you were
  // elsewhere never appears until some unrelated room mutation invalidates the log.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.roomLog });
  }, [qc]);

  const roomQuery = useRoomState();
  const current = roomQuery.data?.current ?? null;
  // Members/roles are only meaningful for THIS room once it's the current one;
  // until openRoom lands they belong to whatever room was current before.
  const isCurrent = current === room;
  const members = isCurrent ? roomQuery.data?.members ?? [] : [];
  const serverRoles = isCurrent ? roomQuery.data?.myRoles ?? [] : [];
  const isMember = isCurrent && (roomQuery.data?.myMembership ?? false);

  const del = useDeleteRoom();
  const busy = roomQuery.isFetching || enter.isPending || exit.isPending ||
    del.isPending;

  const handleLeave = () =>
    exit.mutate(room, {
      onSuccess: () => {
        showNotification(msg("roomLeft"), "success");
        goBack();
      },
    });

  const handleDelete = async () => {
    if (
      !await confirm({
        title: msg("dlgDeleteRoom"),
        message: msg("roomDeleteConfirm"),
        confirmLabel: msg("btnDelete"),
      })
    ) return;
    del.mutate(room, {
      onSuccess: () => {
        showNotification(msg("roomDeleted"), "success");
        goBack();
      },
    });
  };

  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      {/* Header: back link, the room URI, and a host badge. */}
      <Box>
        <BackLink fallback={FINDERS.rooms} />
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}
        >
          <Typography variant="h5" sx={{ wordBreak: "break-all" }}>
            {room}
          </Typography>
          <Chip
            size="small"
            label={owned ? msg("roomHostedByYou") : msg("roomHostedBy", { host: roomHost(room) })}
            color={owned ? "primary" : "default"}
          />
        </Stack>
        <RdfSourceLink href={room} />
      </Box>

      <RoomInviteSection roomUri={room} />

      {isMember && (
        <RoomRolesSection
          roomUri={room}
          serverRoles={serverRoles}
          busy={busy}
        />
      )}

      <RoomMembersSection members={members} />

      {/* Footer actions: leave (always), delete (owned only). */}
      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          onClick={handleLeave}
          disabled={busy}
        >
          {exit.isPending ? msg("roomLeaving") : msg("roomLeaveBtn")}
        </Button>
        {owned && (
          <Button
            variant="outlined"
            color="error"
            onClick={handleDelete}
            disabled={busy}
          >
            {del.isPending ? "Deleting…" : "Delete data room"}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
