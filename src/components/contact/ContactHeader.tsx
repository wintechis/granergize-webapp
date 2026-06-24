import {
  Box,
  Button,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import PersonIcon from "@mui/icons-material/Person";
import ApartmentIcon from "@mui/icons-material/Apartment";
import { useState } from "react";
import {
  useContacts,
  useResolveAgent,
  useResolveOrg,
} from "../../hooks/queries.ts";
import { useSaveContact } from "../../hooks/mutations.ts";
import { BackLink, DetailRow, UriLink } from "../detail/DetailView.tsx";
import { msg } from "../../lib/messages.ts";
import type { Contact } from "../../services/contacts.ts";

/**
 * The contact page's header (mirrors BuildingHeader): a back link, the agent's
 * identity, the page's one action, and — for an organisation — its logo/homepage.
 *
 * The agent is rendered as a **person** or an **organisation** (the `kind`: the
 * user's local override wins over the resolved profile's `rdf:type`, defaulting to a
 * person). For an agent NOT yet in the address book the action is "Add to contacts";
 * for a KNOWN contact it's an inline `[Edit]`. The edits write a **local record** in
 * the user's own `contacts.ttl` (the agent's own profile is read-only, not ours to
 * own) via {@link useSaveContact} (re-saving the same WebID updates in place): a
 * person's stored name; an organisation's name + homepage + cross-reference. The
 * organisation logo shown is the resolved profile's (`foaf:logo`); a local logo
 * upload is a later refinement (see plan-contact-person-org.md).
 */
export default function ContactHeader({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: org } = useResolveOrg(webId);
  const contacts = useContacts();
  const saveContact = useSaveContact();

  const contact = (contacts.data ?? []).find((c) => c.webId === webId);
  const known = contact != null;
  // The local record wins over the resolved profile; an unrecognised agent defaults
  // to a person (correctable by re-saving with an explicit kind).
  const kind = contact?.kind ?? agent?.kind ?? "person";
  const isOrg = kind === "organisation";
  // A known contact shows its STORED label (what the user can edit); otherwise the
  // resolved profile name, falling back to the WebID until a name resolves.
  const displayName = (known ? contact!.name : agent?.name) || webId;
  const logoUrl = agent?.logoUrl ?? org?.logoUrl;
  // The header's org rows are the user's *curated* record only — the canonical
  // profile's website/etc. stay in AgentProfileSection, so nothing shows twice.
  // Editing still seeds from the canonical value (precedence: local over profile).
  const homepage = contact?.homepage;
  const sameAs = contact?.sameAs ?? [];

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [kindDraft, setKindDraft] = useState<Contact["kind"]>("person");
  const [homepageDraft, setHomepageDraft] = useState("");
  const [sameAsDraft, setSameAsDraft] = useState("");
  const saving = saveContact.isPending;
  // The user can re-classify a contact in the editor (the resolved profile rarely
  // types unreachable agents) — the draft kind drives the form while editing.
  const editingOrg = kindDraft === "organisation";

  const startEdit = () => {
    setName(contact?.name ?? agent?.name ?? "");
    setKindDraft(kind);
    setHomepageDraft(contact?.homepage ?? agent?.website ?? "");
    setSameAsDraft(sameAs[0] ?? "");
    setEditing(true);
  };

  // Persist as the drafted kind. A person keeps its avatar; an org carries
  // homepage + the single cross-reference the editor exposes (and drops the avatar).
  const handleSave = () => {
    const trimmed = name.trim() || undefined;
    const base = { webId, kind: kindDraft, name: trimmed };
    const onSuccess = () => setEditing(false);
    if (editingOrg) {
      const ref = sameAsDraft.trim();
      saveContact.mutate({
        ...base,
        homepage: homepageDraft.trim() || undefined,
        sameAs: ref ? [ref] : undefined,
      }, { onSuccess });
    } else {
      saveContact.mutate({ ...base, avatarUrl: agent?.avatarUrl }, { onSuccess });
    }
  };

  const editButton = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<EditIcon fontSize="small" />}
      onClick={startEdit}
    >
      {msg("btnEdit")}
    </Button>
  );
  const addButton = (
    <Button
      size="small"
      variant="outlined"
      disabled={saving}
      onClick={() =>
        saveContact.mutate({
          webId,
          kind,
          name: agent?.name,
          avatarUrl: isOrg ? undefined : agent?.avatarUrl,
          ...(isOrg && agent?.website ? { homepage: agent.website } : {}),
        })}
    >
      {saving ? msg("addingEllipsis") : msg("contactAddToContacts")}
    </Button>
  );
  const saveCancel = (
    <>
      <Button size="small" onClick={() => setEditing(false)} disabled={saving}>
        {msg("btnCancel")}
      </Button>
      <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>
        {saving ? msg("btnSaving") : msg("btnSave")}
      </Button>
    </>
  );

  return (
    <Box>
      <BackLink />
      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
        {(editing ? editingOrg : isOrg)
          ? <ApartmentIcon color="action" />
          : <PersonIcon color="action" />}
        {editing
          ? (
            <TextField
              size="small"
              label={editingOrg ? msg("lblCompanyName") : msg("contactName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              sx={{ flexGrow: 1 }}
              autoFocus
            />
          )
          : <Typography variant="h5" sx={{ flexGrow: 1 }}>{displayName}</Typography>}
        {editing ? saveCancel : known ? editButton : contacts.isSuccess ? addButton : null}
      </Stack>

      {/* In the editor, the kind is re-classifiable (the form follows the draft). */}
      {editing && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kindDraft}
          onChange={(_e, next) => next && setKindDraft(next)}
          aria-label={msg("contactKind")}
          sx={{ mt: 2 }}
        >
          <ToggleButton value="person">{msg("contactKindPerson")}</ToggleButton>
          <ToggleButton value="organisation">
            {msg("contactKindOrganisation")}
          </ToggleButton>
        </ToggleButtonGroup>
      )}

      {/* Organisation extras: logo, plus the editable homepage / cross-reference. */}
      {isOrg && logoUrl && !editing && (
        <Box
          component="img"
          src={logoUrl}
          alt={displayName}
          title={displayName}
          sx={{ mt: 1, maxHeight: 48, maxWidth: 200, objectFit: "contain" }}
        />
      )}
      {editingOrg && editing && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            size="small"
            label={msg("lblHomepageUri")}
            type="url"
            placeholder="https://example.com/"
            value={homepageDraft}
            onChange={(e) => setHomepageDraft(e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label={msg("lblOrgWebId")}
            type="url"
            placeholder="https://example.com/profile/card#me"
            value={sameAsDraft}
            onChange={(e) => setSameAsDraft(e.target.value)}
            helperText={msg("orgWebIdHelp")}
            fullWidth
          />
        </Stack>
      )}
      {isOrg && !editing && (homepage || sameAs.length > 0) && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {homepage && (
            <DetailRow
              label={msg("lblHomepageUri")}
              value={<UriLink href={homepage}>{homepage}</UriLink>}
            />
          )}
          {sameAs[0] && (
            <DetailRow
              label={msg("lblOrgWebId")}
              value={<UriLink href={sameAs[0]}>{sameAs[0]}</UriLink>}
            />
          )}
        </Stack>
      )}
    </Box>
  );
}
