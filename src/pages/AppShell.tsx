import { type PodGateway } from "../services/pod/podGateway.ts";
import { getGateway } from "../hooks/session.ts";
import { useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import SearchIcon from "@mui/icons-material/Search";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useNotification } from "../context/NotificationContext.tsx";
import { Session } from "@inrupt/solid-client-authn-browser";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PersonIcon from "@mui/icons-material/Person";
import Footer from "../components/Footer.tsx";
import AccountMenu from "../components/AccountMenu.tsx";
import OnboardingBanner from "../components/OnboardingBanner.tsx";
import { useT } from "../context/I18nProvider.tsx";
import NetworkActivityIndicator from "../components/NetworkActivityIndicator.tsx";
import NotificationLogIndicator from "../components/NotificationLogIndicator.tsx";
import CommandPalette, { OPEN_PALETTE_EVENT } from "../components/CommandPalette.tsx";
import ActivityScreen from "../components/ActivityScreen.tsx";
import { getAvatarObjectUrl } from "../services/organisation/logo.ts";
import { getOrgLogoObjectUrl } from "../services/organisation/organisation.ts";
import { useAvatarRefresh } from "../lib/avatarRefresh.ts";
import { useDemoOffer, useSharedWithMe } from "../hooks/queries.ts";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import { type MessageId, msg } from "../lib/messages.ts";
import { DETAIL_PATTERNS, FINDERS } from "../routes.ts";
import {
  useSeedDemoBuildings,
  useSeedDemoAgents,
  useDeclineDemoOffer,
  useSeedDemoRooms,
} from "../hooks/mutations.ts";
import { useAccountActions } from "../hooks/useAccountActions.ts";

interface AppShellProps {
  session: Session;
  onLogout: (
    opts?: { suppressAutoLogin?: boolean; logoutType?: "app" | "idp" },
  ) => void;
}

/**
 * The finder routes, in top-nav order. Each is a routed finder page; the
 * shell's `<Outlet/>` renders the active one. The active finder is read from the
 * pathname (no `?tab=` state — the route IS the active finder). The Buildings
 * map is a pure finder: a marker click navigates to the building's detail page
 * (`/building/:id`), like a List row.
 *
 * Aggregations lost its tab in Step 2 of `plans/plan-cube-centered-ui.md`: saved
 * views are a *projection* of Explore now (`/observations?view=aggregations`),
 * reached by its view switcher — `/aggregations` redirects there.
 */
const NAV: { labelId: MessageId; path: string }[] = [
  { labelId: "navBuildings", path: FINDERS.buildings },
  { labelId: "navObservations", path: FINDERS.observations },
  { labelId: "navAgents", path: FINDERS.agents },
  { labelId: "navSharing", path: FINDERS.sharing },
  { labelId: "navMeet", path: FINDERS.rooms },
];

/**
 * Owns the object-URL lifecycle for a profile image (personal avatar or
 * organisation logo): loads on mount / session change and re-loads when
 * `version` is bumped (after the organisation dialog saves); the cleanup
 * revokes the URL the run loaded, covering both replace and unmount. A run
 * cancelled mid-fetch revokes its own URL instead of setting it, so nothing
 * leaks.
 */
function useProfileImageUrl(
  session: Session,
  version: number,
  load: (gateway: PodGateway) => Promise<string | null>,
  action: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: string | null = null;
    load(getGateway())
      .then((loaded) => {
        if (cancelled) {
          if (loaded) URL.revokeObjectURL(loaded);
          return;
        }
        current = loaded;
        setUrl(loaded);
      })
      .catch((err) => logError(action, err));
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [session, version, load, action]);
  return url;
}

/**
 * The persistent app chrome for the five finder routes: a route-driven top-nav,
 * the account header (org logo + avatar, account menu, dev-mode toggle and
 * dev-only account actions), the fresh-Pod demo banner, and a react-router
 * `<Outlet/>` for the active finder. Mounts only on the finder routes — the
 * standalone detail routes (`/building/:id`, …) render shell-less.
 */
export default function AppShell({ session, onLogout }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // The active finder is the longest NAV path the pathname starts with; default
  // to Buildings (the route table redirects "/" to /buildings, so this is just a
  // safety net). MUI `Tabs` needs a value present in its <Tab>s, so fall back to
  // the Buildings path rather than `false` (which would render no active tab).
  const activePath =
    NAV.find((n) => location.pathname === n.path)?.path ?? FINDERS.buildings;

  const t = useT();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { showNotification } = useNotification();

  // Header images, top-right: the organisation logo (foaf:logo on the <#org>
  // node) when one is set, then the person's own avatar (foaf:img /
  // vcard:hasPhoto) if set, else a PersonIcon. The avatar is always the user's
  // identity; the logo is the organisation's. Both re-load when `avatarVersion`
  // bumps — set from the Organisation page on save via a module store (that page is
  // a shell-less route, so it can't bump shell state directly — see avatarRefresh.ts).
  const avatarVersion = useAvatarRefresh();
  const avatarUrl = useProfileImageUrl(
    session,
    avatarVersion,
    getAvatarObjectUrl,
    "load avatar",
  );
  const orgLogoUrl = useProfileImageUrl(
    session,
    avatarVersion,
    getOrgLogoObjectUrl,
    "load organisation logo",
  );

  // Fresh-Pod demo-buildings offer (non-blocking banner): shown when the user's own
  // buildings container is absent/empty and the demo hasn't been declined. The
  // probe is a query (useDemoOffer); a session-local "dismissed" flag layers over
  // it so seeding/declining hides the banner instantly without a re-probe. The
  // declined choice persists in prefs.ttl, so it doesn't nag on every login.
  const demoOffer = useDemoOffer();
  const [demoDismissed, setDemoDismissed] = useState(false);
  const demoShow = (demoOffer.data ?? false) && !demoDismissed;
  // "No buildings yet" would mislead someone who has buildings SHARED with them
  // (they do have buildings to explore — just none of their own), so the offer
  // also waits for the shared-in fold and stands down if any shares exist. The
  // query is warm: the buildings load already depends on the same fold.
  const sharedWithMeQuery = useSharedWithMe();
  // `data` defined ⇔ the underlying folds resolved (the composite hook has no
  // isSuccess); undefined-while-loading keeps the banner down, no flash.
  const nothingShared = sharedWithMeQuery.data !== undefined &&
    sharedWithMeQuery.data.length === 0;

  /**
   * Seed the fixed demo building(s) — banner & menu share this. The hook owns
   * execution + the buildings invalidation (energy follows: useEnergy fans out a
   * per-building query over the set); the seeder is best-effort per building (it never
   * throws for one), so the tally is the only place a partial failure
   * surfaces — rendered honestly here. Thrown errors toast centrally.
   */
  const seedBuildingsMut = useSeedDemoBuildings();
  const seedDemos = () =>
    seedBuildingsMut.mutate(undefined, {
      onSuccess: ({ done: seeded, total }) => {
        if (seeded === total) {
          setDemoDismissed(true);
          showNotification(msg("demoBuildingsAdded"), "success");
        } else if (seeded > 0) {
          setDemoDismissed(true);
          showNotification(
            msg("demoBuildingsPartial", { seeded, total }),
            "warning",
          );
        } else {
          showNotification(
            formatError(
              "actionAddDemoBuildings",
              new Error("no building could be written"),
            ),
            "error",
          );
        }
      },
    });

  // Dev-mode Connect-tab demo data — the contacts/rooms counterpart of
  // `seedDemos` (the seeders tally partial success the same way).
  const seedAgentsMut = useSeedDemoAgents();
  const seedRoomsMut = useSeedDemoRooms();
  const seedDemoAgentsClick = () =>
    seedAgentsMut.mutate(undefined, {
      onSuccess: ({ done: seeded, total }) =>
        showNotification(
          seeded === total
            ? msg("demoAgentsAdded")
            : msg("demoAgentsPartial", { seeded, total }),
          seeded === total ? "success" : "warning",
        ),
    });
  const seedDemoRoomsClick = () =>
    seedRoomsMut.mutate(undefined, {
      onSuccess: ({ rooms, total }) =>
        showNotification(
          rooms.length === total
            ? msg("demoRoomsAdded")
            : msg("demoRoomsPartial", { rooms: rooms.length, total }),
          rooms.length === total ? "success" : "warning",
        ),
    });

  const declineDemo = useDeclineDemoOffer();
  const declineDemos = () => {
    setDemoDismissed(true); // optimistic: the banner hides immediately
    declineDemo.mutate();
  };

  const handleOrganisation = () => {
    handleMenuClose();
    void navigate(DETAIL_PATTERNS.organisation);
  };

  const menuOpen = Boolean(anchorEl);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    handleMenuClose();
    onLogout();
  };

  // Full logout AT the identity provider (clears its login cookie), so the next
  // login shows the account chooser instead of silently reusing this account —
  // the only way to switch accounts. Plain "Logout" leaves the IdP session intact.
  const handleChangeAccount = () => {
    handleMenuClose();
    onLogout({ logoutType: "idp" });
  };

  // The dev-mode account operations (archive, sharing audit/repair, remove-all)
  // live in their own hook; the shell only supplies its two state touch-points.
  const {
    archiveInput,
    handleDownloadArchive,
    handleArchiveFile,
    handleAuditGrants,
    handleCheckObsLinks,
    handleReissueGrants,
    handleRemoveAppData,
    handleCancelRemove,
    accountBusy,
    removing,
  } = useAccountActions(session, {
    onMenuClose: handleMenuClose,
    onResetOnboarding: () => setDemoDismissed(false),
  });

  const handleProfile = () => {
    handleMenuClose();
    if (session.info.webId) {
      globalThis.open(session.info.webId, "_blank", "noopener,noreferrer");
    }
  };

  // While wiping the Pod, take over the screen so the user sees the deletions
  // in flight and can cancel — rather than the app shell sitting there.
  if (removing) {
    return (
      <ActivityScreen
        title={msg("removingAllData")}
        onCancel={handleCancelRemove}
      />
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Tabs
          value={activePath}
          onChange={(_e, path) => navigate(path)}
          centered
        >
          {NAV.map((n) => (
            <Tab key={n.path} label={t(n.labelId)} value={n.path} />
          ))}
        </Tabs>
        <Box
          sx={{
            marginLeft: "auto",
            mr: 2,
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <NetworkActivityIndicator />
          <NotificationLogIndicator />
          <Tooltip title={t("paletteOpenAria")}>
            <IconButton
              size="small"
              aria-label={t("paletteOpenAria")}
              onClick={() =>
                globalThis.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT))}
            >
              <SearchIcon />
            </IconButton>
          </Tooltip>
          {orgLogoUrl && (
            <Box
              component="img"
              src={orgLogoUrl}
              alt={t("orgLogoAlt")}
              sx={{ height: 40, maxWidth: 120, objectFit: "contain" }}
            />
          )}
          <Tooltip title={session.info.webId ?? t("menuAccountAria")}>
            <IconButton
              onClick={handleMenuOpen}
              aria-label={session.info.webId
                ? `${t("menuAccountAria")} — ${session.info.webId}`
                : t("menuAccountAria")}
              sx={{ p: 0 }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                sx={{
                  bgcolor: "primary.main",
                  width: 40,
                  height: 40,
                }}
              >
                <PersonIcon />
              </Avatar>
            </IconButton>
          </Tooltip>
          <AccountMenu
            anchorEl={anchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            onProfile={handleProfile}
            onOrganisation={handleOrganisation}
            onSeedBuildings={seedDemos}
            seedBuildingsBusy={seedBuildingsMut.isPending}
            onSeedConnect={() => {
              seedDemoAgentsClick();
              seedDemoRoomsClick();
            }}
            seedConnectBusy={seedAgentsMut.isPending || seedRoomsMut.isPending}
            onDownloadArchive={handleDownloadArchive}
            onImportArchive={() => archiveInput.current?.click()}
            onAuditGrants={handleAuditGrants}
            onCheckObsLinks={handleCheckObsLinks}
            onReissueGrants={handleReissueGrants}
            accountBusy={accountBusy}
            onRemoveAppData={handleRemoveAppData}
            onDataSources={() => {
              handleMenuClose();
              void navigate(DETAIL_PATTERNS.dataSources);
            }}
            onChangeAccount={handleChangeAccount}
            onLogout={handleLogout}
          />
        </Box>
      </Box>
      {/* Hidden picker for the dev-mode "Import archive…" menu item. */}
      <input
        ref={archiveInput}
        type="file"
        accept=".zip,application/zip"
        style={{ display: "none" }}
        onChange={handleArchiveFile}
      />
      {/* Fresh-Pod onboarding: offer the demo buildings instead of writing them
          silently. Non-blocking (the app stays usable); dismissing it persists. */}
      <OnboardingBanner
        show={demoShow && nothingShared}
        busy={seedBuildingsMut.isPending}
        onSeed={seedDemos}
        onDecline={declineDemos}
      />
      {/* The active finder renders here. BuildingsMap (the Buildings map) is kept
          mounted via BuildingsFinder's own display:none trick, so a switch among
          the OTHER finders unmounts the map — returning to /buildings re-inits the
          Leaflet instance (the map's intra-finder Map⇄List toggle preserves it). */}
      <Box sx={{ flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </Box>
      <Box sx={{ flexShrink: 0 }}>
        <Footer />
      </Box>
      {/* The global ⌘K command palette — reads the intent registry, scoped to the
          focused object (via PaletteFocusProvider) plus the navigation verbs. */}
      <CommandPalette />
    </Box>
  );
}
