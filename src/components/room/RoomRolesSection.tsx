import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type { UserRole } from "../../types.ts";
import { roleLabel, ROOM_ROLE_OPTIONS } from "../../constants/roles.ts";
import { useSaveRoles } from "../../hooks/mutations.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { SectionTitle } from "../detail/DetailView.tsx";

/**
 * The room page's ROLES section: a "My role(s)" multi-select you self-assign in
 * this room, plus a Save action. The role(s) you carry here are how others share
 * data with you by role. Seeded from the room log's `myRoles`; only rendered when
 * the room state is loaded. Extracted from the old Connect-tab room expansion.
 */
export default function RoomRolesSection(
  { roomUri, serverRoles, busy }: {
    roomUri: string;
    serverRoles: UserRole[];
    busy: boolean;
  },
) {
  const { showNotification } = useNotification();
  const saveRoles = useSaveRoles();

  // Local editable copy, seeded from the server value; re-syncs (during render,
  // not in an effect) whenever a save invalidates the log and the server value
  // changes — React Query's structural sharing keeps the reference stable while
  // editing, so this fires only on a real change (mirrors the old ConnectPage).
  const [myRoles, setMyRoles] = useState<UserRole[]>(serverRoles);
  const [seeded, setSeeded] = useState(serverRoles);
  if (serverRoles !== seeded) {
    setSeeded(serverRoles);
    setMyRoles(serverRoles);
  }

  const handleSave = () =>
    saveRoles.mutate({ room: roomUri, roles: myRoles }, {
      onSuccess: () => showNotification("Roles updated", "success"),
    });

  const disabled = busy || saveRoles.isPending;

  return (
    <Box>
      <SectionTitle>My role(s)</SectionTitle>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Assign or change your role(s) anytime — this is how others share data
        with you by role.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <FormControl size="small" sx={{ minWidth: 280 }}>
          <InputLabel id="my-roles-label">My role(s)</InputLabel>
          <Select
            labelId="my-roles-label"
            multiple
            value={myRoles}
            input={<OutlinedInput label="My role(s)" />}
            renderValue={(selected) =>
              (selected as UserRole[]).map((role) => roleLabel(role)).join(", ")}
            onChange={(e) => {
              const v = e.target.value;
              setMyRoles(
                (typeof v === "string" ? v.split(",") : v) as UserRole[],
              );
            }}
          >
            {ROOM_ROLE_OPTIONS.map((role) => (
              <MenuItem key={role} value={role}>
                <Checkbox checked={myRoles.includes(role)} />
                {roleLabel(role)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={handleSave} disabled={disabled}>
          {saveRoles.isPending ? "Saving…" : "Save roles"}
        </Button>
      </Stack>
    </Box>
  );
}
