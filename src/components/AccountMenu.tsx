import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import { setDevMode, useDevMode } from "../hooks/devMode.ts";
import { type Lang, setLanguage, useLanguage } from "../hooks/language.ts";
import { useT } from "../context/I18nProvider.tsx";

interface AccountMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** Identity (both modes). */
  onProfile: () => void;
  onOrganisation: () => void;
  /** Dev: demo fixtures. */
  onSeedConnect: () => void;
  seedConnectBusy: boolean;
  /** Dev: archive + sharing maintenance (share one busy flag — they must not interleave). */
  onDownloadArchive: () => void;
  onImportArchive: () => void;
  onAuditGrants: () => void;
  onCheckObsLinks: () => void;
  onReissueGrants: () => void;
  accountBusy: boolean;
  /** Dev: destructive. */
  onRemoveAppData: () => void;
  /** Foot of the menu (credits both modes; change-account dev-only). */
  onDataSources: () => void;
  onChangeAccount: () => void;
  onLogout: () => void;
}

/**
 * The account-header dropdown for {@link AppShell}: identity (Profile /
 * Organisation), the language switcher, the Developer-mode toggle, the dev-only
 * account actions (demo fixtures, archive import/export, sharing audit/repair,
 * destructive wipe), and the credits / logout foot. Presentational — every action
 * is a prop owned by the shell; only the locale and dev-mode signals (which it both
 * reads and toggles) are wired here directly.
 */
export default function AccountMenu({
  anchorEl,
  open,
  onClose,
  onProfile,
  onOrganisation,
  onSeedConnect,
  seedConnectBusy,
  onDownloadArchive,
  onImportArchive,
  onAuditGrants,
  onCheckObsLinks,
  onReissueGrants,
  accountBusy,
  onRemoveAppData,
  onDataSources,
  onChangeAccount,
  onLogout,
}: AccountMenuProps) {
  const t = useT();
  const language = useLanguage();
  const devMode = useDevMode();
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      onClick={onClose}
      transformOrigin={{ horizontal: "right", vertical: "top" }}
      anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      slotProps={{
        paper: {
          elevation: 0,
          sx: {
            // Cap to the viewport and scroll when the menu (long in Developer
            // mode) would otherwise overflow below the fold — leaving its last
            // items unreachable on a short window. The drop-shadow filter still
            // renders outside the box, so no `overflow: visible` is needed.
            maxHeight: "calc(100vh - 96px)",
            overflowY: "auto",
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
            mt: 1.5,
            minWidth: 180,
          },
        },
      }}
    >
      {/* Identity */}
      <MenuItem onClick={onProfile}>
        {t("menuProfile")}
      </MenuItem>
      <MenuItem onClick={onOrganisation}>
        {t("menuOrganisation")}
      </MenuItem>

      {/* Language switcher — a fixed entry (the one active-locale signal also
          drives the vocab labels). Keep the menu open while choosing. */}
      <Divider />
      <MenuItem
        onClick={(e) => e.stopPropagation()}
        disableRipple
        sx={{ justifyContent: "space-between", gap: 2 }}
      >
        {t("uiLanguage")}
        <Select
          size="small"
          value={language}
          onChange={(e) => setLanguage(e.target.value as Lang)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("uiLanguage")}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="de">Deutsch</MenuItem>
          <MenuItem value="en">English</MenuItem>
          <MenuItem value="fr">Français</MenuItem>
        </Select>
      </MenuItem>

      {/* Developer-mode toggle — fixed third entry, present in both modes */}
      <Divider />
      <MenuItem
        // Keep the menu open and flip the switch in place — this toggles a
        // setting rather than running an action, so don't dismiss.
        onClick={(e) => {
          e.stopPropagation();
          setDevMode(!devMode);
        }}
        sx={{ justifyContent: "space-between", gap: 2 }}
      >
        {t("menuDevMode")}
        <Switch edge="end" size="small" checked={devMode} tabIndex={-1} />
      </MenuItem>

      {/* Dev: demo fixtures */}
      {devMode && <Divider />}
      {devMode && (
        <MenuItem
          onClick={onSeedConnect}
          disabled={seedConnectBusy}
        >
          {seedConnectBusy
            ? t("addingEllipsis")
            : t("menuAddAgents")}
        </MenuItem>
      )}

      {/* Dev: archive */}
      {devMode && <Divider />}
      {devMode && (
        <MenuItem onClick={onDownloadArchive} disabled={accountBusy}>
          {accountBusy ? t("filesWorking") : t("menuExportArchive")}
        </MenuItem>
      )}
      {devMode && (
        <MenuItem
          onClick={onImportArchive}
          disabled={accountBusy}
        >
          {t("menuImportArchive")}
        </MenuItem>
      )}

      {/* Dev: sharing maintenance */}
      {devMode && <Divider />}
      {devMode && (
        <MenuItem onClick={onAuditGrants} disabled={accountBusy}>
          {t("menuCheckConsistency")}
        </MenuItem>
      )}
      {devMode && (
        <MenuItem onClick={onCheckObsLinks} disabled={accountBusy}>
          {t("menuCheckObsLinks")}
        </MenuItem>
      )}
      {devMode && (
        <MenuItem onClick={onReissueGrants} disabled={accountBusy}>
          {t("menuRebuildSharing")}
        </MenuItem>
      )}

      {/* Dev: documentation */}
      {devMode && <Divider />}
      {devMode && (
        <MenuItem
          component="a"
          href={`${import.meta.env.BASE_URL}granergize-handbuch.docx`}
        >
          {t("menuHandbuch")}
        </MenuItem>
      )}

      {/* Dev: destructive */}
      {devMode && <Divider />}
      {devMode && (
        <MenuItem
          onClick={onRemoveAppData}
          sx={{ color: "error.main" }}
        >
          {t("menuRemoveAll")}
        </MenuItem>
      )}

      {/* Data sources & licences (credits, both modes) sit with Logout at the
          foot of the menu, so the credits stay next to Logout in dev mode too
          rather than being buried above the dev sections. */}
      <Divider />
      <MenuItem onClick={onDataSources}>
        {t("menuDataSources")}
      </MenuItem>
      {devMode && (
        <MenuItem onClick={onChangeAccount}>
          {t("menuChangeAccount")}
        </MenuItem>
      )}
      <MenuItem onClick={onLogout}>
        {t("menuLogout")}
      </MenuItem>
    </Menu>
  );
}
