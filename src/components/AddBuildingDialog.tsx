import type { MessageId } from "../lib/messages.ts";
import { useT } from "../context/I18nProvider.tsx";
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
import { BuildingAddressFields } from "./BuildingDetailFields.tsx";
import { ADDRESS_FIELDS } from "../constants/addressFields.ts";
import RequestActivityList from "./RequestActivityList.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSolidData } from "../hooks/queries.ts";
import { useUploadBuildings } from "../hooks/mutations.ts";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../services/rdf/building/buildingImport.ts";
import { geocodeWithRegion } from "../services/sources/geocode.ts";
import { useGeocodeFields } from "../hooks/useGeocodeFields.ts";
import type { LastgangReading } from "../services/xlsx/energySeriesXlsx.ts";
import {
  SCALAR_FIELDS,
  type SpreadsheetFormat,
} from "../services/xlsx/buildingTemplates.ts";
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
const FORMAT_LABEL: Record<SpreadsheetFormat, MessageId> = {
  investor: "addFmtInvestor",
  benchmark: "addFmtBenchmark",
  generic: "addFmtGeneric",
};

const CSV_HINT: Record<SpreadsheetFormat, MessageId> = {
  investor: "addHintInvestor",
  benchmark: "addHintBenchmark",
  generic: "addHintGeneric",
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
  const t = useT();
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
  // The last chosen import file, retained so a manual format override can
  // re-parse it (the file input itself is reset after every pick).
  const lastFile = useRef<File | null>(null);

  // "Import from file" opens straight into the file picker. With the native
  // <dialog> there's no enter-transition hook, so fire it when the modal opens.
  useEffect(() => {
    if (open && autostartImport) fileInputRef.current?.click();
  }, [open, autostartImport]);

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

  const setField = (key: string, val: string) =>
    setBuildingsList((prev) => {
      const next = [...prev];
      next[activeIdx] = { ...next[activeIdx], [key]: val };
      return next;
    });

  const { onGeocode, busy: geocoding } = useGeocodeFields(
    fields,
    setField,
    t("coordinatesUpdated"),
  );

  // geocoding joins the busy set: the dialog must not close under an in-flight
  // geocode, whose late setField would otherwise land on the next open's form.
  const isProcessing = uploading || parsing || geocoding;

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
    lastFile.current = null;
    onClose();
  };

  // Overriding the format re-parses the RETAINED file with the chosen layout —
  // the override's whole point is recovering from a misdetection, so it must
  // not depend on the (already reset) file input or re-run auto-detection.
  const handleFormatChange = (e: SelectChangeEvent<SpreadsheetFormat>) => {
    const chosen = e.target.value as SpreadsheetFormat;
    setFormat(chosen);
    if (lastFile.current) {
      void importFile(lastFile.current, chosen);
      return;
    }
    setBuildingsList([{}]);
    setActiveIdx(0);
    setLastgangReadings(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    lastFile.current = file;
    try {
      // Detect the sheet layout (so the user needn't pick a role) and reflect it
      // in the format selector; the user can still override via the selector,
      // which re-parses this file with the chosen layout.
      const detected = await detectSpreadsheetFormat(file);
      setFormat(detected);
      await importFile(file, detected);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const importFile = async (file: File, format: SpreadsheetFormat) => {
    setParsing(true);
    try {
      const parsed = await parseCsvToFields(file, format);
      if (parsed.length === 0) {
        // Clear any previous file's parse results — leaving them on screen
        // invites submitting file A's data believing it came from file B.
        setBuildingsList([{}]);
        setActiveIdx(0);
        setLastgangReadings(null);
        showNotification(t("noBuildingsInFile"), "warning");
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
          t("importIgnoredColumns", { columns: ignored.join(", ") }),
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
      // Geocode every parsed building that lacks them (sequentially — polite to
      // the register wrapper; no Nominatim-style 1 req/s throttle is needed any
      // more). A building that still can't be resolved is left unmapped (and
      // stays invalid, so the user can fix or geocode it manually).
      for (const b of cleanParsed) {
        if ((b.lat?.trim() && b.long?.trim()) || !(b.streetAddress || b.postalCode || b.locality)) {
          continue;
        }
        const coords = await geocodeWithRegion(b);
        if (coords) {
          b.lat = coords.lat;
          b.long = coords.long;
          b.geocodePrecision = coords.precision;
          if (coords.regionAgs) b.regionAgs = coords.regionAgs;
        }
      }

      setBuildingsList(cleanParsed);
      setActiveIdx(0);

      const loaded = readings
        ? t("loadedWithReadings", {
          readings: readings.length,
          days: new Set(readings.map((r) => r.date)).size,
        })
        : t("loadedBuildings", { count: parsed.length });
      showNotification(loaded, "success");
    } catch (err) {
      showNotification(formatError("actionParseFile", err), "error");
    } finally {
      setParsing(false);
    }
  };

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
            showNotification(t("addImportCancelled"), "warning");
            return;
          }
          showNotification(
            t("addBuildingAddedCount", { count: added.length }),
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
      title={autostartImport ? t("addTitleAutofill") : t("addBuildingBtn")}
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
              ? t("addProcessingFile")
              : uploadProgress
              ? t("addUploadingEnergyDays", {
                done: uploadProgress.done,
                total: uploadProgress.total,
              })
              : lastgangReadings
              ? t("addUploadingBoth")
              : t("addAddingCount", { count: buildingsList.length })}
          </Typography>
          {uploading && (
            <>
              <Box
                sx={{ width: "100%", maxWidth: 480, maxHeight: "40vh", overflowY: "auto" }}
              >
                <RequestActivityList emptyText={t("addStarting")} />
              </Box>
              {/* The overlay covers the action row, so the cancel control lives
                  here, on top of the curtain. */}
              <Button variant="outlined" onClick={handleCancelUpload}>
                {t("addCancelUpload")}
              </Button>
            </>
          )}
        </Box>
      )}
      actions={
        <>
          <Button onClick={handleClose} disabled={isProcessing}>{t("btnCancel")}</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isProcessing || !isValid || isDuplicate}
          >
            {buildingsList.length === 1
              ? t("addBuildingBtn")
              : t("addBuildingsCount", { count: buildingsList.length })}
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
            {t("addChooseFile")}
          </Button>
          {/* File format — auto-detected on upload; override here if a sheet's layout
              isn't recognised. A format, not a role. */}
          <FormControl size="small" fullWidth sx={{ mt: 1, mb: 1 }}>
            <InputLabel id="add-building-format-label">{t("addFileFormat")}</InputLabel>
            <Select
              labelId="add-building-format-label"
              label={t("addFileFormat")}
              value={format}
              onChange={handleFormatChange}
            >
              {FORMAT_OPTIONS.map((f) => (
                <MenuItem key={f} value={f}>{t(FORMAT_LABEL[f])}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" sx={{ display: "block" }} color="text.secondary">
            {t(CSV_HINT[format])}
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
            {t("addReadingsReady", {
              count: lastgangReadings.length,
              days: new Set(lastgangReadings.map((r) => r.date)).size,
            })}
          </Typography>
        )}
        {importedAnnualYears.length > 0 && (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 2 }}
            color="success.main"
          >
            {t("addAnnualDetected", { years: importedAnnualYears.join(", ") })}
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
                      <Tooltip title={t("addRemoveBuilding")}>
                        <IconButton
                          size="small"
                          component="span"
                          aria-label={t("addRemoveBuilding")}
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

        {/* Create collects only the BASICS — address + coordinates. The rest of the
            master data (areas, every agent incl. the operator, codes, heating, certs, …)
            is added inline on the building page afterward: the create modal mints the
            building, the inline editor fleshes it out (plan-inline-edit-consistency).
            Energy figures are entered on the observation page. */}
        <BuildingAddressFields
          f={{ tf, check, enumSelect, sectionHeader }}
          fields={fields}
          setField={setField}
          isRequired={isRequired}
          basicsOnly
          geocode={{
            onClick: onGeocode,
            busy: geocoding,
            disabled: !["streetAddress", "postalCode", "locality", "region"]
              .some((f) => fields[f]?.trim()),
            label: t("addGetCoordinates"),
          }}
        />
      </Box>
    </Modal>
  );
}
