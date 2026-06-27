import { sessionGateway } from "../services/pod/podGateway.ts";
import { msg } from "../lib/messages.ts";
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import Modal from "./Modal.tsx";
import { webIdsError } from "../lib/webId.ts";
import { getActiveRoom, getMembersByRole } from "../services/interop/dataRoom.ts";
import { useShareBuilding } from "../hooks/mutations.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import type { AttachmentRef, Building, UserRole } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { AgentChip } from "./AgentLabel.tsx";
import RecipientAutocomplete from "./RecipientAutocomplete.tsx";
import { roleLabel, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";

/**
 * Roles selectable as a sharing target (resolved to member WebIDs via the data
 * room). Derived from the central role lists so new roles surface here
 * automatically and can't drift.
 */
const SHARE_ROLE_OPTIONS: { value: UserRole; label: string }[] = ROOM_ROLE_OPTIONS
  .map((value) => ({ value, label: roleLabel(value) }));

/** What energy a share grants alongside the always-shared static building data. */
type ShareScope = "static" | "all" | "years";

interface ShareBuildingDialogProps {
  open: boolean;
  buildingUri: string;
  /** The building being shared — its energy datasets drive the per-year picker. */
  building: Building;
  session: Session;
  onClose: () => void;
}

export function ShareBuildingDialog({
  open,
  buildingUri,
  building,
  session,
  onClose,
}: ShareBuildingDialogProps) {
  const { showNotification } = useNotification();
  const [shareMode, setShareMode] = useState<"webid" | "role">("webid");
  const [webIds, setWebIds] = useState<string[]>([]);
  const [targetRole, setTargetRole] = useState<UserRole | "">("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("all");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  // The building's attachments and which are included in the share. Default =
  // ALL included (initialized to every attachment URI), mirroring the "all
  // years" default. A strict subset enumerates the included files; "all"
  // selected passes attachmentUris: undefined (the intensional "all" case).
  const attachments = useMemo(
    () => (building.attachments ?? []) as AttachmentRef[],
    [building.attachments],
  );
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>(
    () => attachments.map((a) => a.uri),
  );
  const allAttachmentsSelected = selectedAttachments.length === attachments.length;
  const [webIdError, setWebIdError] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  // The write goes through the (silent) mutation hook: busy/success/error are
  // its state; the error renders inline through the same classifier the central
  // toast would use, so the wording can't fork.
  const share = useShareBuilding();
  const sharing = share.isPending;
  const shareSuccess = share.isSuccess;
  const shareError = share.error ? classifyQueryError(share.error).message : "";

  // Years the building has energy for (annual + series, both scenarios), so a
  // single year-share grants every dataset for that year. getEnergyDataUris then
  // filters the building's cons:hasEnergyDataset links by this selection.
  const availableYears = useMemo(
    () =>
      [...new Set((building.energyDatasets ?? []).map((d) => d.year))]
        .sort((a, b) => a - b),
    [building.energyDatasets],
  );

  // Conditionally mounted per building (ManagePage gates on state), so closing
  // unmounts the dialog and React discards all of the state above — no manual
  // reset on close needed.
  const handleProceedToConfirm = async () => {
    if (shareMode === "webid") {
      if (webIds.length === 0) {
        setWebIdError(msg("shareEnterOneWebId"));
        return;
      }
      const err = webIdsError(webIds);
      if (err) {
        setWebIdError(err);
        return;
      }
      // Sharing to yourself is a no-op with a cost: it appends a permanently
      // active grant to shared-out/ (the revoke's removeFromACL self-no-ops, so
      // the pair can never fold away) and posts a pointless self-notification.
      // The role path already excludes self (getMembersByRole).
      if (webIds.includes(session.info.webId ?? "")) {
        setWebIdError(msg("shareSelfError"));
        return;
      }
      setWebIdError("");
      setRecipients(webIds);
      setConfirmStep(true);
      return;
    }

    // Role mode: resolve the chosen role to member WebIDs via the data room.
    if (!targetRole) {
      setWebIdError(msg("shareSelectRole"));
      return;
    }
    setResolving(true);
    setWebIdError("");
    try {
      const resolved = await getMembersByRole(
        getActiveRoom(),
        targetRole,
        sessionGateway(session),
      );
      if (resolved.length === 0) {
        setWebIdError(msg("shareNoRoleMembers"));
        return;
      }
      setRecipients(resolved);
      setConfirmStep(true);
    } catch (error) {
      setWebIdError(
        msg("shareRoleLoadError", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setResolving(false);
    }
  };

  const handleShare = () =>
    share.mutate(
      {
        buildingUri,
        recipients,
        includeEnergyData: shareScope !== "static",
        years: shareScope === "years" ? selectedYears : undefined,
        // All selected (or no attachments) ⇒ undefined = the intensional "all"
        // (grant the files/ container, incl. future uploads). A strict subset ⇒
        // enumerate the included file IRIs.
        attachmentUris: allAttachmentsSelected ? undefined : selectedAttachments,
      },
      {
        onSuccess: () =>
          showNotification(msg("buildingShared"), "success"),
        // Back to the form step, where the inline error Alert renders.
        onError: () => setConfirmStep(false),
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={webIds.length > 0 || recipients.length > 0 || targetRole !== ""}
      busy={sharing}
      title={msg("shareBuildingTitle")}
      actions={sharing
        ? undefined
        : shareSuccess
        ? <Button onClick={onClose} variant="contained">{msg("btnDone")}</Button>
        : !confirmStep
        ? (
          <>
            <Button onClick={onClose}>{msg("btnCancel")}</Button>
            <Button
              onClick={handleProceedToConfirm}
              variant="contained"
              disabled={resolving ||
                (shareMode === "webid" ? webIds.length === 0 : !targetRole) ||
                (shareScope === "years" && selectedYears.length === 0)}
            >
              {resolving ? msg("shareResolving") : msg("shareReviewAndShare")}
            </Button>
          </>
        )
        : (
          <>
            <Button onClick={() => setConfirmStep(false)}>{msg("btnBack")}</Button>
            <Button onClick={handleShare} variant="contained">
              {msg("shareConfirmShare")}
            </Button>
          </>
        )}
    >
      {sharing && (
        <Typography variant="body2" color="text.secondary">{msg("shareInProgress")}</Typography>
      )}

      {!sharing && shareSuccess && (
        <Alert severity="success">
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            {msg("shareSuccessWith")}{" "}
            {recipients.map((r) => (
              <AgentChip key={r} value={r} size="small" variant="outlined" />
            ))}
          </Box>
        </Alert>
      )}

      {!sharing && !shareSuccess && !confirmStep && (
        <>
            {/* A failed share lands back here — persistent, in-context (the
                Alert carve-out); the hook is silent so there's no double toast. */}
            {shareError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {shareError}
              </Alert>
            )}
            <ToggleButtonGroup
              value={shareMode}
              exclusive
              size="small"
              sx={{ mb: 2 }}
              onChange={(_e, value) => {
                if (value) {
                  setShareMode(value);
                  setWebIdError("");
                }
              }}
            >
              <ToggleButton value="webid">{msg("shareByWebId")}</ToggleButton>
              <ToggleButton value="role">{msg("shareByRole")}</ToggleButton>
            </ToggleButtonGroup>

            {shareMode === "webid"
              ? (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    {msg("shareWebIdHint")}
                  </Typography>
                  <RecipientAutocomplete
                    value={webIds}
                    onChange={(next) => {
                      setWebIds(next);
                      if (webIdError) setWebIdError("");
                    }}
                    error={webIdError}
                    autoFocus
                  />
                </>
              )
              : (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    {msg("shareRoleHint")}
                  </Typography>
                  <FormControl fullWidth error={!!webIdError}>
                    <InputLabel id="share-role-label">{msg("lblRole")}</InputLabel>
                    <Select
                      labelId="share-role-label"
                      label={msg("lblRole")}
                      value={targetRole}
                      onChange={(e) => {
                        setTargetRole(e.target.value as UserRole);
                        if (webIdError) setWebIdError("");
                      }}
                    >
                      {SHARE_ROLE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                    {webIdError && (
                      <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                        {webIdError}
                      </Typography>
                    )}
                  </FormControl>
                </>
              )}
            <FormControl component="fieldset" sx={{ mt: 3 }}>
              <FormLabel component="legend">{msg("shareWhatToShare")}</FormLabel>
              <RadioGroup
                value={shareScope}
                onChange={(e) =>
                  setShareScope(e.target.value as ShareScope)}
              >
                <FormControlLabel
                  value="static"
                  control={<Radio />}
                  label={msg("shareScopeStatic")}
                />
                <FormControlLabel
                  value="all"
                  control={<Radio />}
                  label={msg("shareScopeAll")}
                />
                <FormControlLabel
                  value="years"
                  control={<Radio />}
                  label={msg("shareScopeYears")}
                  disabled={availableYears.length === 0}
                />
              </RadioGroup>
              {shareScope === "years" && (
                availableYears.length === 0
                  ? (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {msg("shareNoYearDatasets")}
                    </Alert>
                  )
                  : (
                    <FormGroup sx={{ pl: 4, mt: 1 }}>
                      {availableYears.map((year) => (
                        <FormControlLabel
                          key={year}
                          control={
                            <Checkbox
                              checked={selectedYears.includes(year)}
                              onChange={(e) =>
                                setSelectedYears((prev) =>
                                  e.target.checked
                                    ? [...prev, year]
                                    : prev.filter((y) => y !== year)
                                )}
                            />
                          }
                          label={String(year)}
                        />
                      ))}
                    </FormGroup>
                  )
              )}
            </FormControl>
            {attachments.length > 0 && (
              <FormControl component="fieldset" sx={{ mt: 3 }}>
                <FormLabel component="legend">
                  {msg("shareAttachmentsLabel")}
                </FormLabel>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {msg("shareAttachmentsHint")}
                </Typography>
                <FormGroup sx={{ mt: 1 }}>
                  {attachments.map((a) => (
                    <FormControlLabel
                      key={a.uri}
                      control={
                        <Checkbox
                          checked={selectedAttachments.includes(a.uri)}
                          onChange={(e) =>
                            setSelectedAttachments((prev) =>
                              e.target.checked
                                ? [...prev, a.uri]
                                : prev.filter((u) => u !== a.uri)
                            )}
                        />
                      }
                      label={a.filename}
                    />
                  ))}
                </FormGroup>
              </FormControl>
            )}
        </>
      )}

      {!sharing && !shareSuccess && confirmStep && (
        <>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {shareMode === "role"
                ? msg("shareConfirmWithRoleCount", { count: recipients.length })
                : msg("shareConfirmWith")}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
              {recipients.map((r) => (
                <AgentChip key={r} value={r} size="small" variant="outlined" />
              ))}
            </Box>
            <Typography variant="body2">
              <strong>{msg("shareIncludes")}</strong> {shareScope === "static"
                ? msg("shareScopeStatic")
                : shareScope === "all"
                ? msg("shareScopeAll")
                : msg("shareScopeYearsSummary", {
                  years: [...selectedYears].sort((a, b) => a - b).join(", "),
                })}
            </Typography>
            {attachments.length > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                <strong>{msg("shareAttachmentsLabel")}:</strong>{" "}
                {allAttachmentsSelected
                  ? msg("shareAttachmentsAllSummary")
                  : selectedAttachments.length === 0
                  ? msg("shareAttachmentsSubsetSummary", { names: "—" })
                  : msg("shareAttachmentsSubsetSummary", {
                    names: attachments
                      .filter((a) => selectedAttachments.includes(a.uri))
                      .map((a) => a.filename)
                      .join(", "),
                  })}
              </Typography>
            )}
        </>
      )}
    </Modal>
  );
}
