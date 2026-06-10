import { useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  TextField,
  Typography,
} from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useNotification } from "../context/NotificationContext.tsx";
import Modal from "./Modal.tsx";
import { logError } from "../lib/logError.ts";
import { useSaveOrganization } from "../hooks/mutations.ts";
import {
  getOrganization,
  isSupportedLogoType,
  type Organization,
} from "../services/organization/organizationManager.ts";

interface OrganizationDialogProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh the avatar. */
  onSaved: () => void;
}

const ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp,image/gif";

/**
 * Edit the organisation the user works for (W3C Org `org:memberOf` → a `<#org>`
 * node in the WebID profile). Captures name, homepage, the org's own WebID, and
 * a logo. See organizationManager.ts for the data model.
 */
export default function OrganizationDialog(
  { open, session, onClose, onSaved }: OrganizationDialogProps,
) {
  const { showNotification } = useNotification();
  const [name, setName] = useState("");
  const [homepage, setHomepage] = useState("");
  const [sameAs, setSameAs] = useState("");
  const [initial, setInitial] = useState<Organization>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  // Busy state, error toast (central, classified) and the resolved-agent cache
  // invalidation come from the hook.
  const save = useSaveOrganization();
  const saving = save.isPending;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill from the Pod each time the dialog opens; revoke object URLs on close.
  useEffect(() => {
    if (!open) return;
    let revoke: string | null = null;
    getOrganization(session).then((org) => {
      const o = org ?? {};
      setInitial(o);
      setName(o.name ?? "");
      setHomepage(o.homepage ?? "");
      setSameAs(o.sameAs ?? "");
      setPickedFile(null);
      setPickedPreview(null);
      if (o.logoUrl) {
        session.fetch(o.logoUrl)
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => {
            if (b) {
              revoke = URL.createObjectURL(b);
              setLogoPreview(revoke);
            }
          })
          .catch((err) => logError("load organisation logo preview", err));
      } else {
        setLogoPreview(null);
      }
    }).catch((err) => logError("load organisation details", err));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [open, session]);

  const dirty = name !== (initial.name ?? "") ||
    homepage !== (initial.homepage ?? "") ||
    sameAs !== (initial.sameAs ?? "") ||
    pickedFile != null;

  const close = () => {
    if (pickedPreview) URL.revokeObjectURL(pickedPreview);
    onClose();
  };

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedLogoType(file)) {
      showNotification("Please choose a PNG, JPG, SVG, WEBP or GIF image", "warning");
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
          showNotification("Organisation saved", "success");
          onSaved();
          close();
        },
      },
    );

  const shownLogo = pickedPreview ?? logoPreview ?? undefined;

  return (
    <Modal
      open={open}
      onClose={close}
      dirty={dirty}
      busy={saving}
      title="Your organisation"
      actions={
        <>
          <Button onClick={close} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar
              src={shownLogo}
              alt="Organisation logo"
              variant="rounded"
              sx={{ width: 56, height: 56 }}
            />
            <Box>
              <Button onClick={() => fileInputRef.current?.click()}>
                Choose logo…
              </Button>
              <Typography variant="caption" color="text.secondary" display="block">
                PNG, JPG, SVG, WEBP or GIF
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
            label="Company name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <TextField
            label="Homepage URI"
            type="url"
            placeholder="https://example.com/"
            value={homepage}
            onChange={(e) => setHomepage(e.target.value)}
            fullWidth
          />
          <TextField
            label="Organisation WebID"
            type="url"
            placeholder="https://example.com/profile/card#me"
            value={sameAs}
            onChange={(e) => setSameAs(e.target.value)}
            helperText="If the company has its own WebID, link it here."
            fullWidth
          />
        </Box>
    </Modal>
  );
}
