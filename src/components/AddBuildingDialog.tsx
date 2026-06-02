import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { Session } from "@inrupt/solid-client-authn-browser";
import { guardedDialogClose } from "./dialogClose.ts";
import type { UserRole } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { getActiveRoom, getMyRole } from "../services/interop/dataRoom.ts";
import {
  addBuildingToRegistry,
  buildingEnergyFileUrl,
  generateEnergyDayTtl,
  type LastgangReading,
  newBuildingUri,
  parseCsvToFields,
  serializeBuildingToTurtle,
  uploadBuilding,
} from "../services/utils/buildingSerializer.ts";
import { trackedFetch } from "../services/utils/networkActivity.ts";

interface AddBuildingDialogProps {
  open: boolean;
  session: Session;
  /** When true, open the file picker immediately (bulk "autofill from file"). */
  autostartImport?: boolean;
  onClose: () => void;
  onBuildingAdded: (newSubjectUris: string[]) => void;
}

const ROLE_LABEL: Record<UserRole, string> = {
  dummy: "Demo / Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
};

const CSV_HINT: Record<UserRole, string> = {
  investor: "Upload investor.xlsx (row-label format, buildings in columns D–K)",
  benchmark_service_provider:
    "Upload BenchmarkServiceProvider.csv (column-header format, one row per building)",
  user: "Upload Lastgang XLSX (15-min load profile from utility provider)",
  dummy: "Upload CSV with BuildingType field names as column headers",
};

/** Roles a building can be added under (excludes the demo "dummy" role). */
const DIALOG_ROLES: UserRole[] = [
  "investor",
  "user",
  "benchmark_service_provider",
];

/** Minimum fields that must be non-empty before submission is allowed. */
const REQUIRED_FIELDS: Record<UserRole, string[]> = {
  dummy: ["streetAddress", "locality", "postalCode", "region", "lat", "long"],
  user: ["streetAddress", "locality", "postalCode", "region", "lat", "long"],
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

  // The roles the user has self-assigned in the data room — the only roles a
  // building may be added under. Loaded from the data room when the dialog opens.
  const [myRoles, setMyRoles] = useState<UserRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRolesLoading(true);
    getMyRole(getActiveRoom(), session)
      .then((roles) => {
        if (!cancelled) setMyRoles(roles);
      })
      .catch((err) => {
        if (!cancelled) {
          showNotification(`Failed to load your data room roles: ${err}`, "error");
          setMyRoles([]);
        }
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  // Keep the canonical ordering and drop the demo "dummy" role.
  const dialogRoles = useMemo<UserRole[]>(
    () => DIALOG_ROLES.filter((r) => myRoles.includes(r)),
    [myRoles],
  );

  const [role, setRole] = useState<UserRole>(DIALOG_ROLES[0]);

  // Keep the selected role valid once the data room roles load.
  useEffect(() => {
    if (dialogRoles.length > 0 && !dialogRoles.includes(role)) {
      setRole(dialogRoles[0]);
    }
  }, [dialogRoles, role]);
  const [buildingsList, setBuildingsList] = useState<Record<string, string>[]>([{}]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [lastgangReadings, setLastgangReadings] = useState<LastgangReading[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = uploading || parsing;

  const fields = buildingsList[activeIdx] ?? {};
  const required = REQUIRED_FIELDS[role];
  const isRequired = (field: string) => required.includes(field);

  const isBuildingValid = (b: Record<string, string>) =>
    required.every((f) => b[f]?.trim());

  const isValid = buildingsList.every(isBuildingValid);

  const existingCodes = new Set(
    buildings.map((b) => b.buildingCode).filter(Boolean),
  );

  const isBuildingDuplicate = (b: Record<string, string>) =>
    role === "investor" &&
    !!b.buildingCode?.trim() &&
    existingCodes.has(b.buildingCode.trim());

  const hasCrossFileDuplicate = role === "investor" &&
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
    setRole(dialogRoles[0] ?? DIALOG_ROLES[0]);
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
    setUploading(false);
    setUploadProgress(null);
    onClose();
  };

  const handleRoleChange = (e: SelectChangeEvent<UserRole>) => {
    setRole(e.target.value as UserRole);
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseCsvToFields(file, role);
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

      setBuildingsList(cleanParsed);
      setActiveIdx(0);

      const msg = readings
        ? `Loaded building with ${readings.length} readings (${new Set(readings.map((r) => r.date)).size} days)`
        : `Loaded ${parsed.length} building(s) from file`;
      showNotification(msg, "success");
    } catch (err) {
      showNotification(`Failed to parse file: ${err}`, "error");
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGeocode = async () => {
    const query = [fields.streetAddress, fields.postalCode, fields.locality, fields.region]
      .filter(Boolean)
      .join(", ");
    if (!query) return;
    setGeocoding(true);
    try {
      const res = await trackedFetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { "User-Agent": "Granergize/1.0 (thomas.wehr@fau.de)" } },
        "geocode address",
      );
      const data = await res.json() as { lat: string; lon: string }[];
      if (!data.length) {
        showNotification("Address not found", "warning");
        return;
      }
      setField("lat", data[0].lat);
      setField("long", data[0].lon);
      showNotification("Coordinates filled", "success");
    } catch (err) {
      showNotification(`Geocoding failed: ${err}`, "error");
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

    setUploading(true);
    const addedSubjectUris: string[] = [];
    try {
      for (const b of buildingsList) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const uri = newBuildingUri(webId, id);
        const buildingSubjectUri = `${uri}#${id}`;
        addedSubjectUris.push(buildingSubjectUri);

        // Upload energy files for Lastgang buildings (parallel, max 8 concurrent)
        const energyDatasets: { date: string; location: string }[] = [];
        if (lastgangReadings && lastgangReadings.length > 0) {
          const byDate = new Map<string, LastgangReading[]>();
          for (const r of lastgangReadings) {
            const list = byDate.get(r.date) ?? [];
            list.push(r);
            byDate.set(r.date, list);
          }
          const entries = [...byDate.entries()];
          const total = entries.length;
          setUploadProgress({ done: 0, total });
          const CONCURRENCY = 8;
          for (let i = 0; i < entries.length; i += CONCURRENCY) {
            const batch = entries.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
              batch.map(async ([date, dayReadings]) => {
                const energyUrl = buildingEnergyFileUrl(uri, date);
                const dayTtl = generateEnergyDayTtl(date, dayReadings, buildingSubjectUri, b.label ?? "");
                const res = await session.fetch(energyUrl, {
                  method: "PUT",
                  headers: { "Content-Type": "text/turtle" },
                  body: dayTtl,
                });
                if (!res.ok) throw new Error(`Energy upload failed for ${date}: ${res.status}`);
                return { date, location: energyUrl };
              }),
            );
            energyDatasets.push(...results);
            setUploadProgress({ done: energyDatasets.length, total });
          }
        }

        const ttl = serializeBuildingToTurtle(b, uri, energyDatasets.length > 0 ? energyDatasets : undefined);
        await uploadBuilding(session, uri, ttl, webId);
        await addBuildingToRegistry(session, webId, uri, role);
      }
      showNotification(
        buildingsList.length === 1 ? "Building added" : `${buildingsList.length} buildings added`,
        "success",
      );
      onBuildingAdded(addedSubjectUris);
      handleClose();
    } catch (err) {
      showNotification(`Failed to add building: ${err}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const tf = (
    label: string,
    field: string,
    opts?: { type?: string; required?: boolean; error?: boolean; helperText?: string },
  ) => (
    <TextField
      label={label}
      size="small"
      fullWidth
      required={opts?.required}
      type={opts?.type ?? "text"}
      error={opts?.error}
      helperText={opts?.helperText}
      value={fields[field] ?? ""}
      onChange={(e) => setField(field, e.target.value)}
      sx={{ mb: 1.5 }}
    />
  );

  const check = (label: string, field: string) => (
    <FormControlLabel
      control={
        <Checkbox
          checked={fields[field] === "true"}
          onChange={(e) => setField(field, e.target.checked ? "true" : "false")}
          size="small"
        />
      }
      label={label}
      sx={{ mb: 0.5 }}
    />
  );

  const enumSelect = (
    label: string,
    field: string,
    options: { value: string; label: string }[],
  ) => (
    <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        label={label}
        value={fields[field] ?? ""}
        onChange={(e) => setField(field, e.target.value)}
      >
        <MenuItem value=""><em>—</em></MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const sectionHeader = (title: string) => (
    <Box sx={{ mt: 2, mb: 1 }}>
      <Typography variant="h6" color="text.secondary">{title}</Typography>
      <Divider />
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={guardedDialogClose(handleClose, {
        dirty: buildingsList.some((b) =>
          Object.values(b).some((v) => v && String(v).trim())
        ) || lastgangReadings != null,
        busy: isProcessing,
      })}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { position: "relative" } }}
      TransitionProps={{
        onEntered: () => {
          if (autostartImport) fileInputRef.current?.click();
        },
      }}
    >
      {isProcessing && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(255,255,255,0.85)",
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
        </Box>
      )}
      <DialogTitle>Add Building</DialogTitle>
      <DialogContent sx={{ overflowY: "auto" }}>
        {/* Role — only the roles the user holds in the data room */}
        {!rolesLoading && dialogRoles.length === 0
          ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
              You have no role assigned in the data room. Assign one in the Data
              Room tab before adding a building.
            </Typography>
          )
          : (
            <FormControl size="small" fullWidth sx={{ mt: 1, mb: 2 }}>
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={dialogRoles.includes(role) ? role : ""}
                onChange={handleRoleChange}
                disabled={rolesLoading || dialogRoles.length === 0}
              >
                {dialogRoles.map((r) => (
                  <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

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
            {CSV_HINT[role]}
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
                      <IconButton
                        size="small"
                        component="span"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          removeBuilding(i);
                        }}
                        sx={{ p: 0.25, ml: 0.25 }}
                      >
                        {/* eslint-disable-next-line no-restricted-syntax -- icon glyph sizing, not text */}
                        <CloseIcon sx={{ fontSize: 14 }} />
                      </IconButton>
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
        {tf("Operated by (WebID)", "operatedBy")}
        {check("PV system installed", "hasPVSystem")}

        {/* Investor-specific fields */}
        {role === "investor" && (
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
        {role === "benchmark_service_provider" && (
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
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isProcessing}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isProcessing || !isValid || isDuplicate ||
            dialogRoles.length === 0}
        >
          {buildingsList.length === 1 ? "Add Building" : `Add ${buildingsList.length} Buildings`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
