import { useEffect } from "react";
import { Divider, Stack } from "@mui/material";
import { useSearchParams } from "react-router-dom";
import type { BuildingType } from "../types.ts";
import { getSession } from "../hooks/session.ts";
import { ACTION_PARAM } from "../routes.ts";
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import { useToggleVisibility } from "../hooks/mutations.ts";
import BuildingHeader from "../components/building/BuildingHeader.tsx";
import MasterDataSection from "../components/building/MasterDataSection.tsx";
import SystemListSection from "../components/building/SystemListSection.tsx";
import ObservationsLink from "../components/building/ObservationsLink.tsx";
import RoofPlan from "../components/building/RoofPlan.tsx";
import RooftopPotentialSection from "../components/building/RooftopPotentialSection.tsx";
import BuildingFilesSection from "../components/building/BuildingFilesSection.tsx";
import SharingSection from "../components/building/SharingSection.tsx";

interface BuildingProps {
  building: BuildingType;
  /** Retained for the route wrapper's call signature; the building page navigates back
   * via its own breadcrumb, so this is unused. */
  onHide?: () => void;
  /** Accepted for compatibility with the map detail-pane caller (BuildingsMap),
   * which still renders this component embedded; the building page ignores them. */
  embedded?: boolean;
  hideHeader?: boolean;
}

/**
 * The BUILDING PAGE — the centerpiece of the app. A single scrolling column of
 * sections for one building: an identity header (breadcrumb, name, address,
 * producer attribution, owned/shared badge, locator thumbnail), read-first
 * master data with an inline editor, a link to the building's energy/observations
 * (the figures live on the observation page — building info stays here, observation
 * info there, the two only link), the building's own rooftop-PV potential + roof plan,
 * the building's files (inline upload/download/certificate), and the sharing status.
 *
 * Every action is inline on the page; modals survive only for Share and for
 * destructive confirmations (revoke / file delete).
 */
export default function Building({ building }: BuildingProps) {
  // The page is reached through the authed app shell; the singleton session
  // drives the file download/upload and the share dialog.
  const session = getSession();

  // A palette-routed rich verb arrives with `?action=edit|share`, which the
  // master-data / sharing sections open on mount (plan-palette §5).
  const [sp] = useSearchParams();
  const action = sp.get(ACTION_PARAM);

  // Register this building as the ⌘K palette's focused object, with the SIMPLE
  // (param-less) verbs the palette can fire directly: hide/unhide for a shared
  // building. Rich verbs (share/edit) carry no handler — the palette routes to
  // this page with `?action=…` instead. Clearing on unmount returns the palette
  // to navigation-only. (The hooks stay the implementation — `isPending`/central
  // toast/own invalidation all live in `useToggleVisibility`.)
  const { setFocus, clearFocus } = usePaletteFocus();
  const toggleVisibility = useToggleVisibility();
  useEffect(() => {
    setFocus({
      object: building,
      handlers: {
        ToggleVisibility: () =>
          toggleVisibility.mutate((building.sourceUri ?? building.uri) as string),
      },
    });
    return () => clearFocus();
    // Re-register whenever the focused building changes; the setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  return (
    <Stack spacing={3} divider={<Divider />} sx={{ width: "100%" }}>
      <BuildingHeader building={building} />
      <MasterDataSection building={building} autoOpenEdit={action === "edit"} />
      <SystemListSection building={building} group="energy" />
      <SystemListSection building={building} group="heat" />
      <ObservationsLink building={building} />
      <BuildingFilesSection building={building} session={session} />
      <SharingSection
        building={building}
        session={session}
        autoOpenShare={action === "share"}
      />
      <RoofPlan building={building} />
      <RooftopPotentialSection building={building} />
    </Stack>
  );
}
