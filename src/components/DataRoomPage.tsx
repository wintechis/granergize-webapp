import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { QRCodeSVG } from "qrcode.react";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  addKnownRoom,
  createRoom,
  type DataRoomMember,
  deleteRoom,
  exitRoom,
  extractRoomUrl,
  getMembers,
  getMyRole,
  openRoom,
  ownsRoom,
  readRooms,
  removeKnownRoom,
  roomExists,
  setMyRole,
} from "../services/interop/dataRoom.ts";
import type { UserRole } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import QrScanner from "./QrScanner.tsx";

/** Roles a user can self-assign in the data room (excludes the internal "dummy" role). */
const ROOM_ROLE_OPTIONS: UserRole[] = [
  "investor",
  "user",
  "benchmark_service_provider",
];

const ROLE_LABELS: Record<string, string> = {
  dummy: "Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: "0.5rem",
  flexWrap: "wrap",
};

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "60ch",
};

/** Bulletless, flush-left list — used for every list on the page. */
const listStyle: React.CSSProperties = {
  listStyle: "none",
  paddingLeft: 0,
  margin: 0,
};

interface DataRoomPageProps {
  session: Session;
}

type Pending = "create" | "enter" | "leave" | "delete" | "roles" | "add" | null;

export default function DataRoomPage({ session }: DataRoomPageProps) {
  const { showNotification } = useNotification();
  // The room you're currently in (mirrors the Pod's pointer), plus its roles and
  // members; and your bookmarked rooms ("Your rooms"). All Pod-backed.
  const [activeRoom, setActiveRoomState] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [myRoles, setMyRoles] = useState<UserRole[]>([]);
  const [members, setMembers] = useState<DataRoomMember[]>([]);
  const [knownRooms, setKnownRooms] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    loadRoom();
  }, [session]);

  /** Re-read everything from the Pod: current room (+ its roles/members) and bookmarks. */
  const loadRoom = async () => {
    try {
      // One registry GET gives both the current room and the bookmark list,
      // and hydrates the in-memory current-room mirror.
      const { current, known } = await readRooms(session);
      setActiveRoomState(current);
      setKnownRooms(known);
      if (current) {
        const [mine, all] = await Promise.all([
          getMyRole(current, session),
          getMembers(current, session),
        ]);
        setMyRoles(mine);
        setMembers(all);
      } else {
        setMyRoles([]);
        setMembers([]);
      }
    } catch (error) {
      console.error("Error loading data room:", error);
    }
  };

  const runAction = async (
    action: Pending,
    fn: () => Promise<void>,
    successMessage: string,
    failPrefix: string,
  ) => {
    setPending(action);
    try {
      await fn();
      await loadRoom();
      showNotification(successMessage, "success");
    } catch (error) {
      console.error(`${failPrefix}:`, error);
      showNotification(
        `${failPrefix}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setPending(null);
    }
  };

  // A shareable app link that opens (and joins) this room — what the QR encodes.
  const inviteLink = activeRoom
    ? `${globalThis.location.origin}${globalThis.location.pathname}#/room/${
      encodeURIComponent(activeRoom)
    }`
    : "";

  /** Enter (join) a bookmarked room — leaves whatever room you were in. */
  const enterRoom = (url: string) =>
    runAction(
      "enter",
      async () => {
        if (!(await openRoom(url, session))) {
          throw new Error("Room is not reachable");
        }
      },
      "You joined the room",
      "Failed to join",
    );

  /** Add a room URI (raw or invite link) to your bookmarks — does not enter it. */
  const addRoom = (input: string) =>
    runAction(
      "add",
      async () => {
        const room = extractRoomUrl(input);
        if (!(await roomExists(room, session))) {
          throw new Error("Room is not reachable");
        }
        await addKnownRoom(room, session);
        setRoomInput("");
      },
      "Room added to your list",
      "Failed to add room",
    );

  const handleCreate = () =>
    runAction("create", () => createRoom(session).then(() => {}), "Room created", "Failed to create room");

  const handleLeave = () =>
    runAction(
      "leave",
      () => exitRoom(activeRoom!, session),
      "You left the room",
      "Failed to leave",
    );

  const handleDelete = () => {
    if (
      !confirm(
        "Delete this room for everyone? This removes the room and its entire " +
          "membership and role history. This cannot be undone.",
      )
    ) {
      return;
    }
    const room = activeRoom!;
    runAction(
      "delete",
      async () => {
        await deleteRoom(room, session);
        await removeKnownRoom(room, session);
      },
      "Room deleted",
      "Failed to delete",
    );
  };

  const handleSaveRoles = () =>
    runAction(
      "roles",
      () => setMyRole(activeRoom!, myRoles, session),
      "Roles updated",
      "Failed to save roles",
    );

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
    addRoom(text); // scanning adds the room to your list; click it to enter
  };

  const busy = pending !== null;

  return (
    <section style={{ padding: "1.5rem" }}>
      {/* Current room */}
      {activeRoom && (
        <Box
          component="section"
          sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, mb: 3 }}
        >
          <Typography variant="h6" sx={{ mb: 1 }}>Current room</Typography>
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
              room.
            </Typography>
          </Box>

          <div style={rowStyle}>
            <Button
              variant="outlined"
              color="error"
              onClick={handleLeave}
              disabled={busy}
            >
              {pending === "leave" ? <CircularProgress size={20} /> : "Leave room"}
            </Button>
            {ownsRoom(activeRoom, session) && (
              <Button
                variant="outlined"
                color="error"
                onClick={handleDelete}
                disabled={busy}
              >
                {pending === "delete"
                  ? <CircularProgress size={20} />
                  : "Delete room"}
              </Button>
            )}
          </div>

          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>My role(s)</Typography>
          <p>
            Independent of membership — assign or change your role(s) anytime.
            This is how others share data with you by role.
          </p>
          <div style={rowStyle}>
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
              {pending === "roles" ? <CircularProgress size={20} /> : "Save roles"}
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

      {/* Your rooms — bookmarks; click one to enter it */}
      <Typography variant="h6" sx={{ mb: 1 }}>Your rooms</Typography>
      {knownRooms.length === 0
        ? <p>No rooms yet. Add or create one below.</p>
        : (
          <ul style={listStyle}>
            {knownRooms.map((r) => (
              <li key={r}>
                <Button
                  variant={r === activeRoom ? "contained" : "text"}
                  onClick={() => enterRoom(r)}
                  disabled={busy}
                  sx={{ textTransform: "none", justifyContent: "flex-start" }}
                >
                  <span style={ellipsis}>
                    {r}{r === activeRoom ? " (current)" : ""}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}

      {/* Add a room — paste a URI or scan a QR; both just add to the list above */}
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Add a room</Typography>
      <p>Paste a room URI or scan its QR code to add it to your list.</p>
      <div style={rowStyle}>
        <TextField
          size="small"
          label="Room URI"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          sx={{ minWidth: 320 }}
        />
        <Button
          variant="outlined"
          disabled={!roomInput.trim() || busy}
          onClick={() => addRoom(roomInput)}
        >
          {pending === "add" ? <CircularProgress size={20} /> : "Add"}
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
      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>Create a room</Typography>
      <p>Create a new room on your own Pod. You're added as a member automatically.</p>
      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={handleCreate}
        disabled={busy}
      >
        {pending === "create" ? <CircularProgress size={20} /> : "Create a room"}
      </Button>
    </section>
  );
}
