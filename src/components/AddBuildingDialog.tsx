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
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Modal from "./Modal.tsx";
import { makeBuildingFields } from "./buildingFields.tsx";
import {
  BuildingAddressFields,
  BuildingDetailFields,
} from "./BuildingDetailFields.tsx";
import { ADDRESS_FIELDS } from "../constants/addressFields.ts";
import RequestActivityList from "./RequestActivityList.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSolidData } from "../hooks/queries.ts";
import { useUploadBuildings } from "../hooks/mutations.ts";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../services/rdf/building/buildingImport.ts";
import { geocodeFields } from "../services/geocode.ts";
import { useGeocodeFields } from "../hooks/useGeocodeFields.ts";
import type { LastgangReading } from "../services/rdf/energySeriesXlsx.ts";
import {
  SCALAR_FIELDS,
  type SpreadsheetFormat,
} from "../services/rdf/buildingTemplates.ts";
// Local file-parse errors only — the Pod-write errors toast centrally.
import { formatError } from "../lib/formatError.ts";

interface AddBuildingDialogProps {
  open: boolean;
  /** When true, open the file picker immediately (bulk "Import from file"). */
  autostartImport?: boolean;
  onClose: () => void;
}

// The file-format options name the spreadsheet *layout*: a row-label sheet (one
// column per building), a table (one row per building), or generic field-name
// columns. Mapped onto the three parse shapes `parseCsvToFields` knows. (The
// identifiers say "format", matching the SpreadsheetFormat type — the old
// "template"/"role" vocabulary is retired.)
const FORMAT_LABEL: Record<SpreadsheetFormat, string> = {
  investor: "Row-label sheet (one column per building)",
  benchmark: "Table (one row per building)",
  generic: "Generic (field-name columns)",
};

const GENERIC_CSV_HINT =
  "Generic: field-name column headers, or a 15-minute load-profile (Lastgang) export.";

const CSV_HINT: Record<SpreadsheetFormat, string> = {
  investor:
    "Row-label sheet: field labels down column B, one column per building (D–K).",
  benchmark:
    "Table: one row per building, with column headers.",
  generic: GENERIC_CSV_HINT,
};

/** The selectable import formats (excludes the demo "dummy" shape). */
const FORMAT_OPTIONS: SpreadsheetFormat[] = [
  "investor",
  "generic",
  "benchmark",
];

function tabLabel(b: Record<string, string>, idx: number): string {
  return b.buildingCode || b.label || `Building ${idx + 1}`;
}

export default function AddBuildingDialog(
  { open, autostartImport, onClose }: AddBuildingDialogProps,
) {
  const { showNotification } = useNotification();
  const { buildings } = useSolidData();
  // The write goes through the mutation hook: busy state, the central error
  // toast and the building-data invalidations are its job; the dialog keeps
  // the progress overlay + cancel UI and the success/abort reporting.
  const upload = useUploadBuildings();
  const uploading = upload.isPending;

  // The chosen import file-format (spreadsheet layout) for "Import from file".
  // Auto-detected on upload; the selector lets the user override. It does not
  // affect the manual field set (one generic form).
  const [format, setFormat] = useState<SpreadsheetFormat>(FORMAT_OPTIONS[0]);
  const [buildingsList, setBuildingsList] = useState<Record<string, string>[]>([{}]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [lastgangReadings, setLastgangReadings] = useState<LastgangReading[] | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [parsing, setParsing] = useState(false);
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
    setFormat(FORMAT_OPTIONS[0]);
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
    setUploadProgress(null);
    onClose();
  };

  const handleFormatChange = (e: SelectChangeEvent<SpreadsheetFormat>) => {
    setFormat(e.target.value as SpreadsheetFormat);
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
      setFormat(format);
      const parsed = await parseCsvToFields(file, format);
      if (parsed.length === 0) {
        showNotification("No buildings found in file", "warning");
        return;
      }

      // A generic import maps unknown column headers through verbatim, and the
      // serializer then silently skips them — a typo'd header used to degrade
      // to "field not imported" with zero indication. Surface what was ignored.
      const isKnownField = (k: string) =>
        SCALAR_FIELDS.includes(k) ||
        /^_(inv|bsp|opcost|cert|readings)_/.test(k) ||
        k === "geocodePrecision";
      const ignored = [
        ...new Set(
          parsed.flatMap((b) => Object.keys(b).filter((k) => !isKnownField(k))),
        ),
      ];
      if (ignored.length > 0) {
        showNotification(
          `Ignored unrecognised column(s): ${ignored.join(", ")}`,
          "warning",
        );
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

  const { onGeocode, busy: geocoding } = useGeocodeFields(
    fields,
    setField,
    "Coordinates filled",
  );

  const handleSubmit = () => {
    const controller = new AbortController();
    uploadAbort.current = controller;
    upload.mutate(
      {
        buildings: buildingsList,
        lastgangReadings,
        signal: controller.signal,
        onProgress: (done, total) => setUploadProgress({ done, total }),
      },
      {
        onSuccess: ({ added, aborted }) => {
          if (aborted) {
            // A user cancel is an outcome, not an error: the buildings written
            // before the cancel are kept (and already invalidated).
            showNotification(
              "Import cancelled — any buildings already written are kept",
              "warning",
            );
            return;
          }
          showNotification(
            added.length === 1
              ? "Building added"
              : `${added.length} buildings added`,
            "success",
          );
          handleClose();
        },
        onSettled: () => {
          setUploadProgress(null);
          uploadAbort.current = null;
        },
      },
    );
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
            <InputLabel id="add-building-format-label">File format</InputLabel>
            <Select
              labelId="add-building-format-label"
              label="File format"
              value={format}
              onChange={handleFormatChange}
            >
              {FORMAT_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>{FORMAT_LABEL[t]}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" sx={{ display: "block" }} color="text.secondary">
            {CSV_HINT[format]}
          </Typography>
        </Box>
        )}
        {/* Parse feedback — shown whenever a file has been parsed, in either mode
            (the upload control above is import-mode only, but the input works in
            both). */}
        {lastgangReadings && (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 2 }}
            color="success.main"
          >
            {lastgangReadings.length} readings ({new Set(lastgangReadings.map((r) => r.date)).size} days) ready to upload
          </Typography>
        )}
        {importedAnnualYears.length > 0 && (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 2 }}
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

        {/* Common fields — one shared block with the Edit dialog (no drift). */}
        <BuildingAddressFields
          f={{ tf, check, enumSelect, sectionHeader }}
          fields={fields}
          setField={setField}
          isRequired={isRequired}
          geocode={{
            onClick: onGeocode,
            busy: geocoding,
            disabled: !["streetAddress", "postalCode", "locality", "region"]
              .some((f) => fields[f]?.trim()),
            label: "Get coordinates",
          }}
        />

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
