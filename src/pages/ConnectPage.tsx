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
import LogoutIcon from "@mui/icons-material/Logout";
import { QRCodeSVG } from "qrcode.react";
import { Session } from "@inrupt/solid-client-authn-browser";
import { ownsRoom } from "../services/interop/dataRoom.ts";
import type { UserRole } from "../../types/types.ts";
import { ROLE_LABELS, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";
import { useContacts, useRoomState } from "../hooks/queries.ts";
import {
  useAddRoom,
  useCreateRoom,
  useDeleteRoom,
  useEnterRoom,
  useExitRoom,
  useRemoveBookmark,
  useRemoveContact,
  useSaveContact,
  useSaveRoles,
} from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { resolveAgent } from "../services/utils/agentResolver.ts";
import { formatError } from "../services/utils/formatError.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
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

  // Contacts (the personal address book).
  const contactsQuery = useContacts();
  const contacts = contactsQuery.data ?? [];
  const saveContact = useSaveContact();
  const removeContact = useRemoveContact();
  const [contactInput, setContactInput] = useState("");
  const contactPaging = usePaging(contacts);

  const [roomInput, setRoomInput] = useState("");
  const [scanning, setScanning] = useState(false);
  // All known rooms in their natural order; the active one expands in place (its
  // detail box renders beneath its own row). If the active room isn't bookmarked,
  // it is shown first so it's never hidden.
  const rooms = activeRoom && !knownRooms.includes(activeRoom)
    ? [activeRoom, ...knownRooms]
    : knownRooms;
  const roomPaging = usePaging(rooms);

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

  /** Add a contact: resolve the WebID's name/avatar, then persist it. */
  const handleAddContact = async () => {
    const webId = contactInput.trim();
    if (!/^https?:\/\//i.test(webId)) {
      showNotification("Enter a WebID (an http(s) URI)", "error");
      return;
    }
    try {
      const agent = await resolveAgent(webId, session);
      await saveContact.mutateAsync(agent);
      setContactInput("");
      showNotification("Contact added", "success");
    } catch (e) {
      showNotification(formatError("add contact", e), "error");
    }
  };

  const handleRemoveContact = (webId: string) =>
    removeContact.mutate(webId, { onSuccess: ok("Contact removed") });

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

  /** The "Hosted by …" / "active" sub-line shared by every room row. */
  const roomMeta = (r: string) => (
    <Typography variant="caption" color="text.secondary" component="span">
      {ownsRoom(r, session) ? "Hosted by you" : `Hosted by ${roomHost(r)}`}
      {r === activeRoom && (
        <>
          {" · "}
          <strong style={{ color: "inherit" }}>active</strong>
        </>
      )}
    </Typography>
  );

  const hasRooms = activeRoom !== null || knownRooms.length > 0;

  return (
    <section style={{ padding: "1.5rem" }}>
      {/* Contacts — a personal address book of WebID agents. Referenced agents
          (share recipients, building operators) are auto-remembered here; you can
          also add or remove one by hand. Names/avatars are resolved live from each
          agent's own profile. */}
      <Typography variant="h6" sx={{ mb: 1 }}>Contacts</Typography>
      {rdf && <RdfSourceLink href={rdf.contacts} />}
      <p>
        People and organisations you've referenced. Paste a WebID to add one.
      </p>
      <div style={buttonRowStyle}>
        <TextField
          size="small"
          label="WebID"
          value={contactInput}
          onChange={(e) => setContactInput(e.target.value)}
          sx={{ minWidth: 320 }}
        />
        <Button
          variant="outlined"
          aria-label="Add contact"
          disabled={!contactInput.trim() || saveContact.isPending}
          onClick={handleAddContact}
        >
          {saveContact.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      {contactsQuery.isLoading
        ? <p>Loading…</p>
        : contacts.length === 0
        ? <p>No contacts yet.</p>
        : (
          <ul style={listStyle} aria-label="Contacts">
            {contactPaging.pageItems.map((c) => (
              <li key={c.webId} style={rowStyle}>
                <span style={{ minWidth: 0 }}>
                  <AgentLabel value={c.webId} />
                </span>
                <Tooltip title="Remove contact">
                  <IconButton
                    size="small"
                    color="error"
                    aria-label="Remove contact"
                    onClick={() => handleRemoveContact(c.webId)}
                    disabled={removeContact.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      <Pager paging={contactPaging} />

      {/* Your data rooms — one ordered list. Each row shows the room URI with
          enter / delete-or-remove; the active room expands in place, its QR,
          roles and members in a box directly beneath its own row. */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Your data rooms</Typography>
      {rdf && <RdfSourceLink href={rdf.bookmarks} />}
      {roomQuery.isLoading
        ? <p>Loading…</p>
        : !hasRooms
        ? <p>No data rooms yet. Add or create one below.</p>
        : (
          <ul style={listStyle}>
            {roomPaging.pageItems.map((r) => {
              const isActive = r === activeRoom;
              return (
                <li key={r} style={{ marginBottom: "1rem" }}>
                  <div style={rowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ wordBreak: "break-all" }}>
                        <UriLink href={r}>{r}</UriLink>
                        {isActive && (
                          <Tooltip title="Copy invite link">
                            <IconButton
                              size="small"
                              aria-label="Copy invite link"
                              onClick={handleCopyLink}
                              sx={{ ml: 0.5 }}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </span>
                      <br />
                      {roomMeta(r)}
                    </div>
                    <div style={{ display: "flex", gap: "0.25rem" }}>
                      {isActive
                        ? (
                          <Tooltip
                            title={exit.isPending
                              ? "Leaving…"
                              : "Leave this data room"}
                          >
                            <span>
                              <IconButton
                                size="small"
                                aria-label="Leave data room"
                                onClick={handleLeave}
                                disabled={busy}
                              >
                                <LogoutIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )
                        : (
                          <Tooltip title="Enter this data room">
                            <span>
                              <IconButton
                                size="small"
                                aria-label="Enter data room"
                                onClick={() => handleEnter(r)}
                                disabled={busy}
                              >
                                <LoginIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      {deleteOrRemove(r)}
                    </div>
                  </div>

                  {/* Active room: detail box directly beneath its own row. */}
                  {isActive && (
                    <Box
                      sx={{
                        border: 1,
                        borderColor: "primary.main",
                        borderRadius: 1,
                        p: 2,
                        mt: 1,
                      }}
                    >
                      {/* Expanded detail: QR / invite, roles, members. */}
                      <Box sx={{ mb: 1 }}>
                        <QRCodeSVG value={inviteLink} size={160} />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 1 }}
                        >
                          Show this QR code, or copy the invite link, so others
                          can join this data room.
                        </Typography>
                      </Box>

                      <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
                        My role(s)
                      </Typography>
                      <p style={{ marginTop: 0 }}>
                        Independent of membership — assign or change your role(s)
                        anytime. This is how others share data with you by role.
                      </p>
                      <div style={buttonRowStyle}>
                        <FormControl size="small" sx={{ minWidth: 280 }}>
                          <InputLabel id="my-roles-label">
                            My role(s)
                          </InputLabel>
                          <Select
                            labelId="my-roles-label"
                            multiple
                            value={myRoles}
                            input={<OutlinedInput label="My role(s)" />}
                            renderValue={(selected) =>
                              (selected as UserRole[]).map((role) =>
                                ROLE_LABELS[role] ?? role
                              ).join(", ")}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMyRoles(
                                (typeof v === "string"
                                  ? v.split(",")
                                  : v) as UserRole[],
                              );
                            }}
                          >
                            {ROOM_ROLE_OPTIONS.map((role) => (
                              <MenuItem key={role} value={role}>
                                <Checkbox checked={myRoles.includes(role)} />
                                {ROLE_LABELS[role] ?? role}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <Button
                          variant="outlined"
                          onClick={handleSaveRoles}
                          disabled={busy}
                        >
                          {saveRoles.isPending ? "Saving…" : "Save roles"}
                        </Button>
                      </div>

                      <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
                        Members
                      </Typography>
                      {members.length === 0
                        ? <p style={{ marginBottom: 0 }}>No members yet.</p>
                        : (
                          <ul style={listStyle}>
                            {members.map((m) => (
                              <li key={m.webId}>
                                <AgentLabel value={m.webId} /> —{" "}
                                <small>
                                  {m.roles.map((role) => ROLE_LABELS[role] ?? role)
                                    .join(", ") || "no role"}
                                </small>
                              </li>
                            ))}
                          </ul>
                        )}
                    </Box>
                  )}
                </li>
              );
            })}
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
