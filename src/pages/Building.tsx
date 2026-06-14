import { Divider, Stack } from "@mui/material";
import type { BuildingType } from "../types.ts";
import { getSession } from "../hooks/session.ts";
import BuildingHeader from "../components/building/BuildingHeader.tsx";
import MasterDataSection from "../components/building/MasterDataSection.tsx";
import EnergySummarySection from "../components/building/EnergySummarySection.tsx";
import BuildingFilesSection from "../components/building/BuildingFilesSection.tsx";
import SharingSection from "../components/building/SharingSection.tsx";

interface BuildingProps {
  building: BuildingType;
  /** Retained for the route wrapper's call signature; the building page navigates back
   * via its own breadcrumb, so this is unused. */
  onHide?: () => void;
  /** Accepted for compatibility with the map detail-pane caller (ExplorePage),
   * which still renders this component embedded; the building page ignores them. */
  embedded?: boolean;
  hideHeader?: boolean;
}

/**
 * The BUILDING PAGE — the centerpiece of the app. A single scrolling column of
 * sections for one building: an identity header (breadcrumb, name, address,
 * producer attribution, owned/shared badge, locator thumbnail), read-first
 * master data with an inline editor, a compact energy summary linking to the
 * full energy page, the building's files (inline upload/download/certificate),
 * and the sharing status (who it's shared with, revoke, and a Share dialog).
 *
 * Every action is inline on the page; modals survive only for Share and for
 * destructive confirmations (revoke / file delete).
 */
export default function Building({ building }: BuildingProps) {
  // The page is reached through the authed app shell; the singleton session
  // drives the file download/upload and the share dialog.
  const session = getSession();

  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      <BuildingHeader building={building} />
      <MasterDataSection building={building} />
      <EnergySummarySection building={building} />
      <BuildingFilesSection building={building} session={session} />
      <SharingSection building={building} session={session} />
    </Stack>
  );
}
