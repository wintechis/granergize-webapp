import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import PersonIcon from "@mui/icons-material/Person";
import { useState } from "react";
import {
  useContacts,
  useResolveAgent,
  useResolveOrg,
} from "../../hooks/queries.ts";
import { useSaveContact } from "../../hooks/mutations.ts";
import { BackLink } from "../detail/DetailView.tsx";
import { msg } from "../../lib/messages.ts";

/**
 * The contact page's header (mirrors BuildingHeader): a back link, the agent's
 * identity (person icon + name, WebID fragment until a profile name resolves), the
 * producing org's logo when present, and the page's one action. For an agent NOT yet
 * in the address book that's "Add to contacts"; for a KNOWN contact it's an inline
 * `[Edit]` that flips the name to a field — the stored label is the one thing the user
 * owns (the WebID is identity, the profile is read-only), saved idempotently via
 * {@link useSaveContact} (re-saving the same WebID updates the name in place).
 */
export default function ContactHeader({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: org } = useResolveOrg(webId);
  const contacts = useContacts();
  const saveContact = useSaveContact();

  const contact = (contacts.data ?? []).find((c) => c.webId === webId);
  const known = contact != null;
  // A known contact shows its STORED label (what the user can edit); otherwise the
  // resolved profile name, falling back to the WebID until a name resolves.
  const displayName = (known ? contact!.name : agent?.name) || webId;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const saving = saveContact.isPending;
  const startEdit = () => {
    setName(contact?.name ?? agent?.name ?? "");
    setEditing(true);
  };
  const handleSave = () =>
    saveContact.mutate(
      { webId, name: name.trim() || undefined, avatarUrl: agent?.avatarUrl },
      { onSuccess: () => setEditing(false) },
    );

  return (
    <Box>
      <BackLink />
      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
        <PersonIcon color="action" />
        {editing
          ? (
            <TextField
              size="small"
              label={msg("contactName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ flexGrow: 1 }}
              autoFocus
            />
          )
          : (
            <Typography variant="h5" sx={{ flexGrow: 1 }}>{displayName}</Typography>
          )}
        {editing
          ? (
            <>
              <Button size="small" onClick={() => setEditing(false)} disabled={saving}>
                {msg("btnCancel")}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? msg("btnSaving") : msg("btnSave")}
              </Button>
            </>
          )
          : known
          ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon fontSize="small" />}
              onClick={startEdit}
            >
              {msg("btnEdit")}
            </Button>
          )
          : contacts.isSuccess
          ? (
            <Button
              size="small"
              variant="outlined"
              disabled={saving}
              onClick={() =>
                saveContact.mutate({
                  webId,
                  name: agent?.name,
                  avatarUrl: agent?.avatarUrl,
                })}
            >
              {saving ? msg("addingEllipsis") : msg("contactAddToContacts")}
            </Button>
          )
          : null}
      </Stack>
      {org?.logoUrl && (
        <Box
          component="img"
          src={org.logoUrl}
          alt={org.name ?? ""}
          title={org.name}
          sx={{ mt: 1, maxHeight: 48, maxWidth: 200, objectFit: "contain" }}
        />
      )}
    </Box>
  );
}
