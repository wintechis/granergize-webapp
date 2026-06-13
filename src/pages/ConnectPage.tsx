import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import type { UserRole } from "../types.ts";
import { ROLE_LABELS, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";
import { queryKeys, useContacts, useRoomState } from "../hooks/queries.ts";
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
import { useConfirm } from "../context/ConfirmContext.tsx";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { resolveAgent } from "../services/agents/agentResolver.ts";
import { formatError } from "../lib/formatError.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import { buttonRowStyle, listStyle, rowStyle } from "../constants/listStyles.ts";
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

interface ConnectPageProps {
  session: Session;
}

export default function ConnectPage({ session }: ConnectPageProps) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();

  // All room state comes from ONE React Query (`useRoomState`) — one log read,
  // cached and deduped, refreshed only when a room mutation invalidates it.
  const roomQuery = useRoomState();
  // The room log is CROSS-AGENT state: another member's join is appended by THEM
  // into the room container, so no local write ever invalidates it, and the
  // global policy is refetch-on-invalidation only (refetchOnMount: false).
  // Switching to the Connect tab remounts this page (it renders under
  // `tabValue === 3` in index.tsx), so opening it is the user's "look" at the
  // membership and triggers the one refetch — the same discipline ShareViewDialog
  // applies on open. Without this a peer who joined your active room never shows
  // up here until some unrelated room mutation happens to invalidate the log.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.roomLog });
  }, [qc]);
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
  // Which QR scanner is open (one camera view at a time): a scanned code adds
  // a contact (WebID) or a data room (invite link), depending on the opener.
  const [scanning, setScanning] = useState<"contact" | "room" | null>(null);
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
    } catch (err) {
      logError("copy invite link to clipboard", err);
      showNotification("Could not copy link", "error");
    }
  };

  const handleRoomScan = (text: string) => {
    setScanning(null);
    handleAdd(text); // scanning adds the room to your list; click it to enter
  };

  /** Add a contact: resolve the WebID's name/avatar, then persist it. */
  const addContact = async (webId: string) => {
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

  const handleAddContact = () => addContact(contactInput.trim());

  // A scanned WebID QR (e.g. the one on a solidcommunity.net profile page)
  // is added directly; the input keeps the value so a failed resolve stays
  // visible and editable.
  const handleContactScan = (text: string) => {
    setScanning(null);
    const webId = text.trim();
    setContactInput(webId);
    addContact(webId);
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
        {/* Opener only — the scanner's own Cancel button (right under the
            camera view) is the one way to close it. */}
        <Button
          variant="outlined"
          onClick={() => setScanning("contact")}
          disabled={scanning !== null}
        >
          Scan QR code
        </Button>
      </div>
      {scanning === "contact" && (
        <QrScanner
          onResult={handleContactScan}
          onCancel={() => setScanning(null)}
        />
      )}
      {contactsQuery.isLoading
        ? <p>Loading…</p>
        : contacts.length === 0
        ? <p>No contacts yet. Add one by WebID or QR code.</p>
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

      {/* Your data rooms — one ordered list mixing rooms you host and rooms
          others host. The toolbar above it holds both ways of getting a room
          into the list: host a new one, or add someone else's by URI / QR.
          Each row shows the room URI with enter / delete-or-remove; the active
          room expands in place, its QR, roles and members in a box directly
          beneath its own row. */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Your data rooms</Typography>
      {rdf && <RdfSourceLink href={rdf.bookmarks} />}
      <div
        style={{
          ...buttonRowStyle,
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
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
          onClick={() => setScanning("room")}
          disabled={scanning !== null}
        >
          Scan QR code
        </Button>
      </div>
      {scanning === "room" && (
        <QrScanner
          onResult={handleRoomScan}
          onCancel={() => setScanning(null)}
        />
      )}
      {roomQuery.isLoading
        ? <p>Loading…</p>
        : !hasRooms
        ? <p>No data rooms yet. Host one, or add one by URI or QR code.</p>
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
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1 }}
                      >
                        Independent of membership — assign or change your
                        role(s) anytime. This is how others share data with you
                        by role.
                      </Typography>
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
    </section>
  );
}
