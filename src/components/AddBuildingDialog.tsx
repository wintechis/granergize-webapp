import { useEffect, useRef, useState } from "react";
import {
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
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { Session } from "@inrupt/solid-client-authn-browser";
import Modal from "./Modal.tsx";
import { makeBuildingFields } from "./buildingFields.tsx";
import { BuildingDetailFields } from "./BuildingDetailFields.tsx";
import { AgentField } from "./AgentField.tsx";
import RequestActivityList from "./RequestActivityList.tsx";
import type { UserRole } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useSolidData } from "../hooks/queries.ts";
import {
  detectSpreadsheetFormat,
  geocodeFields,
  type LastgangReading,
  newBuildingUri,
  parseCsvToFields,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../services/rdf/building/buildingSerializer.ts";
import { formatError } from "../lib/formatError.ts";
import { rememberAgent } from "../services/contacts.ts";

interface AddBuildingDialogProps {
  open: boolean;
  session: Session;
  /** When true, open the file picker immediately (bulk "Import from file"). */
  autostartImport?: boolean;
  onClose: () => void;
  onBuildingAdded: (newSubjectUris: string[]) => void;
}

/**
 * The import *file format* (spreadsheet layout) chosen when importing buildings —
 * the parse shape only, used by `parseCsvToFields`. Not a role, not provenance, and
 * unrelated to the (single, generic) manual field set.
 */
type Template = UserRole;

// The file-format options name the spreadsheet *layout*, not a role: a row-label
// sheet (one column per building), a table (one row per building), or generic
// field-name columns. Mapped onto the three parse shapes `parseCsvToFields` knows.
const TEMPLATE_LABEL: Record<UserRole, string> = {
  dummy: "Generic (field-name columns)",
  investor: "Row-label sheet (one column per building)",
  user: "Generic (field-name columns)",
  benchmark_service_provider: "Table (one row per building)",
  facility_manager: "Generic (field-name columns)",
  developer: "Generic (field-name columns)",
  consultant_broker: "Generic (field-name columns)",
  software_provider: "Generic (field-name columns)",
  energy_provider: "Generic (field-name columns)",
};

const GENERIC_CSV_HINT =
  "Generic: field-name column headers, or a 15-minute load-profile (Lastgang) export.";

const CSV_HINT: Record<UserRole, string> = {
  investor:
    "Row-label sheet: field labels down column B, one column per building (D–K).",
  benchmark_service_provider:
    "Table: one row per building, with column headers.",
  user: GENERIC_CSV_HINT,
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

  // The chosen import file-format (spreadsheet layout) for "Import from file".
  // Auto-detected on upload; the selector lets the user override. It is not a
  // role and does not affect the manual field set (one generic form).
  const [template, setTemplate] = useState<Template>(TEMPLATE_OPTIONS[0]);
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

  // "Import from file" opens straight into the file picker. With the native
  // <dialog> there's no enter-transition hook, so fire it when the modal opens.
  useEffect(() => {
    if (open && autostartImport) fileInputRef.current?.click();
  }, [open, autostartImport]);

  const isProcessing = uploading || parsing;

  const fields = buildingsList[activeIdx] ?? {};
  // One generic form: only address + coordinates are required, for any building.
  const required = ADDRESS_FIELDS;
  const isRequired = (field: string) => required.includes(field);

  // Autofill can carry energy as well as base data: the row-label layout brings
  // per-year `_inv_*` figures and the column-per-building layout a single `_bsp_*`
  // year (layout artifacts only — the stored energy carries no role). These aren't
  // editable form fields (energy is entered via the per-year Energy dialog), but they
  // DO get written on submit — so surface the years detected, read-only, so the user
  // can see autofill picked up energy. (15-minute series are summarised below.)
  const importedAnnualYears = (() => {
    const years = new Set<string>();
    for (const [k, v] of Object.entries(fields)) {
      const m = k.match(/^_inv_[a-z]+_(\d{4})$/i);
      if (m && v?.trim()) years.add(m[1]);
    }
    const bspFigures = ["_bsp_elec", "_bsp_heat", "_bsp_water", "_bsp_wastewater"];
    if (fields._bsp_year?.trim() && bspFigures.some((k) => fields[k]?.trim())) {
      years.add(fields._bsp_year.trim());
    }
    return [...years].sort();
  })();

  const isBuildingValid = (b: Record<string, string>) =>
    required.every((f) => b[f]?.trim());

  const isValid = buildingsList.every(isBuildingValid);

  const existingCodes = new Set(
    buildings.map((b) => b.buildingCode).filter(Boolean),
  );

  // A building code is optional, but when given it must be unique (against owned
  // buildings and across a multi-building import) so codes stay a stable key.
  const isBuildingDuplicate = (b: Record<string, string>) =>
    !!b.buildingCode?.trim() &&
    existingCodes.has(b.buildingCode.trim());

  const hasCrossFileDuplicate =
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
      // Detect the sheet layout (so the user needn't pick a role) and reflect it in
      // the format selector; the user can still override and re-choose the file.
      const format = await detectSpreadsheetFormat(file);
      setTemplate(format);
      const parsed = await parseCsvToFields(file, format);
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

    // Provenance records only WHO produced the building (the logged-in agent) as a
    // PROV qualified attribution — no producing-role category (roles live only in
    // data rooms now).
    const provenance = { agent: webId };

    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploading(true);
    const addedSubjectUris: string[] = [];
    try {
      for (const b of buildingsList) {
        controller.signal.throwIfAborted();
        // A collision-free id: `Date.now()`+short-random clashed when several
        // buildings were written within the same millisecond in a bulk import,
        // so the second PUT overwrote the first (buildings silently vanished).
        const id = crypto.randomUUID();
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
        // `refetchType: "all"` is load-bearing: the contacts query is INACTIVE here
        // (Connect is unmounted while this dialog is open), so a default invalidate
        // would only mark it stale — and the app's `refetchOnMount: false` then
        // suppresses the refetch when Connect mounts, leaving a stale list.
        if (b.operatedBy) {
          void rememberAgent(session, b.operatedBy)
            .then(() =>
              qc.invalidateQueries({
                queryKey: queryKeys.contacts,
                refetchType: "all",
              })
            );
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
      title={autostartImport ? "Autofill buildings from a file" : "Add Building"}
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
            disabled={isProcessing || !isValid || isDuplicate}
          >
            {buildingsList.length === 1
              ? "Add Building"
              : `Add ${buildingsList.length} Buildings`}
          </Button>
        </>
      }
    >
      <Box>
        {/* The file input stays in the DOM in both modes (so a file import still
            works, including the e2e `setInputFiles`), but the *visible* upload
            control + format selector show only in import ("Import from file") mode —
            so manual "Add Building" entry stays a plain, role-free form. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        {autostartImport && (
        <Box sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ mb: 1 }}
          >
            Choose file…
          </Button>
          {/* File format — auto-detected on upload; override here if a sheet's layout
              isn't recognised. A format, not a role. */}
          <FormControl size="small" fullWidth sx={{ mt: 1, mb: 1 }}>
            <InputLabel id="add-building-template-label">File format</InputLabel>
            <Select
              labelId="add-building-template-label"
              label="File format"
              value={template}
              onChange={handleTemplateChange}
            >
              {TEMPLATE_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>{TEMPLATE_LABEL[t]}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" display="block" color="text.secondary">
            {CSV_HINT[template]}
          </Typography>
        </Box>
        )}
        {/* Parse feedback — shown whenever a file has been parsed, in either mode
            (the upload control above is import-mode only, but the input works in
            both). */}
        {lastgangReadings && (
          <Typography
            variant="caption"
            display="block"
            sx={{ mb: 2 }}
            color="success.main"
          >
            {lastgangReadings.length} readings ({new Set(lastgangReadings.map((r) => r.date)).size} days) ready to upload
          </Typography>
        )}
        {importedAnnualYears.length > 0 && (
          <Typography
            variant="caption"
            display="block"
            sx={{ mb: 2 }}
            color="success.main"
          >
            Annual energy detected for {importedAnnualYears.join(", ")} — saved with
            the building.
          </Typography>
        )}

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

        {/* One generic field set, shared with the Edit dialog (no per-role gating).
            Annual energy figures are entered later via the per-year Energy dialog. */}
        <BuildingDetailFields
          f={{ tf, check, enumSelect, sectionHeader }}
          buildingCode={{
            error: currentIsDuplicate,
            helperText: currentIsDuplicate ? "Building code already exists" : undefined,
          }}
        />
      </Box>
    </Modal>
  );
}
