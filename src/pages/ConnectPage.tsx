import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import LoginIcon from "@mui/icons-material/Login";
import { QRCodeSVG } from "qrcode.react";
import { Session } from "@inrupt/solid-client-authn-browser";
import { ownsRoom } from "../services/interop/dataRoom.ts";
import type { UserRole } from "../../types/types.ts";
import { ROLE_LABELS, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";
import { useRoomState } from "../hooks/queries.ts";
import {
  useAddRoom,
  useCreateRoom,
  useDeleteRoom,
  useEnterRoom,
  useExitRoom,
  useRemoveBookmark,
  useSaveRoles,
} from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { buttonRowStyle, listStyle, rowStyle } from "../components/listStyles.ts";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../components/usePaging.ts";
import QrScanner from "../components/QrScanner.tsx";

/** Host of a room URI, for "Hosted by …" labels (the Pod that owns the room). */
function roomHost(roomUrl: string): string {
  try {
    return new URL(roomUrl).host;
  } catch {
    return roomUrl;
  }
}

interface ConnectPageProps {
  session: Session;
}

export default function ConnectPage({ session }: ConnectPageProps) {
  const { showNotification } = useNotification();

  // All room state comes from ONE React Query (`useRoomState`) — one log read,
  // cached and deduped, refreshed only when a room mutation invalidates it.
  const roomQuery = useRoomState();
  const activeRoom = roomQuery.data?.current ?? null;
  const knownRooms = roomQuery.data?.known ?? [];
  const members = roomQuery.data?.members ?? [];
  const serverRoles = roomQuery.data?.myRoles;

  // Local editable copy of the role multi-select, seeded from the server value.
  // Re-syncs whenever the query data changes (e.g. after a save invalidates it);
  // React Query's structural sharing keeps the reference stable while editing.
  const [myRoles, setMyRoles] = useState<UserRole[]>([]);
  useEffect(() => {
    setMyRoles(serverRoles ?? []);
  }, [serverRoles]);

  const [roomInput, setRoomInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const roomPaging = usePaging(knownRooms);

  const create = useCreateRoom();
  const enter = useEnterRoom();
  const exit = useExitRoom();
  const del = useDeleteRoom();
  const add = useAddRoom();
  const remove = useRemoveBookmark();
  const saveRoles = useSaveRoles();
  const mutations = [create, enter, exit, del, add, remove, saveRoles];
  // Disable actions while any write is in flight or the resulting re-read runs.
  const busy = roomQuery.isFetching || mutations.some((m) => m.isPending);

  const ok = (msg: string) => () => showNotification(msg, "success");

  // A shareable app link that opens (and joins) this room — what the QR encodes.
  const inviteLink = activeRoom
    ? `${globalThis.location.origin}${globalThis.location.pathname}#/room/${
      encodeURIComponent(activeRoom)
    }`
    : "";

  const handleEnter = (room: string) =>
    enter.mutate(room, { onSuccess: ok("You joined the data room") });

  const handleAdd = (input: string) =>
    add.mutate(input, {
      onSuccess: () => {
        setRoomInput("");
        showNotification("Data room added to your list", "success");
      },
    });

  const handleRemoveBookmark = (room: string) =>
    remove.mutate(room, { onSuccess: ok("Removed from your list") });

  const handleCreate = () =>
    create.mutate(undefined, { onSuccess: ok("Data room created") });

  const handleLeave = () => {
    if (!activeRoom) return;
    exit.mutate(activeRoom, { onSuccess: ok("You left the data room") });
  };

  /** Delete a room you own (destroys it for everyone), then drop the bookmark. */
  const handleDeleteRoom = (room: string) => {
    if (
      !confirm(
        "Delete this data room for everyone? This removes the data room and its " +
          "entire membership and role history. This cannot be undone.",
      )
    ) {
      return;
    }
    del.mutate(room, { onSuccess: ok("Data room deleted") });
  };

  const handleSaveRoles = () => {
    if (!activeRoom) return;
    saveRoles.mutate({ room: activeRoom, roles: myRoles }, {
      onSuccess: ok("Roles updated"),
    });
  };

  const handleCopyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showNotification("Invite link copied", "success");
    } catch {
      showNotification("Could not copy link", "error");
    }
  };

  const handleScanResult = (text: string) => {
    setScanning(false);
    handleAdd(text); // scanning adds the room to your list; click it to enter
  };

  // Backing RDF resource (the rooms registry), linked so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  return (
    <section style={{ padding: "1.5rem" }}>
      {/* Active room */}
      {activeRoom && (
        <Box
          component="section"
          sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 3 }}
        >
          <Typography variant="h6" sx={{ mb: 1 }}>Active data room</Typography>
          <p style={{ wordBreak: "break-all", marginTop: 0 }}>
            <strong>URI:</strong>{" "}
            <a href={activeRoom} target="_blank" rel="noopener noreferrer">
              {activeRoom}
            </a>
            <IconButton
              size="small"
              onClick={handleCopyLink}
              title="Copy invite link"
              sx={{ ml: 0.5 }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </p>
          <Box sx={{ mb: 2 }}>
            <QRCodeSVG value={inviteLink} size={160} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Show this QR code, or copy the invite link, so others can join this
              data room.
            </Typography>
          </Box>

          <div style={buttonRowStyle}>
            <Button
              variant="outlined"
              color="error"
              onClick={handleLeave}
              disabled={busy}
            >
              {exit.isPending ? "Leaving…" : "Leave data room"}
            </Button>
          </div>

          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>My role(s)</Typography>
          <p>
            Independent of membership — assign or change your role(s) anytime.
            This is how others share data with you by role.
          </p>
          <div style={buttonRowStyle}>
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel id="my-roles-label">My role(s)</InputLabel>
              <Select
                labelId="my-roles-label"
                multiple
                value={myRoles}
                input={<OutlinedInput label="My role(s)" />}
                renderValue={(selected) =>
                  (selected as UserRole[]).map((r) => ROLE_LABELS[r] ?? r).join(
                    ", ",
                  )}
                onChange={(e) => {
                  const v = e.target.value;
                  setMyRoles(
                    (typeof v === "string" ? v.split(",") : v) as UserRole[],
                  );
                }}
              >
                {ROOM_ROLE_OPTIONS.map((r) => (
                  <MenuItem key={r} value={r}>
                    <Checkbox checked={myRoles.includes(r)} />
                    {ROLE_LABELS[r] ?? r}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={handleSaveRoles} disabled={busy}>
              {saveRoles.isPending ? "Saving…" : "Save roles"}
            </Button>
          </div>

          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Members</Typography>
          {members.length === 0
            ? <p>No members yet.</p>
            : (
              <ul style={listStyle}>
                {members.map((m) => (
                  <li key={m.webId}>
                    {m.webId} —{" "}
                    <small>
                      {m.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") ||
                        "no role"}
                    </small>
                  </li>
                ))}
              </ul>
            )}
        </Box>
      )}

      {/* Your rooms — bookmarks; enter or remove each from its row */}
      <Typography variant="h6" sx={{ mb: 1 }}>Your data rooms</Typography>
      {rdf && <RdfSourceLink href={rdf.rooms} />}
      {roomQuery.isLoading ? null : knownRooms.length === 0
        ? <p>No data rooms yet. Add or create one below.</p>
        : (
          <ul style={listStyle}>
            {roomPaging.pageItems.map((r) => (
              <li key={r} style={{ marginBottom: "1rem" }}>
                <div style={rowStyle}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ wordBreak: "break-all" }}>
                      <UriLink href={r}>{r}</UriLink>
                    </span>
                    <br />
                    <small style={{ color: "gray" }}>
                      {ownsRoom(r, session)
                        ? "Hosted by you"
                        : `Hosted by ${roomHost(r)}`}
                      {r === activeRoom && (
                        <>
                          {" · "}
                          <strong style={{ color: "inherit" }}>active</strong>
                        </>
                      )}
                    </small>
                  </div>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    {r !== activeRoom && (
                      <Tooltip title="Enter this data room">
                        <IconButton
                          size="small"
                          aria-label="Enter data room"
                          onClick={() => handleEnter(r)}
                          disabled={busy}
                        >
                          <LoginIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {ownsRoom(r, session)
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
                      )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      <Pager paging={roomPaging} />

      {/* Add a room — paste a URI or scan a QR; both just add to the list above */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Add a data room</Typography>
      <p>Paste a data room URI or scan its QR code to add it to your list.</p>
      <div style={buttonRowStyle}>
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
        <Button variant="outlined" onClick={() => setScanning((s) => !s)}>
          {scanning ? "Close scanner" : "Scan QR code"}
        </Button>
      </div>

      {scanning && (
        <QrScanner
          onResult={handleScanResult}
          onCancel={() => setScanning(false)}
        />
      )}

      {/* Create a room */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Host a data room</Typography>
      <p>Host a new data room. You're added as a member automatically.</p>
      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={handleCreate}
        disabled={busy}
      >
        {create.isPending ? "Creating…" : "Host a data room"}
      </Button>
    </section>
  );
}
