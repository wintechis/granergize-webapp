import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { investorLocalNameLabels } from "../services/utils/config/buildingConfig.ts";
import { updateBuilding } from "../services/utils/buildingSerializer.ts";

interface EditBuildingDialogProps {
  open: boolean;
  building: BuildingType;
  session: Session;
  onClose: () => void;
  onBuildingUpdated: () => void;
}

const SKIP_FIELDS = new Set([
  "id",
  "uri",
  "sourceUri",
  "sourceRole",
  "isShared",
  "energyData",
  "certifications",
  "annualData",
  "operatingCosts",
  "customer",
  "investor",
  "type",
  "naceCode",
  "energyCertificate",
]);

// Reverse map: human-readable label → local name (e.g. "1-Shift" → "OneShift")
const labelToLocalName: Record<string, string> = Object.fromEntries(
  Object.entries(investorLocalNameLabels).map(([ln, label]) => [label, ln]),
);

const ENUM_FIELDS = new Set(["shiftRegime", "tenancyType", "indoorTemperatureClass"]);

function buildingToFields(b: BuildingType): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(b)) {
    if (SKIP_FIELDS.has(key) || val == null) continue;
    if (Array.isArray(val) || typeof val === "object") continue;
    if (typeof val === "boolean") {
      fields[key] = val ? "true" : "false";
    } else if (typeof val === "number") {
      fields[key] = String(val);
    } else if (typeof val === "string") {
      // Enum fields are stored as human-readable labels; form needs local names
      fields[key] = ENUM_FIELDS.has(key) ? (labelToLocalName[val] ?? val) : val;
    }
  }
  return fields;
}

export default function EditBuildingDialog(
  { open, building, session, onClose, onBuildingUpdated }: EditBuildingDialogProps,
) {
  const { showNotification } = useNotification();
  const [fields, setFields] = useState<Record<string, string>>(() => buildingToFields(building));
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const role = building.sourceRole ?? "investor";
  const fileUri = building.sourceUri ?? building.uri.split("#")[0];

  const setField = (key: string, val: string) =>
    setFields((prev) => ({ ...prev, [key]: val }));

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleGeocode = async () => {
    const query = [fields.streetAddress, fields.postalCode, fields.locality, fields.region]
      .filter(Boolean)
      .join(", ");
    if (!query) return;
    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
        { headers: { "User-Agent": "Granergize/1.0 (thomas.wehr@fau.de)" } },
      );
      const data = await res.json() as { lat: string; lon: string }[];
      if (!data.length) {
        showNotification("Address not found", "warning");
        return;
      }
      setField("lat", data[0].lat);
      setField("long", data[0].lon);
      showNotification("Coordinates updated", "success");
    } catch (err) {
      showNotification(`Geocoding failed: ${err}`, "error");
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await updateBuilding(session, fileUri, building.uri as string, fields);
      showNotification("Building updated", "success");
      onBuildingUpdated();
      onClose();
    } catch (err) {
      showNotification(`Update failed: ${err}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const tf = (label: string, field: string, opts?: { type?: string }) => (
    <TextField
      label={label}
      size="small"
      fullWidth
      type={opts?.type ?? "text"}
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
      <Typography variant="subtitle2" color="text.secondary">{title}</Typography>
      <Divider />
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Edit Building</DialogTitle>
      <DialogContent sx={{ overflowY: "auto" }}>
        {sectionHeader("Address")}
        {tf("Street address", "streetAddress")}
        {tf("Locality (city)", "locality")}
        {tf("Postal code", "postalCode")}
        {tf("Region (state)", "region")}

        {sectionHeader("Location & Physical")}
        <Button
          variant="outlined"
          startIcon={geocoding ? <CircularProgress size={14} color="inherit" /> : <MyLocationIcon />}
          onClick={handleGeocode}
          disabled={geocoding}
          sx={{ mb: 1.5 }}
        >
          {geocoding ? "Looking up…" : "Update coordinates"}
        </Button>
        {tf("Latitude", "lat", { type: "number" })}
        {tf("Longitude", "long", { type: "number" })}
        {tf("Building area (m²)", "buildingArea", { type: "number" })}
        {tf("Land area (m²)", "landArea", { type: "number" })}
        {tf("Year of construction", "yearOfConstruction", { type: "number" })}
        {tf("Operated by (WebID)", "operatedBy")}
        {check("PV system installed", "hasPVSystem")}

        {role === "investor" && (
          <>
            {sectionHeader("Investor")}
            {tf("Building code", "buildingCode")}
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

        {role === "benchmark_service_provider" && (
          <>
            {sectionHeader("Benchmark Service Provider")}
            {tf("Company name", "companyName")}
            {tf("Label / building name", "label")}
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
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? <CircularProgress size={20} color="inherit" /> : "Save Changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
