import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useT } from "../context/I18nProvider.tsx";
import { getSession } from "../hooks/session.ts";
import {
  useAggregationDefinitions,
  useBuildings,
  useRoomState,
} from "../hooks/queries.ts";
import { INTENT_PARAMS, type ParamSpec } from "../intents/params.ts";
import { intentLabelKey, paramLabelKey } from "../intents/labels.ts";
import { useInvokeIntent } from "../hooks/invokeIntent.ts";
import { fieldKindFor } from "../lib/paramForm.ts";
import { msg, type MessageId } from "../lib/messages.ts";
import { getSnapshotUri } from "../services/aggregation/aggregationManager.ts";
import BuildingPicker from "./BuildingPicker.tsx";
import RecipientAutocomplete from "./RecipientAutocomplete.tsx";
import { AgentField } from "./AgentField.tsx";

/**
 * The schema-driven palette parameter form (plan §5). Given a form-eligible intent
 * `name`, it reads {@link INTENT_PARAMS}`[name]`, renders one field per param via
 * {@link fieldKindFor} (entity picker for IRI params, typed field for literals),
 * collects the values into a params object **keyed by the schema's param names** (so
 * it matches the core's `*Params` type), validates required/cardinality, then
 * dispatches through {@link invokeByName} on submit — the same headless entry the
 * deep links and the bench seeder use. No focused object is needed: the entity
 * pickers ARE the object selection.
 *
 * Outcome surfacing follows the catalog's `silentError`: a silent verb renders its
 * error inline through `<Alert>` (classified), every other verb routes it to the
 * central toast (`formatError`). Success closes the form (via `onDone`) and shows a
 * brief success toast. Lives inside the palette's existing {@link Modal}; the
 * caller supplies the actions row via {@link renderActions}.
 */
interface IntentParamFormProps {
  /** A form-eligible catalog intent name. */
  name: string;
  /** Called after a successful invoke (the palette closes). */
  onDone: () => void;
  /** Cancel (back to the command list / close). */
  onCancel: () => void;
}

/** A collected param value: a string / boolean / string[] (years are gYear strings). */
type ParamValue = string | boolean | string[];

export default function IntentParamForm({
  name,
  onDone,
  onCancel,
}: IntentParamFormProps) {
  const t = useT();
  const invokeIntent = useInvokeIntent();

  const params = useMemo(() => {
    const schema =
      (INTENT_PARAMS as Record<string, Record<string, ParamSpec>>)[name] ?? {};
    return Object.entries(schema);
  }, [name]);

  // Option sources for the entity pickers (cached React Query reads).
  const buildings = useBuildings().data?.buildings ?? [];
  const aggregations = useAggregationDefinitions().data ?? [];
  const rooms = useRoomState().data?.known ?? [];

  // Per-param collected value. Booleans default false; everything else empty.
  const [values, setValues] = useState<Record<string, ParamValue>>(() => {
    const init: Record<string, ParamValue> = {};
    for (const [pname, spec] of params) {
      const k = fieldKindFor(name, pname, spec);
      init[pname] = k.kind === "boolean" ? false : k.multi ? [] : "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const set = (pname: string, v: ParamValue) =>
    setValues((prev) => ({ ...prev, [pname]: v }));

  const labelFor = (pname: string): string => {
    const key = paramLabelKey(pname);
    return key ? t(key as MessageId) : pname;
  };

  // A required param is unsatisfied when its collected value is empty.
  const missing = (pname: string, spec: ParamSpec): boolean => {
    const k = fieldKindFor(name, pname, spec);
    if (!k.required) return false;
    const v = values[pname];
    if (k.kind === "boolean") return false; // a boolean is always satisfied
    if (Array.isArray(v)) return v.length === 0;
    return !v;
  };

  const hasMissing = params.some(([p, s]) => missing(p, s));

  /**
   * Map the collected raw values to the core's param object. IRI/literal pickers
   * yield strings; the gYear chips → `number[]` for `years`; an aggregation pick
   * yields the aggregation id, then derives the `snapshotUri` for the share/revoke
   * verbs (the snapshot IRI is `getSnapshotUri(webId, id)`).
   */
  const collectParams = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const webId = getSession().info.webId ?? "";
    for (const [pname, spec] of params) {
      const k = fieldKindFor(name, pname, spec);
      const v = values[pname];
      if (pname === "snapshotUri") {
        // The aggregation picker yields an id; the core wants the snapshot IRI.
        out[pname] = getSnapshotUri(webId, String(v));
        continue;
      }
      if (k.kind === "year") {
        out[pname] = (v as string[]).map((y) => Number(y)).filter((n) => !Number.isNaN(n));
        continue;
      }
      out[pname] = v;
    }
    return out;
  };

  const submit = async () => {
    setSubmitted(true);
    setInlineError(null);
    if (hasMissing) return;
    setBusy(true);
    // The shared effect calls the core directly (bypassing the per-intent hooks),
    // blanket-invalidates on success, and routes the error per the catalog's
    // silentError. A silent verb's error comes back inline; everything else has
    // already toasted, so we just close.
    const outcome = await invokeIntent(name, collectParams());
    setBusy(false);
    if (outcome.ok) onDone();
    else if (outcome.inlineError) setInlineError(outcome.inlineError);
    else onDone();
  };

  const labelKey = intentLabelKey(name);
  const title = labelKey ? t(labelKey as MessageId) : name;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>{title}</Typography>

      {params.map(([pname, spec]) => {
        const k = fieldKindFor(name, pname, spec);
        const showErr = submitted && missing(pname, spec);
        return (
          <Box key={pname} sx={{ mb: 1 }}>
            {renderField(pname, k, showErr)}
          </Box>
        );
      })}

      {inlineError && (
        <Alert severity="error" sx={{ mb: 2 }}>{inlineError}</Alert>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
        <Button onClick={onCancel} disabled={busy}>{msg("btnCancel")}</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || hasMissing}
        >
          {t("paramFormSubmit")}
        </Button>
      </Box>
    </Box>
  );

  function renderField(
    pname: string,
    k: ReturnType<typeof fieldKindFor>,
    showErr: boolean,
  ) {
    const label = labelFor(pname);
    const helper = showErr ? t("paramFormRequired") : undefined;
    switch (k.kind) {
      case "building":
        return k.multi
          ? (
            <BuildingPicker
              multiple
              buildings={buildings}
              label={label}
              value={values[pname] as string[]}
              onChange={(uris) => set(pname, uris)}
              disabled={busy}
            />
          )
          : buildings.length === 0
          ? <Alert severity="info">{t("paramNoBuildings")}</Alert>
          : (
            <BuildingPicker
              buildings={buildings}
              label={label}
              value={values[pname] as string}
              onChange={(uri) => set(pname, uri)}
              disabled={busy}
            />
          );
      case "agent":
        return k.multi
          ? (
            <RecipientAutocomplete
              value={values[pname] as string[]}
              onChange={(r) => set(pname, r)}
              error={helper}
              disabled={busy}
              label={label}
            />
          )
          : (
            <AgentField
              label={label}
              value={values[pname] as string}
              onChange={(v) => set(pname, v)}
              error={showErr}
              helperText={helper}
            />
          );
      case "aggregation":
        return aggregations.length === 0
          ? <Alert severity="info">{t("paramNoAggregations")}</Alert>
          : (
            <FormControl fullWidth disabled={busy} error={showErr}>
              <InputLabel id={`agg-${pname}`}>{label}</InputLabel>
              <Select
                labelId={`agg-${pname}`}
                value={values[pname] as string}
                onChange={(e) => set(pname, e.target.value)}
                input={<OutlinedInput label={label} />}
              >
                {aggregations.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    <ListItemText primary={a.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          );
      case "room":
        return rooms.length === 0
          ? <Alert severity="info">{t("paramNoRooms")}</Alert>
          : (
            <FormControl fullWidth disabled={busy} error={showErr}>
              <InputLabel id={`room-${pname}`}>{label}</InputLabel>
              <Select
                labelId={`room-${pname}`}
                value={values[pname] as string}
                onChange={(e) => set(pname, e.target.value)}
                input={<OutlinedInput label={label} />}
              >
                {rooms.map((uri) => (
                  <MenuItem key={uri} value={uri}>
                    <ListItemText primary={roomHost(uri)} secondary={uri} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          );
      case "boolean":
        return (
          <FormControlLabel
            control={
              <Switch
                checked={values[pname] as boolean}
                onChange={(e) => set(pname, e.target.checked)}
                disabled={busy}
              />
            }
            label={label}
          />
        );
      case "year":
        return (
          <YearChips
            label={label}
            value={values[pname] as string[]}
            onChange={(years) => set(pname, years)}
            disabled={busy}
          />
        );
      default:
        return (
          <TextField
            fullWidth
            size="small"
            label={label}
            value={values[pname] as string}
            onChange={(e) => set(pname, e.target.value)}
            error={showErr}
            helperText={helper}
            disabled={busy}
          />
        );
    }
  }
}

/** Host of a room URI, for the room-picker option label. */
function roomHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/**
 * A multi-year field: type a 4-digit year and press Enter to add a chip. Years
 * are kept as strings (gYear lexical form) and converted to numbers at collect.
 */
function YearChips(props: {
  label: string;
  value: string[];
  onChange: (years: string[]) => void;
  disabled?: boolean;
}) {
  const { label, value, onChange, disabled } = props;
  const [draft, setDraft] = useState("");
  const add = () => {
    const y = draft.trim();
    if (/^\d{4}$/.test(y) && !value.includes(y)) onChange([...value, y]);
    setDraft("");
  };
  return (
    <Box>
      <TextField
        fullWidth
        size="small"
        type="number"
        label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        helperText={msg("paramYearAdd")}
        disabled={disabled}
      />
      {value.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
          {value.map((y) => (
            <Button
              key={y}
              size="small"
              variant="outlined"
              onClick={() => onChange(value.filter((v) => v !== y))}
              disabled={disabled}
            >
              {y} ✕
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
}
