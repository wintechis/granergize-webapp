import { useEffect, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import ApartmentIcon from "@mui/icons-material/Apartment";
import EditIcon from "@mui/icons-material/Edit";
import { msg } from "../lib/messages.ts";
import { getSession } from "../hooks/session.ts";
import { sessionGateway } from "../services/pod/podGateway.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSaveOrganization } from "../hooks/mutations.ts";
import {
  getOrganization,
  type Organization,
} from "../services/organization/organizationManager.ts";
import { BackLink, DetailCard } from "../components/detail/DetailView.tsx";
import { FINDERS } from "../routes.ts";
import { OrgEditor, OrgReadView } from "../components/agent/OrgDetail.tsx";
import { logError } from "../lib/logError.ts";
import { bumpAvatar } from "../lib/avatarRefresh.ts";

/** The inline editor — the shared org fields + logo upload, saved to the WebID profile. */
function EditView({ org, onDone }: { org: Organization; onDone: () => void }) {
  const { showNotification } = useNotification();
  const [name, setName] = useState(org.name ?? "");
  const [homepage, setHomepage] = useState(org.homepage ?? "");
  const [sameAs, setSameAs] = useState(org.sameAs ?? "");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const save = useSaveOrganization();
  const saving = save.isPending;

  const handleSave = () =>
    save.mutate(
      { org: { name, homepage, sameAs }, logo: pickedFile },
      {
        onSuccess: () => {
          showNotification(msg("organisationSaved"), "success");
          bumpAvatar(); // refresh the header avatar + org logo (shell-less page)
          onDone();
        },
      },
    );

  return (
    <Stack spacing={2}>
      <OrgEditor
        showName
        name={name}
        onName={setName}
        homepage={homepage}
        onHomepage={setHomepage}
        sameAs={sameAs}
        onSameAs={setSameAs}
        logoUrl={org.logoUrl ?? undefined}
        onPickLogo={setPickedFile}
      />
      <Stack direction="row" spacing={1}>
        <Button onClick={onDone} disabled={saving}>{msg("btnCancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? msg("btnSaving") : msg("btnSave")}
        </Button>
      </Stack>
    </Stack>
  );
}

/** Read view: the org's logo + fields, or a guidance empty state. */
function ReadView({ org }: { org: Organization }) {
  const hasAny = Boolean(org.name || org.homepage || org.sameAs || org.logoUrl);
  if (!hasAny) {
    return (
      <Typography variant="body2" color="text.secondary">
        {msg("orgEmpty")}
      </Typography>
    );
  }
  return (
    <OrgReadView
      showName
      logoUrl={org.logoUrl ?? undefined}
      name={org.name}
      homepage={org.homepage}
      sameAs={org.sameAs}
    />
  );
}

/**
 * The Organisation page — the org the user works for (W3C Org `org:memberOf` → a
 * `<#org>` node in the WebID profile: name, homepage, the org's own WebID, and a logo;
 * see organizationManager.ts). Read-first with an inline `[Edit]` (mirrors the building
 * page; replaces the old OrganizationDialog), reached from the profile menu. A standalone
 * full-page route, so it carries its own "Loading…" text (the header indicator isn't
 * mounted here — see the loading-spinner policy).
 */
export default function Organisation() {
  const session = getSession();
  const [org, setOrg] = useState<Organization | null>(null);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Load on mount and after each save (a reloadKey bump re-runs this). setState lives in
  // the async callbacks only — never synchronously in the effect body (the cascading-
  // render rule). `loading` is derived from the not-yet-resolved null.
  useEffect(() => {
    let cancelled = false;
    getOrganization(sessionGateway(session))
      .then((o) => {
        if (!cancelled) setOrg(o ?? {});
      })
      .catch((err) => {
        logError("load organisation", err);
        if (!cancelled) setOrg({});
      });
    return () => {
      cancelled = true;
    };
  }, [session, reloadKey]);

  const loading = org === null;

  return (
    <Box>
      <Box sx={{ mb: 1 }}>
        <BackLink fallback={FINDERS.agents} />
      </Box>
      <DetailCard
        icon={<ApartmentIcon />}
        title={msg("orgDialogTitle")}
        action={!loading && !editing
          ? (
            <Button
              size="small"
              startIcon={<EditIcon fontSize="small" />}
              onClick={() => setEditing(true)}
            >
              {msg("btnEdit")}
            </Button>
          )
          : undefined}
      >
        {loading
          ? <Typography color="text.secondary">{msg("loadingEllipsis")}</Typography>
          : editing
          ? (
            <EditView
              org={org ?? {}}
              onDone={() => {
                setEditing(false);
                setReloadKey((k) => k + 1);
              }}
            />
          )
          : <ReadView org={org ?? {}} />}
      </DetailCard>
    </Box>
  );
}
