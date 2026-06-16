import { useEffect, useMemo, useRef, useState } from "react";
import {
  List,
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
import { usePaletteFocus } from "../context/PaletteFocusContext.tsx";
import {
  buildCommandList,
  filterCommands,
  intentDialogAction,
  type NavTarget,
  type PaletteCommand,
} from "../lib/commandPalette.ts";
import type { IntentEntry, IntentObject } from "../intents/applicable.ts";
import {
  aggregationRoute,
  buildingRoute,
  FINDERS,
  observationRoute,
  withAction,
} from "../routes.ts";
import type { AggregationDefinition, BuildingType } from "../types.ts";

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

/** The global navigation targets, in top-nav order (mirrors AppShell's NAV). */
const NAV_TARGETS: NavTarget[] = [
  { path: FINDERS.buildings, labelKey: "navBuildings" },
  { path: FINDERS.observations, labelKey: "navObservations" },
  { path: FINDERS.aggregations, labelKey: "navAggregations" },
  { path: FINDERS.sharing, labelKey: "navSharing" },
  { path: FINDERS.contacts, labelKey: "navContacts" },
  { path: FINDERS.rooms, labelKey: "navMeet" },
];

function isBuilding(o: IntentObject): o is BuildingType {
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
    // dialog (EnergyYearDialog) is reached via /observation, where it auto-opens
    // from `?action=enter-energy`. Every other building verb stays on /building.
    return entry.entity === "observation"
      ? observationRoute(object.id)
      : buildingRoute(object.id);
  }
  if (isAggregation(object)) return aggregationRoute(object.id);
  // No focused object → a collection verb: go to the finder that owns its dialog.
  if (entry.entity === "building") return FINDERS.buildings;
  if (entry.entity === "aggregation") return FINDERS.aggregations;
  return null;
}

/** A visible header button dispatches this on `globalThis` to open the palette
 * without the keyboard — also a path around the browser's Ctrl-K collision. */
export const OPEN_PALETTE_EVENT = "granergize:open-palette";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = useT();
  const devMode = useDevMode();
  const navigate = useNavigate();
  const { focus } = usePaletteFocus();

  // ⌘K / Ctrl-K toggles the palette. Opening resets the filter + selection in the
  // same updater (no setState-in-effect), so the field starts empty each time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setActive(0);
          }
          return !v;
        });
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  // A visible header button opens the palette via this event (no keyboard needed).
  useEffect(() => {
    const onOpen = () => {
      setQuery("");
      setActive(0);
      setOpen(true);
    };
    globalThis.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => globalThis.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
  }, []);

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
  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  // Clamp the highlighted index into range as the list shrinks under the filter,
  // derived at render rather than synced via setState-in-effect.
  const activeIdx = filtered.length === 0
    ? 0
    : Math.min(active, filtered.length - 1);

  const close = () => setOpen(false);

  const run = (cmd: PaletteCommand) => {
    close();
    if (cmd.family === "navigation" && cmd.path) {
      void navigate(cmd.path);
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
        void navigate(action ? withAction(route, action) : route);
        return;
      }
      // Param-less verb: fire the surface's registered handler directly.
      focus.handlers[cmd.entry.name]?.();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
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
      maxWidth="sm"
    >
      <TextField
        inputRef={inputRef}
        fullWidth
        size="small"
        autoComplete="off"
        placeholder={t("palettePlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onListKeyDown}
        aria-label={t("palettePlaceholder")}
        sx={{ mb: 1 }}
      />
      {filtered.length === 0
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
    </Modal>
  );
}
