import { useEffect, useRef, useState } from "react";
import { Avatar, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { msg } from "../../lib/messages.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { isSupportedLogoType, LOGO_ACCEPT } from "../../services/pod/logoImage.ts";
import { DetailRow, UriLink } from "../detail/DetailView.tsx";

/**
 * Shared rendering for an organisation's substance — logo + name + homepage +
 * cross-reference (`owl:sameAs`/WebID) — the part the user's OWN organisation
 * (Organisation page) and a REFERENCED organisation contact (the agent page's org
 * branch) edit identically. Both upload a logo (own-org `foaf:logo`, contact
 * `vcard:logo`); only the save backend + surrounding chrome differ, so only these
 * fields live here. The own-org surface shows the name as a row (`showName`); the
 * agent page carries it in the page heading instead.
 */

/** The org logo lockup (landscape → contain, not crop). */
export function OrgLogoAvatar({ src }: { src?: string }) {
  return (
    <Avatar
      src={src}
      alt={msg("orgLogoAlt")}
      variant="rounded"
      sx={{ width: 160, height: 48, "& .MuiAvatar-img": { objectFit: "contain" } }}
    />
  );
}

/** Read view: the org's logo + (optionally) name, homepage and cross-reference rows. */
export function OrgReadView(
  { logoUrl, name, homepage, sameAs, showName }: {
    logoUrl?: string;
    name?: string;
    homepage?: string;
    sameAs?: string;
    showName?: boolean;
  },
) {
  return (
    <Stack spacing={1}>
      {logoUrl && <OrgLogoAvatar src={logoUrl} />}
      {showName && name && (
        <DetailRow label={msg("lblCompanyName")} value={name} />
      )}
      {homepage && (
        <DetailRow
          label={msg("lblHomepageUri")}
          value={<UriLink href={homepage}>{homepage}</UriLink>}
        />
      )}
      {sameAs && (
        <DetailRow
          label={msg("lblOrgWebId")}
          value={<UriLink href={sameAs}>{sameAs}</UriLink>}
        />
      )}
    </Stack>
  );
}

/**
 * Controlled edit form for an org's fields. The parent owns the field state (so it
 * can compose this with its own name/kind chrome); this component owns only the logo
 * picker — the picked file's object-URL preview + its revoke-on-unmount — and reports
 * the chosen `File` (or null to keep the current logo) via `onPickLogo`.
 */
export function OrgEditor(
  { name, onName, homepage, onHomepage, sameAs, onSameAs, showName, logoUrl, onPickLogo }: {
    name?: string;
    onName?: (v: string) => void;
    homepage: string;
    onHomepage: (v: string) => void;
    sameAs: string;
    onSameAs: (v: string) => void;
    showName?: boolean;
    logoUrl?: string;
    onPickLogo: (f: File | null) => void;
  },
) {
  const { showNotification } = useNotification();
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke the object URL of a previewed-but-unsaved logo on unmount.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedLogoType(file)) {
      showNotification(msg("chooseImageType"), "warning");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    onPickLogo(file);
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <OrgLogoAvatar src={preview ?? logoUrl ?? undefined} />
        <Box>
          <Button onClick={() => fileInputRef.current?.click()}>
            {msg("orgChooseLogo")}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {msg("orgLogoFormats")}
          </Typography>
        </Box>
        <input
          ref={fileInputRef}
          type="file"
          accept={LOGO_ACCEPT}
          style={{ display: "none" }}
          onChange={handlePickFile}
        />
      </Box>
      {showName && (
        <TextField
          label={msg("lblCompanyName")}
          value={name ?? ""}
          onChange={(e) => onName?.(e.target.value)}
          fullWidth
          size="small"
        />
      )}
      <TextField
        label={msg("lblHomepageUri")}
        type="url"
        placeholder="https://example.com/"
        value={homepage}
        onChange={(e) => onHomepage(e.target.value)}
        fullWidth
        size="small"
      />
      <TextField
        label={msg("lblOrgWebId")}
        type="url"
        placeholder="https://example.com/profile/card#me"
        value={sameAs}
        onChange={(e) => onSameAs(e.target.value)}
        helperText={msg("orgWebIdHelp")}
        fullWidth
        size="small"
      />
    </Stack>
  );
}
