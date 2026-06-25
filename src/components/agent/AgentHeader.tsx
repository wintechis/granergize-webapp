import {
  Box,
  Button,
  MenuItem,
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
  useAgents,
  useResolveAgent,
  useResolveOrg,
} from "../../hooks/queries.ts";
import { useSaveAgent } from "../../hooks/mutations.ts";
import { BackLink, DetailRow, RefLink } from "../detail/DetailView.tsx";
import { AgentLabel } from "../AgentLabel.tsx";
import { OrgEditor, OrgReadView } from "./OrgDetail.tsx";
import { agentRoute, FINDERS } from "../../routes.ts";
import { msg } from "../../lib/messages.ts";
import type { SavedAgent } from "../../services/savedAgents.ts";

/**
 * The agent page's header (mirrors BuildingHeader): a back link, the agent's
 * identity, the page's one action, and — for an organisation — its logo/homepage.
 *
 * The agent is rendered as a **person** or an **organisation** (the `kind`: the
 * user's local override wins over the resolved profile's `rdf:type`, defaulting to a
 * person). For an agent NOT yet in the address book the action is "Add to agents";
 * for a KNOWN agent it's an inline `[Edit]`. The edits write a **local record** in
 * the user's own `agents.ttl` (the agent's own profile is read-only, not ours to
 * own) via {@link useSaveAgent} (re-saving the same WebID updates in place): a
 * person's stored name + a "works for" edge (`org:memberOf`) to an org contact; an
 * organisation's name + homepage + cross-reference + a logo (uploaded to the user's
 * own Pod as `vcard:logo`). The organisation read/edit body reuses the shared
 * {@link OrgEditor}/{@link OrgReadView} with the Organisation page; this header adds
 * only the contact-specific chrome (the kind toggle, add-to-contacts, and the
 * person "works for" edge).
 */
export default function AgentHeader({ webId }: { webId: string }) {
  const { data: agent } = useResolveAgent(webId);
  const { data: org } = useResolveOrg(webId);
  const contacts = useAgents();
  const saveContact = useSaveAgent();

  const contact = (contacts.data ?? []).find((c) => c.webId === webId);
  const known = contact != null;
  // The local record wins over the resolved profile; an unrecognised agent defaults
  // to a person (correctable by re-saving with an explicit kind).
  const kind = contact?.kind ?? agent?.kind ?? "person";
  const isOrg = kind === "organisation";
  // A known contact shows its STORED label (what the user can edit); otherwise the
  // resolved profile name, falling back to the WebID until a name resolves.
  const displayName = (known ? contact!.name : agent?.name) || webId;
  // Logo precedence: the user's local record wins, then the resolved profile.
  const logoUrl = contact?.logoUrl ?? agent?.logoUrl ?? org?.logoUrl;
  // The header's org rows are the user's *curated* record only — the canonical
  // profile's website/etc. stay in AgentProfileSection, so nothing shows twice.
  // Editing still seeds from the canonical value (precedence: local over profile).
  const homepage = contact?.homepage;
  const sameAs = contact?.sameAs ?? [];
  const memberOf = contact?.memberOf;
  // Org contacts the user already keeps — the "works for" edge can only point at one
  // (excluding this contact itself).
  const orgOptions = (contacts.data ?? []).filter(
    (c) => c.kind === "organisation" && c.webId !== webId,
  );
  // The "works for" target's curated name (the edge points at an org contact); the
  // user's stored label wins over the resolved profile, so prefer it over AgentLabel.
  const memberOrgName = (contacts.data ?? []).find((c) => c.webId === memberOf)?.name;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [kindDraft, setKindDraft] = useState<SavedAgent["kind"]>("person");
  const [homepageDraft, setHomepageDraft] = useState("");
  const [sameAsDraft, setSameAsDraft] = useState("");
  const [memberOfDraft, setMemberOfDraft] = useState("");
  const [pickedLogo, setPickedLogo] = useState<File | null>(null);
  const saving = saveContact.isPending;
  // The user can re-classify a contact in the editor (the resolved profile rarely
  // types unreachable agents) — the draft kind drives the form while editing.
  const editingOrg = kindDraft === "organisation";

  const startEdit = () => {
    setName(contact?.name ?? agent?.name ?? "");
    setKindDraft(kind);
    setHomepageDraft(contact?.homepage ?? agent?.website ?? "");
    setSameAsDraft(sameAs[0] ?? "");
    setMemberOfDraft(memberOf ?? "");
    setPickedLogo(null);
    setEditing(true);
  };

  // Persist as the drafted kind. A person keeps its avatar + any "works for" edge;
  // an org carries homepage + the single cross-reference + an optional uploaded logo
  // (and drops the avatar).
  const handleSave = () => {
    const trimmed = name.trim() || undefined;
    const base = { webId, kind: kindDraft, name: trimmed };
    const onSuccess = () => {
      setPickedLogo(null);
      setEditing(false);
    };
    if (editingOrg) {
      const ref = sameAsDraft.trim();
      saveContact.mutate({
        contact: {
          ...base,
          homepage: homepageDraft.trim() || undefined,
          sameAs: ref ? [ref] : undefined,
          logoUrl: contact?.logoUrl,
        },
        logo: pickedLogo,
      }, { onSuccess });
    } else {
      saveContact.mutate({
        ...base,
        avatarUrl: agent?.avatarUrl,
        memberOf: memberOfDraft || undefined,
      }, { onSuccess });
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
      {saving ? msg("addingEllipsis") : msg("agentAddToBook")}
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
      <BackLink fallback={FINDERS.agents} />
      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
        {(editing ? editingOrg : isOrg)
          ? <ApartmentIcon color="action" />
          : <PersonIcon color="action" />}
        {editing
          ? (
            <TextField
              size="small"
              label={editingOrg ? msg("lblCompanyName") : msg("agentName")}
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
          aria-label={msg("agentKind")}
          sx={{ mt: 2 }}
        >
          <ToggleButton value="person">{msg("agentKindPerson")}</ToggleButton>
          <ToggleButton value="organisation">
            {msg("agentKindOrganisation")}
          </ToggleButton>
        </ToggleButtonGroup>
      )}

      {/* Person extra: the local "works for" edge to an org contact (editor: a
          dropdown of org contacts; read view: the linked org). Independent of the
          person's own profile — see contacts.ts memberOf. */}
      {!editingOrg && editing && orgOptions.length > 0 && (
        <TextField
          select
          size="small"
          label={msg("agentWorksFor")}
          value={memberOfDraft}
          onChange={(e) => setMemberOfDraft(e.target.value)}
          sx={{ mt: 2, minWidth: 260 }}
        >
          <MenuItem value="">{msg("agentWorksForNone")}</MenuItem>
          {orgOptions.map((o) => (
            <MenuItem key={o.webId} value={o.webId}>
              {o.name ?? o.webId}
            </MenuItem>
          ))}
        </TextField>
      )}
      {!isOrg && !editing && memberOf && (
        <Box sx={{ mt: 1 }}>
          <DetailRow
            label={msg("agentWorksFor")}
            value={memberOrgName
              ? <RefLink to={agentRoute(memberOf)}>{memberOrgName}</RefLink>
              : <AgentLabel value={memberOf} />}
          />
        </Box>
      )}

      {/* Organisation body — the shared editor / read view (logo + homepage +
          cross-reference). The name lives in the header heading above (showName off). */}
      {editingOrg && editing && (
        <Box sx={{ mt: 2 }}>
          <OrgEditor
            homepage={homepageDraft}
            onHomepage={setHomepageDraft}
            sameAs={sameAsDraft}
            onSameAs={setSameAsDraft}
            logoUrl={logoUrl}
            onPickLogo={setPickedLogo}
          />
        </Box>
      )}
      {isOrg && !editing && (logoUrl || homepage || sameAs.length > 0) && (
        <Box sx={{ mt: 1 }}>
          <OrgReadView logoUrl={logoUrl} homepage={homepage} sameAs={sameAs[0]} />
        </Box>
      )}
    </Box>
  );
}
