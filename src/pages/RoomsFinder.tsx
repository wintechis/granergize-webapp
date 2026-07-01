import { useEffect, useState } from "react";
import IconAction from "../components/IconAction.tsx";
import { getGateway } from "../hooks/session.ts";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { ownsRoom } from "../services/interop/dataRoom.ts";
import { roomRoute } from "../routes.ts";
import { useTrailState } from "../hooks/navTrail.ts";
import { useRoomNames, useRoomState } from "../hooks/queries.ts";
import { queryKeys } from "../lib/queryKeys.ts";
import {
  useAddRoom,
  useCreateRoom,
  useDeleteRoom,
  useRemoveBookmark,
} from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { RefLink } from "../components/detail/DetailView.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { msg } from "../lib/messages.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import FinderHeader from "../components/FinderHeader.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import SearchField from "../components/SearchField.tsx";
import { filterByText } from "../lib/textSearch.ts";
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
  const trailState = useTrailState();

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
  // Name for a room you're about to host (its rdfs:label); shared so every member
  // sees it instead of the raw URI.
  const [roomNameInput, setRoomNameInput] = useState("");
  // Whether the QR scanner (one camera view) is open: a scanned code adds a data
  // room by invite link.
  const [scanning, setScanning] = useState(false);
  // All known rooms in their natural order; if the active room isn't bookmarked,
  // it is shown first so it's never hidden.
  const rooms = activeRoom && !knownRooms.includes(activeRoom)
    ? [activeRoom, ...knownRooms]
    : knownRooms;
  // Each room's human name, for the row title (falls back to the URI when unnamed).
  const roomNames = useRoomNames(rooms).data ?? {};
  const { query, setQuery } = useListSearch();
  const filteredRooms = filterByText(
    rooms,
    query,
    (r) => `${roomNames[r] ?? ""} ${r} ${roomHost(r)}`,
  );
  const roomPaging = usePaging(filteredRooms);

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
    create.mutate(roomNameInput.trim() || undefined, {
      onSuccess: ({ room }) => {
        setRoomNameInput("");
        showNotification(msg("roomCreated"), "success");
        // Land on the new room's page (it enters there on mount), recording the
        // rooms finder as the back trail.
        void navigate(roomRoute(room), { state: trailState(roomRoute(room)) });
      },
    });

  /** Delete a room you own (destroys it for everyone), then drop the bookmark. */
  const handleDeleteRoom = async (room: string) => {
    if (
      !await confirm({
        title: msg("dlgDeleteRoom"),
        message: msg("roomDeleteConfirm"),
        confirmLabel: msg("btnDelete"),
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
    ownsRoom(r, getGateway())
      ? (
        <IconAction
  label={t("roomDeleteTooltip")}
  icon={<DeleteIcon fontSize="small" />}
  color="error"
  disabled={busy}
  onClick={() => handleDeleteRoom(r)}
/>
      )
      : (
        <IconAction
  label={t("roomRemoveTooltip")}
  icon={<DeleteIcon fontSize="small" />}
  color="error"
  disabled={busy}
  onClick={() => handleRemoveBookmark(r)}
/>
      );

  /** The "Hosted by …" / "active" sub-line shared by every room row (rendered as
   * ResourceRow's caption subtitle). */
  const roomMeta = (r: string) => (
    <>
      {ownsRoom(r, getGateway())
        ? t("roomHostedByYou")
        : t("roomHostedBy", { host: roomHost(r) })}
      {r === activeRoom && (
        <>
          {" · "}
          <strong style={{ color: "inherit" }}>{t("roomActive")}</strong>
        </>
      )}
    </>
  );

  const hasRooms = activeRoom !== null || knownRooms.length > 0;

  return (
    <FinderHeader
      title={t("headingYourRooms")}
      count={rooms.length}
      source={rdf?.bookmarks}
      inputs={
        // Both ways of getting a room into the list: host a new (named) one, or
        // add someone else's by URI / QR.
        <>
          <TextField
            size="small"
            label={t("roomNameLabel")}
            value={roomNameInput}
            onChange={(e) => setRoomNameInput(e.target.value)}
            sx={{ minWidth: 200 }}
          />
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreate}
            disabled={busy}
          >
            {create.isPending ? t("roomHosting") : t("roomHostBtn")}
          </Button>
          <TextField
            size="small"
            label={t("roomUriLabel")}
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            sx={{ minWidth: 320 }}
          />
          <Button
            variant="outlined"
            disabled={!roomInput.trim() || busy}
            onClick={() => handleAdd(roomInput)}
          >
            {add.isPending ? t("addingEllipsis") : t("btnAdd")}
          </Button>
          {/* Opener only — the scanner's own Cancel button (right under the
              camera view) is the one way to close it. */}
          <Button
            variant="outlined"
            onClick={() => setScanning(true)}
            disabled={scanning}
          >
            {t("scanQrCode")}
          </Button>
        </>
      }
      controls={hasRooms && (
        <SearchField value={query} onChange={setQuery} />
      )}
    >
      {scanning && (
        <QrScanner
          onResult={handleRoomScan}
          onCancel={() => setScanning(false)}
        />
      )}
      {roomQuery.isLoading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : !hasRooms
        ? (
          <Typography variant="body2">
            {t("roomsEmpty")}
          </Typography>
        )
        : filteredRooms.length === 0
        ? (
          <Typography variant="body2">
            {t("searchNoMatches", { query })}
          </Typography>
        )
        : (
          <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
            {roomPaging.pageItems.map((r) => (
              <ResourceRow
                key={r}
                title={
                  <Box component="span" sx={{ wordBreak: "break-all" }}>
                    <RefLink to={roomRoute(r)}>
                      <strong>{roomNames[r] ?? r}</strong>
                    </RefLink>
                  </Box>
                }
                subtitle={roomMeta(r)}
                actions={deleteOrRemove(r)}
              />
            ))}
          </Box>
        )}
      <Pager paging={roomPaging} />
    </FinderHeader>
  );
}
