import { useEffect, useMemo, useRef, useState } from "react";
import {
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  TextField,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import { useBuildings } from "../hooks/queries.ts";
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import {
  buildCommandList,
  buildingNavCommands,
  buildingObservationCommands,
  filterCommands,
  intentDialogAction,
  type NavTarget,
  type PaletteCommand,
  resolveBuildingByQuery,
} from "../lib/commandPalette.ts";
import type { IntentEntry, IntentObject } from "../intents/applicable.ts";
import {
  AGGREGATIONS_VIEW,
  aggregationRoute,
  buildingRoute,
  FINDERS,
  observationRoute,
  withAction,
} from "../routes.ts";
import type { AggregationDefinition, Building } from "../types.ts";
import IntentParamForm from "./IntentParamForm.tsx";
import { useInvokeIntent } from "../hooks/invokeIntent.ts";
import { getGateway } from "../hooks/session.ts";
import { queryByName } from "../intents/registry.ts";
import { LaunchError, parseLaunch } from "../intents/launch.ts";
import { goTo } from "../intents/navigate.ts";
import { useTrailState } from "../hooks/navTrail.ts";
import {
  translateToIntentJson,
  TranslateError,
} from "../intents/llm/intentTranslate.ts";
import {
  type ReadResultView,
  summarizeReadResult,
} from "../lib/paletteResult.ts";

/**
 * The global ⌘K command palette (plan-palette §4) — the intent catalog made a
 * *callable surface for humans*. A `⌘K` / `Ctrl-K` hotkey opens it; it reads the
 * **same** intent registry the per-object action menus do, scoped to the
 * **focused** object (registered in {@link usePaletteFocus}) — so it offers a
 * verb exactly when that object's menu would — plus the global navigation verbs.
 *
 * Invocation (§4–5): a **navigation** command pushes its route; a **param-less**
 * object verb (hide/delete/refresh) fires the surface's registered handler
 * directly; a **param-ful** verb (share/edit/create) routes to its existing
 * bespoke dialog by navigating to the object's page (the descriptor's `surface`
 * lives there) — the palette does NOT auto-generate forms. Keyboard-navigable
 * (↑/↓ + Enter); Escape and select close.
 *
 * Mounted once in the app shell. Built on {@link Modal} (UI-conventions: the one
 * dialog wrapper) with a filter field + a keyboard-driven list — no bespoke
 * spinner, no raw MUI `Dialog`.
 */

/** The global navigation targets, in top-nav order (mirrors AppShell's NAV). Each
 * route is resolved through the catalog **navigate** cores (`goTo`) so the palette's
 * finder nav and the launcher/LLM share one source of truth (the trinity's navigate
 * arm), rather than the palette duplicating `FINDERS.*`. */
const NAV_TARGETS: NavTarget[] = (
  [
    ["ShowBuildings", "navBuildings"],
    ["ShowObservations", "navObservations"],
    ["ShowAggregations", "navAggregations"],
    ["ShowSharing", "navSharing"],
    ["ShowAgents", "navAgents"],
    ["ShowRooms", "navMeet"],
  ] as const
).map(([name, labelKey]) => ({ path: goTo(name), labelKey }));

function isBuilding(o: IntentObject): o is Building {
  return !!o && typeof o === "object" && "uri" in o && "id" in o && "type" in o;
}
function isAggregation(o: IntentObject): o is AggregationDefinition {
  return !!o && typeof o === "object" && "aggregationType" in o &&
    "buildingUris" in o;
}

/**
 * Where to route a param-ful verb so its bespoke dialog can collect the params.
 * For an object verb that's the object's detail page (Edit/Share live there); for
 * a collection create verb (no focused object) it's the matching finder, whose Add
 * button opens the dialog. `null` when no route is known.
 */
function dialogRoute(
  entry: IntentEntry,
  object: IntentObject,
): string | null {
  if (isBuilding(object)) {
    // Energy entry lives on the OBSERVATION surface, not the building page — its
    // dialog (EnergyYearEditor) is reached via /observation, where it auto-opens
    // from `?action=enter-energy`. Every other building verb stays on /building.
    return entry.entity === "observation"
      ? observationRoute(object.id)
      : buildingRoute(object.id);
  }
  if (isAggregation(object)) return aggregationRoute(object.id);
  // No focused object → a collection verb: go to the finder that owns its dialog.
  if (entry.entity === "building") return FINDERS.buildings;
  if (entry.entity === "aggregation") return AGGREGATIONS_VIEW;
  return null;
}

/**
 * The heavy body of the command palette — lazy-loaded by the thin
 * {@link CommandPalette} host on first open, so the intent registry and its
 * transitive deps (mastr/navTrail/charts/LLM-translate) stay out of the initial
 * bundle. The host owns the `open` state and the global ⌘K / open-event
 * listeners; this is a controlled dialog driven by `open` / `onClose`.
 */
export default function CommandPaletteBody(
  { open, onClose }: { open: boolean; onClose: () => void },
) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The second step: the form-eligible intent whose param form is shown in place
  // of the command list (null = the command list is shown).
  const [formIntent, setFormIntent] = useState<string | null>(null);
  // The param form's close-guard state, reported up by IntentParamForm: dirty
  // once a param holds a value (Escape confirms), busy while its invoke is in
  // flight (closing suppressed) — the standard Modal guard semantics.
  const [formGuard, setFormGuard] = useState({ dirty: false, busy: false });
  // Dev-mode JSON paste-and-launch (§10): the inline parse/dispatch error, shown
  // under the field when a pasted `{name,params}` can't be launched.
  const [launchError, setLaunchError] = useState<string | null>(null);
  // A launched READ's result, rendered inline in place of the command list (the
  // launcher's read branch). Cleared on close or when the field is edited.
  const [result, setResult] = useState<ReadResultView | null>(null);
  // Dev-mode NL→intent translation in flight (the `>` prefix path).
  const [translating, setTranslating] = useState(false);
  // Set while a timed-out translate is being retried — drives the "retry a/of" note.
  const [translateRetry, setTranslateRetry] = useState<[number, number] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = useT();
  const devMode = useDevMode();
  const navigate = useNavigate();
  const trailState = useTrailState();
  // Navigate, recording the location the palette was opened from as the back trail
  // (history state) when the target is a detail page — same as a finder row / marker.
  const go = (route: string) => navigate(route, { state: trailState(route) });
  const { focus } = usePaletteFocus();
  const invokeIntent = useInvokeIntent();
  const buildings = useBuildings();

  // Reset the filter + selection each time the palette opens, so the field starts
  // empty every time (the host owns `open`; the open→true transition is the reset
  // signal — the controlled-dialog equivalent of the old in-updater reset).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- deliberate open→clear */
    setQuery("");
    setActive(0);
    setFormIntent(null);
    setLaunchError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  // Focus the filter field when the palette opens (a DOM side effect, not state).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const commands = useMemo(
    () =>
      buildCommandList({
        object: focus.object,
        viewer: { devMode },
        navTargets: NAV_TARGETS,
        handlers: focus.handlers,
        t,
      }),
    [focus.object, focus.handlers, devMode, t],
  );
  // Search-only "jump to a building" commands: the user's buildings as direct nav
  // targets (own or shared — `buildingRoute` encodes `?ref=`/`?uri=`). A
  // quick-switcher surfaced ONLY while filtering, so the default palette stays the
  // finders + verbs and isn't flooded with every building.
  const buildingList = useMemo(
    () => (Array.isArray(buildings.data) ? [] : buildings.data?.buildings ?? []),
    [buildings.data],
  );
  const buildingCommands = useMemo<PaletteCommand[]>(
    () => buildingNavCommands(buildingList),
    [buildingList],
  );
  // Search-only "Add observation to <building>" quick actions — one per owned
  // building, routing to its observation page with the dialog auto-opened.
  const observationCommands = useMemo<PaletteCommand[]>(
    () =>
      buildingObservationCommands(
        buildingList,
        (name) => t("paletteAddObservation", { name }),
      ),
    [buildingList, t],
  );
  const filtered = useMemo(() => {
    const base = filterCommands(commands, query);
    if (!query.trim()) return base;
    return [
      ...base,
      ...filterCommands(buildingCommands, query),
      ...filterCommands(observationCommands, query),
    ];
  }, [commands, buildingCommands, observationCommands, query]);

  // Clamp the highlighted index into range as the list shrinks under the filter,
  // derived at render rather than synced via setState-in-effect.
  const activeIdx = filtered.length === 0
    ? 0
    : Math.min(active, filtered.length - 1);

  // Paste-and-launch (§10): a query that starts with `{` is a pasted JSON intent,
  // not a filter — the palette becomes the launcher's pre-filled input mode. This is
  // also where the NL translation below lands its reviewed JSON, so it is not
  // dev-gated.
  const jsonMode = query.trim().startsWith("{");
  // NL mode (§10 front half): a query starting with `>` is natural language the LLM
  // translates into intent JSON, which then lands in jsonMode for review. The
  // natural-language launcher is a user-facing feature, not a dev-only affordance.
  const nlMode = query.trim().startsWith(">");

  const close = () => {
    onClose();
    setFormIntent(null);
    setLaunchError(null);
    setResult(null);
    setTranslating(false);
    setTranslateRetry(null);
  };

  /**
   * Resolve a read intent's `building` param when the launcher passed a name/address
   * (the LLM has no id list) instead of an IRI — to the building's subject IRI, so
   * the read's EntityQuery resolution finds it. A pass-through for IRIs and reads
   * with no `building` param.
   */
  const resolveReadParams = (
    params: Record<string, unknown>,
  ): Record<string, unknown> => {
    const b = params.building;
    if (typeof b === "string" && !b.includes("://")) {
      const match = resolveBuildingByQuery(buildingList, b);
      if (match) return { ...params, building: match.uri };
    }
    return params;
  };

  /**
   * Launch a pasted `{ name, params }` (§10): parse + resolve the effect, then
   * dispatch — a write through the shared {@link useInvokeIntent} effect (central
   * toast + blanket invalidate, the same as the form/direct-invoke paths), a read
   * through {@link queryByName} with a "Done" toast. A parse/resolve failure shows
   * its reason inline. This is the launcher, not an interpreter: the JSON is a
   * fully-specified invocation, not a language.
   */
  const runLaunch = async () => {
    let parsed;
    try {
      parsed = parseLaunch(query);
    } catch (e) {
      setLaunchError(
        e instanceof LaunchError ? e.message : (e as Error).message,
      );
      return;
    }
    setLaunchError(null);
    if (parsed.effect === "write") {
      close();
      void invokeIntent(parsed.name, parsed.params);
      return;
    }
    if (parsed.effect === "read") {
      try {
        // The LLM passes a building NAME/address for a `building` param (it has no
        // id list) — resolve it to the real subject IRI before the query, mirroring
        // the ShowBuilding navigate path below.
        const params = resolveReadParams(parsed.params);
        const value = await queryByName(parsed.name, params, getGateway());
        setResult(summarizeReadResult(parsed.name, value, t));
      } catch (e) {
        setLaunchError((e as Error).message);
      }
      return;
    }
    // navigate (§7): resolve the route via the gateway-less goTo arm and push it
    // client-side — same as the palette's own nav commands.
    try {
      let params = parsed.params;
      // The LLM passes a building NAME/address for ShowBuilding (it has no id list) —
      // resolve it to the real id against the loaded buildings before routing.
      if (
        parsed.name === "ShowBuilding" &&
        typeof (params as { id?: unknown }).id === "string"
      ) {
        const b = resolveBuildingByQuery(buildingList, (params as { id: string }).id);
        if (b) params = { ...params, id: b.id };
      }
      const route = goTo(parsed.name, params);
      close();
      void go(route);
    } catch (e) {
      setLaunchError((e as Error).message);
    }
  };

  /**
   * Translate a `>`-prefixed natural-language request into intent JSON via the LLM
   * (§10 front half) and drop the result into the field — which flips the palette
   * into jsonMode, so the user *reviews* the JSON and presses Enter again to launch.
   * The translator never auto-fires; a wrong guess is caught by the launcher's
   * validation downstream.
   */
  const runTranslate = async () => {
    const text = query.trim().slice(1).trim(); // drop the leading ">"
    if (!text) return;
    setLaunchError(null);
    setTranslateRetry(null);
    setTranslating(true);
    try {
      const json = await translateToIntentJson(text, {
        // On a timeout the call retries once; reflect it in the busy hint.
        onRetry: (a, of) => setTranslateRetry([a, of]),
      });
      setQuery(json);
      inputRef.current?.focus();
    } catch (e) {
      setLaunchError(
        e instanceof TranslateError ? e.message : (e as Error).message,
      );
    } finally {
      setTranslating(false);
      setTranslateRetry(null);
    }
  };

  const run = (cmd: PaletteCommand) => {
    if (cmd.family === "intent" && cmd.entry && cmd.routesToForm) {
      // Second step: open the schema-driven param form in place of the list (no
      // focused object needed). Keep the Modal open; the form invokes on submit.
      setFormIntent(cmd.entry.name);
      return;
    }
    if (cmd.family === "intent" && cmd.entry && cmd.routesToDirect) {
      // Param-less write verb: fire it straight away with no params, the same
      // headless entry + success/error feedback the form uses. Close on success;
      // a failure has already toasted centrally (none of these is silentError).
      close();
      void invokeIntent(cmd.entry.name, {});
      return;
    }
    close();
    if (cmd.family === "navigation" && cmd.path) {
      void go(cmd.path);
      return;
    }
    if (cmd.family === "intent" && cmd.entry) {
      if (cmd.routesToDialog) {
        // Param-ful (rich) verb: route to the bespoke dialog's surface (the
        // object's page or the finder), appending `?action=…` so the surface
        // *opens* its existing dialog/editor on arrival. The palette never
        // auto-generates the form (plan-palette §5) — it routes to + opens the
        // bespoke one. A verb with no auto-open token still routes to the page.
        const route = dialogRoute(cmd.entry, focus.object);
        if (!route) return;
        const action = intentDialogAction(cmd.entry);
        void go(action ? withAction(route, action) : route);
        return;
      }
      // Param-less verb: fire the surface's registered handler directly.
      focus.handlers[cmd.entry.name]?.();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (nlMode) {
      // Enter translates the NL to JSON (then jsonMode takes over); arrows inert.
      if (e.key === "Enter") {
        e.preventDefault();
        if (!translating) void runTranslate();
      }
      return;
    }
    if (jsonMode) {
      // In paste-and-launch mode the list is hidden; Enter launches, arrows inert.
      if (e.key === "Enter") {
        e.preventDefault();
        void runLaunch();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIdx + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIdx - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) run(cmd);
    }
  };

  // Group boundaries for the two subheaders (navigation, then actions).
  const firstIntentIdx = filtered.findIndex((c) => c.family === "intent");
  const hasNav = filtered.some((c) => c.family === "navigation");

  return (
    <Modal
      open={open}
      onClose={close}
      title={null}
      dismissable
      dirty={formIntent != null && formGuard.dirty}
      busy={formIntent != null && formGuard.busy}
      maxWidth="sm"
    >
      {result
        ? (
          renderResult()
        )
        : formIntent
        ? (
          <IntentParamForm
            name={formIntent}
            onDone={close}
            onCancel={() => setFormIntent(null)}
            onGuardChange={setFormGuard}
          />
        )
        : (
          renderCommandList()
        )}
    </Modal>
  );

  // A render HELPER (not a nested component, like renderCommandList) for a launched
  // read's result: the title + rows from {@link summarizeReadResult}, with the filter
  // field kept above so editing it clears the result and returns to the launcher.
  function renderResult() {
    return (
      <>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          autoComplete="off"
          placeholder={t("palettePlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setResult(null);
            if (launchError) setLaunchError(null);
          }}
          onKeyDown={onListKeyDown}
          aria-label={t("palettePlaceholder")}
          sx={{ mb: 1 }}
        />
        <Typography variant="h6" sx={{ mb: 1 }}>{result!.title}</Typography>
        {result!.rows.length === 0
          ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {t("paletteEmpty")}
            </Typography>
          )
          : (
            <List dense disablePadding sx={{ maxHeight: 360, overflow: "auto" }}>
              {result!.rows.map((r, i) => (
                <ListItem key={i}>
                  <ListItemText primary={r.primary} secondary={r.secondary} />
                </ListItem>
              ))}
            </List>
          )}
      </>
    );
  }

  // A render HELPER, not a nested component. Rendering it as `<CommandList/>` gave it
  // a fresh function identity every render, so React remounted the whole subtree —
  // including the filter `<input>` — on each keystroke, dropping focus after the first
  // character (the palette only ever kept one typed char). Calling it inlines the JSX,
  // so the field is reconciled in place and keeps focus through typing.
  function renderCommandList() {
    return (
      <>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          autoComplete="off"
          placeholder={t("palettePlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (launchError) setLaunchError(null);
          }}
          onKeyDown={onListKeyDown}
          aria-label={t("palettePlaceholder")}
          sx={{ mb: 1 }}
        />
        {nlMode
          ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                {translating
                  ? (translateRetry
                    ? `${t("paletteNlBusy")} (${t("paletteNlRetry")} ${translateRetry[0]}/${translateRetry[1]})`
                    : t("paletteNlBusy"))
                  : t("paletteNlHint")}
              </Typography>
              {launchError && (
                <Typography variant="body2" color="error" sx={{ pb: 1 }}>
                  {launchError}
                </Typography>
              )}
            </>
          )
          : jsonMode
          ? (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                {t("paletteLaunchHint")}
              </Typography>
              {launchError && (
                <Typography variant="body2" color="error" sx={{ pb: 1 }}>
                  {launchError}
                </Typography>
              )}
            </>
          )
          : filtered.length === 0
          ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {t("paletteEmpty")}
            </Typography>
          )
          : (
            <List dense disablePadding sx={{ maxHeight: 360, overflow: "auto" }}>
              {filtered.map((cmd, idx) => (
                <div key={cmd.key}>
                  {hasNav && idx === 0 && (
                    <ListSubheader disableSticky>
                      {t("paletteGroupNavigation")}
                    </ListSubheader>
                  )}
                  {idx === firstIntentIdx && firstIntentIdx > -1 && (
                    <ListSubheader disableSticky>
                      {t("paletteGroupActions")}
                    </ListSubheader>
                  )}
                  <ListItemButton
                    selected={idx === activeIdx}
                    onClick={() => run(cmd)}
                    onMouseEnter={() => setActive(idx)}
                  >
                    <ListItemText primary={cmd.label} />
                  </ListItemButton>
                </div>
              ))}
            </List>
          )}
      </>
    );
  }
}
