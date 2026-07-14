import { useT } from "../context/I18nProvider.tsx";
import { getGateway } from "../hooks/session.ts";
import { useMemo, useState } from "react";
import {
  Alert,
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
import { getCurrentRoom, getMembersByRole } from "../services/interop/dataRoom.ts";
import { useShareBuilding } from "../hooks/mutations.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import type { AttachmentRef, Building, UserRole } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import RecipientAutocomplete from "./RecipientAutocomplete.tsx";
import { ShareRecipientsPreview, ShareSuccessAlert } from "./ShareFlow.tsx";
import { roleLabel, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";


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
  const t = useT();
  const { showNotification } = useNotification();
  // Roles selectable as a sharing target (resolved to member WebIDs via the
  // data room). Labelled per render so a locale switch re-labels them (a
  // module-level list froze the labels at first load).
  const shareRoleOptions: { value: UserRole; label: string }[] = ROOM_ROLE_OPTIONS
    .map((value) => ({ value, label: roleLabel(value) }));
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
  // null = untouched → "all" stays DERIVED from the live attachment list, so
  // attachments that finish loading after the dialog mounted are still included
  // (a state snapshot at mount silently excluded them). First user tick pins
  // the explicit subset.
  const [pickedAttachments, setPickedAttachments] = useState<string[] | null>(
    null,
  );
  const selectedAttachments = pickedAttachments ?? attachments.map((a) => a.uri);
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
        setWebIdError(t("shareEnterOneWebId"));
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
        setWebIdError(t("shareSelfError"));
        return;
      }
      setWebIdError("");
      setRecipients(webIds);
      setConfirmStep(true);
      return;
    }

    // Role mode: resolve the chosen role to member WebIDs via the data room.
    if (!targetRole) {
      setWebIdError(t("shareSelectRole"));
      return;
    }
    setResolving(true);
    setWebIdError("");
    try {
      const resolved = await getMembersByRole(
        await getCurrentRoom(getGateway()),
        targetRole,
        getGateway(),
      );
      if (resolved.length === 0) {
        setWebIdError(t("shareNoRoleMembers"));
        return;
      }
      setRecipients(resolved);
      setConfirmStep(true);
    } catch (error) {
      setWebIdError(
        t("shareRoleLoadError", {
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
          showNotification(t("buildingShared"), "success"),
        // Back to the form step, where the inline error Alert renders.
        onError: () => setConfirmStep(false),
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Nothing left to discard once the share succeeded — closing the success
      // screen must not raise the discard confirm.
      dirty={!shareSuccess &&
        (webIds.length > 0 || recipients.length > 0 || targetRole !== "")}
      // Role resolution is as in-flight as the share itself: closing mid-resolve
      // would drop its result on an unmounted dialog.
      busy={sharing || resolving}
      title={t("shareBuildingTitle")}
      actions={sharing
        ? undefined
        : shareSuccess
        ? <Button onClick={onClose} variant="contained">{t("btnDone")}</Button>
        : !confirmStep
        ? (
          <>
            <Button onClick={onClose}>{t("btnCancel")}</Button>
            <Button
              onClick={handleProceedToConfirm}
              variant="contained"
              disabled={resolving ||
                (shareMode === "webid" ? webIds.length === 0 : !targetRole) ||
                (shareScope === "years" && selectedYears.length === 0)}
            >
              {resolving ? t("shareResolving") : t("shareReviewAndShare")}
            </Button>
          </>
        )
        : (
          <>
            <Button onClick={() => setConfirmStep(false)}>{t("btnBack")}</Button>
            <Button onClick={handleShare} variant="contained">
              {t("shareConfirmShare")}
            </Button>
          </>
        )}
    >
      {sharing && (
        <Typography variant="body2" color="text.secondary">{t("shareInProgress")}</Typography>
      )}

      {!sharing && shareSuccess && (
        <ShareSuccessAlert label={t("shareSuccessWith")} recipients={recipients} />
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
              <ToggleButton value="webid">{t("shareByWebId")}</ToggleButton>
              <ToggleButton value="role">{t("shareByRole")}</ToggleButton>
            </ToggleButtonGroup>

            {shareMode === "webid"
              ? (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    {t("shareWebIdHint")}
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
                    {t("shareRoleHint")}
                  </Typography>
                  <FormControl fullWidth error={!!webIdError}>
                    <InputLabel id="share-role-label">{t("lblRole")}</InputLabel>
                    <Select
                      labelId="share-role-label"
                      label={t("lblRole")}
                      value={targetRole}
                      onChange={(e) => {
                        setTargetRole(e.target.value as UserRole);
                        if (webIdError) setWebIdError("");
                      }}
                    >
                      {shareRoleOptions.map((opt) => (
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
              <FormLabel component="legend">{t("shareWhatToShare")}</FormLabel>
              <RadioGroup
                value={shareScope}
                onChange={(e) =>
                  setShareScope(e.target.value as ShareScope)}
              >
                <FormControlLabel
                  value="static"
                  control={<Radio />}
                  label={t("shareScopeStatic")}
                />
                <FormControlLabel
                  value="all"
                  control={<Radio />}
                  label={t("shareScopeAll")}
                />
                <FormControlLabel
                  value="years"
                  control={<Radio />}
                  label={t("shareScopeYears")}
                  disabled={availableYears.length === 0}
                />
              </RadioGroup>
              {shareScope === "years" && (
                availableYears.length === 0
                  ? (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {t("shareNoYearDatasets")}
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
                  {t("shareAttachmentsLabel")}
                </FormLabel>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5 }}
                >
                  {t("shareAttachmentsHint")}
                </Typography>
                <FormGroup sx={{ mt: 1 }}>
                  {attachments.map((a) => (
                    <FormControlLabel
                      key={a.uri}
                      control={
                        <Checkbox
                          checked={selectedAttachments.includes(a.uri)}
                          onChange={(e) =>
                            setPickedAttachments(
                              e.target.checked
                                ? [...selectedAttachments, a.uri]
                                : selectedAttachments.filter((u) => u !== a.uri),
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
            <ShareRecipientsPreview
              label={
                <Typography variant="body2" color="text.secondary">
                  {shareMode === "role"
                    ? t("shareConfirmWithRoleCount", { count: recipients.length })
                    : t("shareConfirmWith")}
                </Typography>
              }
              recipients={recipients}
            />
            <Typography variant="body2">
              <strong>{t("shareIncludes")}</strong> {shareScope === "static"
                ? t("shareScopeStatic")
                : shareScope === "all"
                ? t("shareScopeAll")
                : t("shareScopeYearsSummary", {
                  years: [...selectedYears].sort((a, b) => a - b).join(", "),
                })}
            </Typography>
            {attachments.length > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                <strong>{t("shareAttachmentsLabel")}:</strong>{" "}
                {allAttachmentsSelected
                  ? t("shareAttachmentsAllSummary")
                  : selectedAttachments.length === 0
                  ? t("shareAttachmentsSubsetSummary", { names: "—" })
                  : t("shareAttachmentsSubsetSummary", {
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
