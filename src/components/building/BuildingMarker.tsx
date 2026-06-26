import { msg } from "../../lib/messages.ts";
import { buildingDisplayName } from "../../lib/buildingDisplay.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import { BuildingType } from "../../types.ts";
import { Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import Box from "@mui/material/Box";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import { useResolveAgent, useResolveOrg } from "../../hooks/queries.ts";
import { safeImageSrc } from "../../lib/safeHref.ts";
import type { LensBand } from "../../services/energy/energyTimeCut.ts";
import type { MetricFraming } from "../../services/energy/energyMetric.ts";
import { bandColor } from "../../constants/lensBand.ts";

/** What the map markers' colour encodes: ownership (owned/shared, the default) or
 * the energy band at the chosen year. The cube's `space=map` renderer; the `rows`
 * surfaces (List, over-time heatmap) live in the finder. (The trend lens and the
 * compare-years view were dropped.) */
export type MapLens = "ownership" | "energy";

/**
 * Energy-lens marker: a filled circle tinted by the building's energy **band** for
 * the selected metric — an efficiency tier (consumption) or a neutral magnitude
 * bucket (generation). Shown for EVERY building (not just those with a producer
 * logo) so the categorisation is always legible. The band is baked into the
 * `className` (`energy-marker energy-<band>`) so the e2e spec can assert it.
 */
const categoryIconCache = new Map<string, L.DivIcon>();
function createCategoryIcon(band: LensBand, framing: MetricFraming): L.DivIcon {
  const key = `${framing}:${band}`;
  const hit = categoryIconCache.get(key);
  if (hit) return hit;
  const shadow = "box-shadow:0 1px 4px rgba(0,0,0,0.45);";
  const icon = L.divIcon({
    className: `energy-marker energy-${band}`,
    html:
      `<div style="width:28px;height:28px;border-radius:50%;background:${
        bandColor(band, framing)
      };border:3px solid #fff;${shadow}"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
  categoryIconCache.set(key, icon);
  return icon;
}

/**
 * One map marker. A dedicated component so the per-producer org-logo lookup
 * (`useResolveOrg`) is a single hook call per marker rather than inside the
 * buildings `.map()`. The marker itself is an owned/shared-coloured pin; the
 * producer's (`attributedTo`) organisation — name and logo, when they resolve —
 * shows in the hover card, as does the operator (`operatedBy`) agent's name and
 * logo when present. A click navigates to the building's detail page.
 */
export function BuildingMarker(
  { building, position, onClick, lens, band, framing }: {
    building: BuildingType;
    position: [number, number];
    onClick: () => void;
    lens: MapLens;
    band: LensBand;
    framing: MetricFraming;
  },
) {
  const { data: org } = useResolveOrg(building.attributedTo);
  // The logo URL is the raw `foaf:logo` value from a THIRD PARTY's profile
  // (shared-in buildings resolve foreign producers) — sanitize before rendering.
  const logoSrc = org?.logoUrl ? safeImageSrc(org.logoUrl) : null;
  // The operator (`operatedBy`) is resolved against the agent's OWN document
  // (`foaf:name` + `foaf:img`/logo), which is where these operator-org nodes
  // state their name and logo — they carry no `org:memberOf` for resolveAgentOrg.
  const { data: operator } = useResolveAgent(building.operatedBy);
  const operatorName = operator?.name && building.operatedBy ? operator.name : null;
  const operatorLogoSrc = operator?.avatarUrl
    ? safeImageSrc(operator.avatarUrl)
    : null;
  const icon = lens === "energy"
    ? createCategoryIcon(band, framing)
    : buildingPin(building.isShared ?? false);
  const tooltipOffset: [number, number] = lens === "ownership"
    ? [0, -38]
    : [0, -20];
  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={{ click: onClick }}
    >
      <Tooltip direction="top" offset={tooltipOffset}>
        <Box sx={{ display: "flex", gap: 1 }}>
          <CorporateFareIcon fontSize="small" />
          <span>
            <strong>{buildingDisplayName(building)}</strong>
            {building.streetAddress &&
              building.streetAddress !== buildingDisplayName(building) && (
              <>
                <br />
                {building.streetAddress}
              </>
            )}
            <br />
            {`${building.postalCode ?? ""} ${building.locality ?? ""}${
              building.region ? `, ${building.region}` : ""
            }`}
            {org?.name && (
              <>
                <br />
                <em>{org.name}</em>
              </>
            )}
            {logoSrc && (
              <img
                src={logoSrc}
                alt={msg("markerProducerLogoAlt")}
                // A Wikidata→Commons logo carries an attribution obligation; a
                // native title surfaces it (this is a Leaflet tooltip, not MUI).
                title={org?.logoSource === "commons"
                  ? msg("logoViaCommons")
                  : undefined}
                style={{
                  display: "block",
                  height: 20,
                  maxWidth: 140,
                  objectFit: "contain",
                  marginTop: 4,
                }}
                // A foreign producer's logo may not be publicly readable —
                // hide the broken image, the org name line still identifies.
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            {operatorName && (
              <>
                <br />
                Operated by <em>{operatorName}</em>
              </>
            )}
            {operatorLogoSrc && (
              <img
                src={operatorLogoSrc}
                alt={msg("markerOperatorLogoAlt")}
                style={{
                  display: "block",
                  height: 20,
                  maxWidth: 140,
                  objectFit: "contain",
                  marginTop: 4,
                }}
                // The operator's logo may not be publicly readable — hide the
                // broken image, the operator name line still identifies.
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
          </span>
        </Box>
      </Tooltip>
    </Marker>
  );
}
