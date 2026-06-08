import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { Session } from "@inrupt/solid-client-authn-browser";
import Modal from "./Modal.tsx";
import { logError } from "../services/utils/logError.ts";
import { makeBuildingFields } from "./buildingFields.tsx";
import { AgentField } from "./AgentField.tsx";
import RequestActivityList from "./RequestActivityList.tsx";
import type { UserRole } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useSolidData } from "../hooks/queries.ts";
import {
  geocodeFields,
  type LastgangReading,
  newBuildingUri,
  parseCsvToFields,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../services/utils/buildingSerializer.ts";
import { getCompanyKind } from "../services/utils/organizationManager.ts";
import { formatError } from "../services/utils/formatError.ts";
import { rememberAgent } from "../services/utils/contacts.ts";

interface AddBuildingDialogProps {
  open: boolean;
  session: Session;
  /** When true, open the file picker immediately (bulk "autofill from file"). */
  autostartImport?: boolean;
  onClose: () => void;
  onBuildingAdded: (newSubjectUris: string[]) => void;
}

/**
 * The import/export *template* (spreadsheet shape) chosen when adding a building —
 * the parse/serialize shape only. It is NOT the building's PROV provenance (that
 * comes from your company kind in the profile, `getCompanyKind`) nor the
 * data-room membership role.
 */
type Template = UserRole;

const TEMPLATE_LABEL: Record<UserRole, string> = {
  dummy: "Demo / Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
  facility_manager: "Facility Manager",
  developer: "Developer",
  consultant_broker: "Consultant / Broker",
  software_provider: "Software Provider",
  energy_provider: "Energy Provider",
};

const GENERIC_CSV_HINT =
  "Upload CSV with BuildingType field names as column headers";

const CSV_HINT: Record<UserRole, string> = {
  investor: "Upload investor.xlsx (row-label format, buildings in columns D–K)",
  benchmark_service_provider:
    "Upload BenchmarkServiceProvider.csv (column-header format, one row per building)",
  user: "Upload Lastgang XLSX (15-min load profile from utility provider)",
  dummy: GENERIC_CSV_HINT,
  facility_manager: GENERIC_CSV_HINT,
  developer: GENERIC_CSV_HINT,
  consultant_broker: GENERIC_CSV_HINT,
  software_provider: GENERIC_CSV_HINT,
  energy_provider: GENERIC_CSV_HINT,
};

/** Templates a building can be added under (excludes the demo "dummy" shape). */
const TEMPLATE_OPTIONS: Template[] = [
  "investor",
  "user",
  "benchmark_service_provider",
];

const ADDRESS_FIELDS = [
  "streetAddress",
  "locality",
  "postalCode",
  "region",
  "lat",
  "long",
];

/** Minimum fields that must be non-empty before submission is allowed. */
const REQUIRED_FIELDS: Record<UserRole, string[]> = {
  dummy: ADDRESS_FIELDS,
  user: ADDRESS_FIELDS,
  facility_manager: ADDRESS_FIELDS,
  developer: ADDRESS_FIELDS,
  consultant_broker: ADDRESS_FIELDS,
  software_provider: ADDRESS_FIELDS,
  energy_provider: ADDRESS_FIELDS,
  investor: [
    "streetAddress",
    "locality",
    "postalCode",
    "region",
    "lat",
    "long",
    "buildingCode",
  ],
  benchmark_service_provider: [
    "streetAddress",
    "locality",
    "postalCode",
    "region",
    "lat",
    "long",
    "label",
  ],
};

function tabLabel(b: Record<string, string>, idx: number): string {
  return b.buildingCode || b.label || `Building ${idx + 1}`;
}

export default function AddBuildingDialog(
  { open, session, autostartImport, onClose, onBuildingAdded }:
    AddBuildingDialogProps,
) {
  const { showNotification } = useNotification();
  const { buildings } = useSolidData();
  const qc = useQueryClient();

  // The chosen import/export template — spreadsheet shape only. Provenance comes
  // from the profile data-producer role (loaded below), not from this.
  const [template, setTemplate] = useState<Template>(TEMPLATE_OPTIONS[0]);
  // The profile data-producer role → the building's PROV provenance. Loaded on
  // open; null (no role set) means we record no attribution + show a hint.
  const [producingRole, setProducingRole] = useState<UserRole | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [buildingsList, setBuildingsList] = useState<Record<string, string>[]>([{}]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [lastgangReadings, setLastgangReadings] = useState<LastgangReading[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Lets the user cancel a long upload (e.g. a 15-min year = ~365 daily files).
  const uploadAbort = useRef<AbortController | null>(null);

  // "Autofill from file" opens straight into the file picker. With the native
  // <dialog> there's no enter-transition hook, so fire it when the modal opens.
  useEffect(() => {
    if (open && autostartImport) fileInputRef.current?.click();
  }, [open, autostartImport]);

  // Derive the producing role from the profile's company kind when the dialog
  // opens (cached read). The company kind also seeds the template default: an
  // investor opens on the investor shape, a BSP on the benchmark shape, etc. — the
  // selector below still lets the user override for a cross-shape import.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getCompanyKind(session).then((r) => {
      if (!cancelled) {
        setProducingRole(r);
        setRoleLoaded(true);
        if (r && TEMPLATE_OPTIONS.includes(r)) setTemplate(r);
      }
    }).catch((err) => logError("derive producing role from company kind", err));
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  const isProcessing = uploading || parsing;

  const fields = buildingsList[activeIdx] ?? {};
  const required = REQUIRED_FIELDS[template];
  const isRequired = (field: string) => required.includes(field);

  const isBuildingValid = (b: Record<string, string>) =>
    required.every((f) => b[f]?.trim());

  const isValid = buildingsList.every(isBuildingValid);

  // Adding requires a company kind: it sets the building's provenance and selects
  // the data shape. Block submission until one is set (the warning below explains).
  const mustSetKind = roleLoaded && producingRole === null;

  const existingCodes = new Set(
    buildings.map((b) => b.buildingCode).filter(Boolean),
  );

  const isBuildingDuplicate = (b: Record<string, string>) =>
    template === "investor" &&
    !!b.buildingCode?.trim() &&
    existingCodes.has(b.buildingCode.trim());

  const hasCrossFileDuplicate = template === "investor" &&
    buildingsList.some((b, i) =>
      !!b.buildingCode?.trim() &&
      buildingsList.some((other, j) =>
        j !== i && other.buildingCode?.trim() === b.buildingCode?.trim()
      )
    );

  const isDuplicate = buildingsList.some(isBuildingDuplicate) || hasCrossFileDuplicate;

  const currentIsDuplicate = isBuildingDuplicate(fields);

  const setField = (key: string, val: string) =>
    setBuildingsList((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], [key]: val };
      return next;
    });

  const removeBuilding = (idx: number) => {
    setBuildingsList((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => (idx <= prev ? Math.max(0, prev - 1) : prev));
  };

  const handleClose = () => {
    if (isProcessing) return;
    setTemplate(TEMPLATE_OPTIONS[0]);
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
    setUploading(false);
    setUploadProgress(null);
    onClose();
  };

  const handleTemplateChange = (e: SelectChangeEvent<UserRole>) => {
    setTemplate(e.target.value as Template);
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseCsvToFields(file, template);
      if (parsed.length === 0) {
        showNotification("No buildings found in file", "warning");
        return;
      }

      // Extract Lastgang energy readings if present, then remove internal field
      const readings = parsed[0]?.["_readings_json"]
        ? (JSON.parse(parsed[0]["_readings_json"]) as LastgangReading[])
        : null;
      setLastgangReadings(readings);

      const cleanParsed = parsed.map((b) => {
        const copy: Record<string, string> = { ...b };
        delete copy["_readings_json"];
        return copy;
      });

      // Templates carry an address but no coordinates, yet lat/long are required
      // to place a building on the map (and to import an investor sheet at all).
      // Geocode every parsed building that lacks them. Throttle to Nominatim's
      // policy of AT MOST 1 request/second: a burst gets rate-limited (empty
      // results), and since the form is valid only when EVERY building has
      // coordinates, a single throttled miss would block the whole import. A
      // building that still can't be resolved is left unmapped (and stays
      // invalid, so the user can fix or geocode it manually).
      let geocodedOne = false;
      for (const b of cleanParsed) {
        if ((b.lat?.trim() && b.long?.trim()) || !(b.streetAddress || b.postalCode || b.locality)) {
          continue;
        }
        if (geocodedOne) await new Promise((r) => setTimeout(r, 1100));
        geocodedOne = true;
        const coords = await geocodeFields(b);
        if (coords) {
          b.lat = coords.lat;
          b.long = coords.long;
          b.geocodePrecision = coords.precision;
        }
      }

      setBuildingsList(cleanParsed);
      setActiveIdx(0);

      const msg = readings
        ? `Loaded building with ${readings.length} readings (${new Set(readings.map((r) => r.date)).size} days)`
        : `Loaded ${parsed.length} building(s) from file`;
      showNotification(msg, "success");
    } catch (err) {
      showNotification(formatError("parse the file", err), "error");
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const coords = await geocodeFields(fields);
      if (!coords) {
        showNotification("Address not found", "warning");
        return;
      }
      setField("lat", coords.lat);
      setField("long", coords.long);
      setField("geocodePrecision", coords.precision);
      showNotification("Coordinates filled", "success");
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async () => {
    const webId = session.info.webId;
    if (!webId) {
      showNotification("Not authenticated", "error");
      return;
    }

    // Provenance is derived from the profile's company kind (authoritative cached
    // read), not the import template; omit the attribution when none is set.
    const category = await getCompanyKind(session);
    const provenance = category ? { agent: webId, category } : undefined;

    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploading(true);
    const addedSubjectUris: string[] = [];
    try {
      for (const b of buildingsList) {
        controller.signal.throwIfAborted();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const uri = newBuildingUri(webId, id);
        const buildingSubjectUri = `${uri}#${id}`;
        addedSubjectUris.push(buildingSubjectUri);

        // Group the Lastgang (15-min) readings by day into a single series
        // dataset; annual aggregates come from the field map (`_inv_*`/`_bsp_*`).
        let series:
          | { year: number; days: Array<{ date: string; readings: LastgangReading[] }>; label: string }
          | undefined;
        if (lastgangReadings && lastgangReadings.length > 0) {
          const byDate = new Map<string, LastgangReading[]>();
          for (const r of lastgangReadings) {
            const list = byDate.get(r.date) ?? [];
            list.push(r);
            byDate.set(r.date, list);
          }
          const days = [...byDate.entries()].map(([date, readings]) => ({ date, readings }));
          // All readings are one calendar year; take it from the first date.
          const year = parseInt(days[0].date.slice(0, 4));
          series = { year, days, label: b.label ?? "" };
        }

        const energyLinks = await writeBuildingEnergy(
          session,
          uri,
          buildingSubjectUri,
          b,
          series,
          (done, total) => setUploadProgress({ done, total }),
          controller.signal,
        );

        const ttl = serializeBuildingToTurtle(b, uri, energyLinks, provenance);
        await uploadBuilding(session, uri, ttl, webId, controller.signal);
        // Auto-remember a WebID operator in the address book (fire-and-forget), then
        // refresh the contacts query so the new contact appears without a reload (the
        // direct rememberAgent write bypasses the addContact mutation's invalidation).
        if (b.operatedBy) {
          void rememberAgent(session, b.operatedBy)
            .then(() => qc.invalidateQueries({ queryKey: queryKeys.contacts }));
        }
      }
      showNotification(
        buildingsList.length === 1 ? "Building added" : `${buildingsList.length} buildings added`,
        "success",
      );
      onBuildingAdded(addedSubjectUris);
      handleClose();
    } catch (err) {
      if (controller.signal.aborted) {
        showNotification(
          "Import cancelled — any buildings already written are kept",
          "warning",
        );
      } else {
        showNotification(formatError("add the building", err), "error");
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      uploadAbort.current = null;
    }
  };

  const handleCancelUpload = () => uploadAbort.current?.abort();

  const { tf, check, enumSelect, sectionHeader } = makeBuildingFields(
    fields,
    setField,
    "add-building",
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={buildingsList.some((b) =>
        Object.values(b).some((v) => v && String(v).trim())
      ) || lastgangReadings != null}
      busy={isProcessing}
      title="Add Building"
      overlay={isProcessing && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            borderRadius: "inherit",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {parsing
              ? "Processing file…"
              : uploadProgress
              ? `Uploading energy data… ${uploadProgress.done}/${uploadProgress.total} days`
              : lastgangReadings
              ? "Uploading building and energy data…"
              : `Adding ${buildingsList.length > 1 ? `${buildingsList.length} buildings` : "building"}…`}
          </Typography>
          {uploading && (
            <>
              <Box
                sx={{ width: "100%", maxWidth: 480, maxHeight: "40vh", overflowY: "auto" }}
              >
                <RequestActivityList emptyText="Starting…" />
              </Box>
              {/* The overlay covers the action row, so the cancel control lives
                  here, on top of the curtain. */}
              <Button variant="outlined" onClick={handleCancelUpload}>
                Cancel upload
              </Button>
            </>
          )}
        </Box>
      )}
      actions={
        <>
          <Button onClick={handleClose} disabled={isProcessing}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isProcessing || !isValid || isDuplicate || mustSetKind}
          >
            {buildingsList.length === 1
              ? "Add Building"
              : `Add ${buildingsList.length} Buildings`}
          </Button>
        </>
      }
    >
      <Box>
        {/* No company kind set → adding is blocked: the kind sets provenance and
            selects the data shape. Point the user to set it (avatar → Organisation). */}
        {mustSetKind && (
          <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
            Set your company kind first (avatar → Organisation). It defines who
            produced the data and which building data you create, and is required
            before adding a building.
          </Alert>
        )}
      </Box>
      {!mustSetKind && (
      <Box>
        {/* Template — the spreadsheet shape, defaulted from your company kind but
            overridable for a cross-shape import. */}
        <FormControl size="small" fullWidth sx={{ mt: 1, mb: 2 }}>
          <InputLabel id="add-building-template-label">Template</InputLabel>
          <Select
            labelId="add-building-template-label"
            label="Template"
            value={template}
            onChange={handleTemplateChange}
          >
            {TEMPLATE_OPTIONS.map((t) => (
              <MenuItem key={t} value={t}>{TEMPLATE_LABEL[t]}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* File autofill */}
        <Box sx={{ mb: 2 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: "none" }}
            onChange={handleFileUpload}
          />
          <Typography variant="caption" display="block" color="text.secondary">
            {CSV_HINT[template]}
          </Typography>
          {lastgangReadings && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }} color="success.main">
              {lastgangReadings.length} readings ({new Set(lastgangReadings.map((r) => r.date)).size} days) ready to upload
            </Typography>
          )}
        </Box>

        {/* Building tabs — shown only when multiple buildings loaded */}
        {buildingsList.length > 1 && (
          <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
            <Tabs
              value={activeIdx}
              onChange={(_, v: number) => setActiveIdx(v)}
              variant="scrollable"
              scrollButtons="auto"
            >
              {buildingsList.map((b, i) => (
                <Tab
                  key={i}
                  label={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      {tabLabel(b, i)}
                      <Tooltip title="Remove this building">
                        <IconButton
                          size="small"
                          component="span"
                          aria-label="Remove this building"
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            removeBuilding(i);
                          }}
                          sx={{ p: 0.25, ml: 0.25 }}
                        >
                          {/* eslint-disable-next-line no-restricted-syntax -- icon glyph sizing, not text */}
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                  sx={{
                    color: !isBuildingValid(b) || isBuildingDuplicate(b)
                      ? "error.main"
                      : undefined,
                    "&.Mui-selected": {
                      color: !isBuildingValid(b) || isBuildingDuplicate(b)
                        ? "error.main"
                        : undefined,
                    },
                  }}
                />
              ))}
            </Tabs>
          </Box>
        )}

        {/* Common fields */}
        {sectionHeader("Address")}
        {tf("Street address", "streetAddress", { required: isRequired("streetAddress") })}
        {tf("Locality (city)", "locality", { required: isRequired("locality") })}
        {tf("Postal code", "postalCode", { required: isRequired("postalCode") })}
        {tf("Region (state)", "region", { required: isRequired("region") })}

        {sectionHeader("Location & Physical")}
        <Button
          variant="outlined"
          startIcon={<MyLocationIcon />}
          onClick={handleGeocode}
          disabled={geocoding || !["streetAddress", "postalCode", "locality", "region"].some((f) => fields[f]?.trim())}
          sx={{ mb: 1.5 }}
        >
          {geocoding ? "Looking up…" : "Get coordinates"}
        </Button>
        {tf("Latitude", "lat", { type: "number", required: isRequired("lat") })}
        {tf("Longitude", "long", { type: "number", required: isRequired("long") })}
        {tf("Building area (m²)", "buildingArea", { type: "number" })}
        {tf("Land area (m²)", "landArea", { type: "number" })}
        {tf("Year of construction", "yearOfConstruction", { type: "number" })}
        <AgentField
          label="Operated by (WebID)"
          value={fields.operatedBy ?? ""}
          onChange={(v) => setField("operatedBy", v)}
        />
        {check("PV system installed", "hasPVSystem")}

        {/* Investor-specific fields */}
        {template === "investor" && (
          <>
            {sectionHeader("Investor")}
            {tf("Building code", "buildingCode", {
              required: isRequired("buildingCode"),
              error: currentIsDuplicate,
              helperText: currentIsDuplicate ? "Building code already exists" : undefined,
            })}
            {tf("Label / name", "label")}
            {tf("Hall area (m²)", "hallArea", { type: "number" })}
            {tf("Office & social area (m²)", "officeSocialArea", { type: "number" })}
            {tf("Building height (m)", "buildingHeight", { type: "number" })}
            {tf("Number of loading docks", "numberOfLoadingDocks", { type: "number" })}
            {tf("Year of renovation", "yearOfRenovation", { type: "number" })}
            {tf("Lease type", "leaseType")}
            {tf("Tenant industry", "tenantIndustry")}
            {enumSelect("Shift regime", "shiftRegime", [
              { value: "OneShift", label: "1-Shift" },
              { value: "TwoShift", label: "2-Shift" },
              { value: "ThreeShift", label: "3-Shift" },
            ])}
            {enumSelect("Tenancy type", "tenancyType", [
              { value: "SingleTenant", label: "Single Tenant" },
              { value: "MultiTenant", label: "Multi Tenant" },
            ])}
            {enumSelect("Indoor temperature class", "indoorTemperatureClass", [
              { value: "MaxTwelveDegrees", label: "≤12 °C" },
              { value: "MaxEighteenDegrees", label: "≤18 °C" },
            ])}
            {sectionHeader("Heating systems")}
            {check("Oil boiler", "hasOilBoiler")}
            {check("Gas boiler", "hasGasBoiler")}
            {check("Electric boiler", "hasElectricBoiler")}
            {check("Heat pump", "hasHeatPump")}
            {check("District heating", "hasDistrictHeating")}
          </>
        )}

        {/* BSP-specific fields */}
        {template === "benchmark_service_provider" && (
          <>
            {sectionHeader("Benchmark Service Provider")}
            {tf("Company name", "companyName")}
            {tf("Label / building name", "label", { required: isRequired("label") })}
            {tf("Logistics function", "logisticsFunction")}
            {tf("Climate control type", "climateControlType")}
            {tf("Indoor temperature", "indoorTemperature")}
            {tf("Green lease share (%)", "greenLeaseShare", { type: "number" })}
            {tf("PV installation year", "pvInstallationYear", { type: "number" })}
            {tf("PV capacity (kW)", "pvCapacityKW", { type: "number" })}
            {tf("Lease type", "leaseType")}
            {tf("Tenant industry", "tenantIndustry")}
            {enumSelect("Tenancy type", "tenancyType", [
              { value: "SingleTenant", label: "Single Tenant" },
              { value: "MultiTenant", label: "Multi Tenant" },
            ])}
            {sectionHeader("Energy & Water (annual observations)")}
            {tf("Measurement year", "_bsp_year", { type: "number" })}
            {tf("Electricity consumption (kWh)", "_bsp_elec", { type: "number" })}
            {tf("Heat consumption (kWh)", "_bsp_heat", { type: "number" })}
            {tf("Water consumption (m³)", "_bsp_water", { type: "number" })}
            {tf("Wastewater (m³)", "_bsp_wastewater", { type: "number" })}
          </>
        )}
      </Box>
      )}
    </Modal>
  );
}
