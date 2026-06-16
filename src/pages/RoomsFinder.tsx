import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { ownsRoom } from "../services/interop/dataRoom.ts";
import { roomRoute } from "../routes.ts";
import { queryKeys, useRoomState } from "../hooks/queries.ts";
import {
  useAddRoom,
  useCreateRoom,
  useDeleteRoom,
  useRemoveBookmark,
} from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { RdfSourceLink, RefLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { msg } from "../lib/messages.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import QrScanner from "../components/QrScanner.tsx";
import { logError } from "../lib/logError.ts";

/** Host of a room URI, for "Hosted by …" labels (the Pod that owns the room). */
function roomHost(roomUri: string): string {
  try {
    return new URL(roomUri).host;
  } catch (err) {
    logError("parse room URI for host label", err);
    return roomUri;
  }
}

interface RoomsFinderProps {
  session: Session;
}

/**
 * The Rooms finder (`/rooms`): a finder for data rooms — it lists the rooms you
 * know (host or have bookmarked) and lets you host / add / remove them. The
 * per-room detail (QR/invite, roles, members, enter/leave) lives on the
 * standalone room page (`/room/:uri`); each row navigates there (entering the
 * room on the page's mount). Room state comes from ONE React Query
 * (`useRoomState`). Split out of the former Connect page (rooms + contacts).
 */
export default function RoomsFinder({ session }: RoomsFinderProps) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  const roomQuery = useRoomState();
  const t = useT();
  // The room log is CROSS-AGENT state: another member's join is appended by THEM
  // into the room container, so no local write ever invalidates it, and the
  // global policy is refetch-on-invalidation only (refetchOnMount: false).
  // Navigating to /rooms remounts this finder, so opening it is the user's "look"
  // at the membership and triggers the one refetch — the same discipline
  // ShareAggregationDialog applies on open. Without this a peer who joined your
  // active room never shows up here until some unrelated room mutation happens to
  // invalidate the log.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.roomLog });
  }, [qc]);
  const activeRoom = roomQuery.data?.current ?? null;
  const knownRooms = roomQuery.data?.known ?? [];

  const [roomInput, setRoomInput] = useState("");
  // Whether the QR scanner (one camera view) is open: a scanned code adds a data
  // room by invite link.
  const [scanning, setScanning] = useState(false);
  // All known rooms in their natural order; if the active room isn't bookmarked,
  // it is shown first so it's never hidden.
  const rooms = activeRoom && !knownRooms.includes(activeRoom)
    ? [activeRoom, ...knownRooms]
    : knownRooms;
  const roomPaging = usePaging(rooms);

  const create = useCreateRoom();
  const del = useDeleteRoom();
  const add = useAddRoom();
  const remove = useRemoveBookmark();
  const mutations = [create, del, add, remove];
  // Disable actions while any write is in flight or the resulting re-read runs.
  const busy = roomQuery.isFetching || mutations.some((m) => m.isPending);

  const ok = (text: string) => () => showNotification(text, "success");

  const handleAdd = (input: string) =>
    add.mutate(input, {
      onSuccess: () => {
        setRoomInput("");
        showNotification(msg("roomAdded"), "success");
      },
    });

  const handleRemoveBookmark = (room: string) =>
    remove.mutate(room, { onSuccess: ok(msg("removedFromList")) });

  const handleCreate = () =>
    create.mutate(undefined, {
      onSuccess: (room) => {
        showNotification(msg("roomCreated"), "success");
        // Land on the new room's page (it enters there on mount).
        void navigate(roomRoute(room));
      },
    });

  /** Delete a room you own (destroys it for everyone), then drop the bookmark. */
  const handleDeleteRoom = async (room: string) => {
    if (
      !await confirm({
        title: "Delete data room",
        message:
          "Delete this data room for everyone? This removes the data room and its " +
          "entire membership and role history. This cannot be undone.",
        confirmLabel: "Delete",
      })
    ) {
      return;
    }
    del.mutate(room, { onSuccess: ok(msg("roomDeleted")) });
  };

  const handleRoomScan = (text: string) => {
    setScanning(false);
    handleAdd(text); // scanning adds the room to your list; click it to enter
  };

  // Backing RDF resource (the room bookmarks), linked so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  // The trailing destructive action for a room row: delete it (if you own it,
  // for everyone) or just drop the bookmark (if someone else hosts it).
  const deleteOrRemove = (r: string) =>
    ownsRoom(r, session)
      ? (
        <Tooltip title="Delete data room (for everyone)">
          <IconButton
            size="small"
            color="error"
            aria-label="Delete data room"
            onClick={() => handleDeleteRoom(r)}
            disabled={busy}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )
      : (
        <Tooltip title="Remove from your list">
          <IconButton
            size="small"
            color="error"
            aria-label="Remove data room"
            onClick={() => handleRemoveBookmark(r)}
            disabled={busy}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      );

  /** The "Hosted by …" / "active" sub-line shared by every room row (rendered as
   * ResourceRow's caption subtitle). */
  const roomMeta = (r: string) => (
    <>
      {ownsRoom(r, session) ? "Hosted by you" : `Hosted by ${roomHost(r)}`}
      {r === activeRoom && (
        <>
          {" · "}
          <strong style={{ color: "inherit" }}>active</strong>
        </>
      )}
    </>
  );

  const hasRooms = activeRoom !== null || knownRooms.length > 0;

  return (
    <Box component="section" sx={{ p: 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      {/* Your data rooms — one ordered list mixing rooms you host and rooms
          others host. The toolbar above it holds both ways of getting a room
          into the list: host a new one, or add someone else's by URI / QR.
          Each row opens the room's detail page (`/room/:uri`, where entering,
          roles, members and the invite QR live); the trailing action is delete
          (owned) or remove-from-list. */}
      <Typography variant="h6" sx={{ mb: 1 }}>Your data rooms</Typography>
      {rdf && <RdfSourceLink href={rdf.bookmarks} />}
      <Stack
        direction="row"
        spacing={1}
        sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
      >
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={handleCreate}
          disabled={busy}
        >
          {create.isPending ? "Creating…" : "Host a data room"}
        </Button>
        <TextField
          size="small"
          label="Data room URI"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          sx={{ minWidth: 320 }}
        />
        <Button
          variant="outlined"
          disabled={!roomInput.trim() || busy}
          onClick={() => handleAdd(roomInput)}
        >
          {add.isPending ? "Adding…" : "Add"}
        </Button>
        {/* Opener only — the scanner's own Cancel button (right under the
            camera view) is the one way to close it. */}
        <Button
          variant="outlined"
          onClick={() => setScanning(true)}
          disabled={scanning}
        >
          Scan QR code
        </Button>
      </Stack>
      {scanning && (
        <QrScanner
          onResult={handleRoomScan}
          onCancel={() => setScanning(false)}
        />
      )}
      {roomQuery.isLoading
        ? <Typography variant="body2">Loading…</Typography>
        : !hasRooms
        ? (
          <Typography variant="body2">
            {t("roomsEmpty")}
          </Typography>
        )
        : (
          <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {roomPaging.pageItems.map((r) => (
              <ResourceRow
                key={r}
                title={
                  <Box component="span" sx={{ wordBreak: "break-all" }}>
                    <RefLink to={roomRoute(r)}>{r}</RefLink>
                  </Box>
                }
                subtitle={roomMeta(r)}
                actions={deleteOrRemove(r)}
              />
            ))}
          </Box>
        )}
      <Pager paging={roomPaging} />
    </Box>
  );
}
