import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ApartmentIcon from "@mui/icons-material/Apartment";
import EditIcon from "@mui/icons-material/Edit";
import { msg } from "../lib/messages.ts";
import { getSession } from "../hooks/session.ts";
import { sessionGateway } from "../services/pod/podGateway.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSaveOrganization } from "../hooks/mutations.ts";
import {
  getOrganization,
  isSupportedLogoType,
  type Organization,
} from "../services/organization/organizationManager.ts";
import {
  BackLink,
  DetailCard,
  DetailRow,
  UriLink,
} from "../components/detail/DetailView.tsx";
import { logError } from "../lib/logError.ts";
import { bumpAvatar } from "../lib/avatarRefresh.ts";

const ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp,image/gif";

/** The org logo lockup (landscape → contain, not crop). Public-read, so the URL renders
 *  directly; in the editor a picked file's object URL previews the pending upload. */
function LogoAvatar({ src }: { src?: string }) {
  return (
    <Avatar
      src={src}
      alt={msg("orgLogoAlt")}
      variant="rounded"
      sx={{
        width: 160,
        height: 48,
        "& .MuiAvatar-img": { objectFit: "contain" },
      }}
    />
  );
}

/** The inline editor — the same fields the old OrganizationDialog offered, on the page. */
function EditView({ org, onDone }: { org: Organization; onDone: () => void }) {
  const { showNotification } = useNotification();
  const [name, setName] = useState(org.name ?? "");
  const [homepage, setHomepage] = useState(org.homepage ?? "");
  const [sameAs, setSameAs] = useState(org.sameAs ?? "");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const save = useSaveOrganization();
  const saving = save.isPending;

  // Revoke the object URL of a previewed-but-unsaved logo on unmount.
  useEffect(() => () => {
    if (pickedPreview) URL.revokeObjectURL(pickedPreview);
  }, [pickedPreview]);

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedLogoType(file)) {
      showNotification(msg("chooseImageType"), "warning");
      return;
    }
    if (pickedPreview) URL.revokeObjectURL(pickedPreview);
    setPickedFile(file);
    setPickedPreview(URL.createObjectURL(file));
  };

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
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <LogoAvatar src={pickedPreview ?? org.logoUrl ?? undefined} />
        <Box>
          <Button onClick={() => fileInputRef.current?.click()}>
            {msg("orgChooseLogo")}
          </Button>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            {msg("orgLogoFormats")}
          </Typography>
        </Box>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={handlePickFile}
        />
      </Box>
      <TextField
        label={msg("lblCompanyName")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        fullWidth
        size="small"
      />
      <TextField
        label={msg("lblHomepageUri")}
        type="url"
        placeholder="https://example.com/"
        value={homepage}
        onChange={(e) => setHomepage(e.target.value)}
        fullWidth
        size="small"
      />
      <TextField
        label={msg("lblOrgWebId")}
        type="url"
        placeholder="https://example.com/profile/card#me"
        value={sameAs}
        onChange={(e) => setSameAs(e.target.value)}
        helperText={msg("orgWebIdHelp")}
        fullWidth
        size="small"
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
    <Stack spacing={1}>
      {org.logoUrl && <LogoAvatar src={org.logoUrl} />}
      {org.name && <DetailRow label={msg("lblCompanyName")} value={org.name} />}
      {org.homepage && (
        <DetailRow
          label={msg("lblHomepageUri")}
          value={<UriLink href={org.homepage}>{org.homepage}</UriLink>}
        />
      )}
      {org.sameAs && (
        <DetailRow
          label={msg("lblOrgWebId")}
          value={<UriLink href={org.sameAs}>{org.sameAs}</UriLink>}
        />
      )}
    </Stack>
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
        <BackLink />
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
