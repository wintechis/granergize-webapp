import { useMemo } from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  buildCalendarGrid,
  CALENDAR_RAMP_COLOR,
  calendarColorScale,
  type ReadingsByDay,
} from "../services/rdf/energyCalendar.ts";
import { useT } from "../context/I18nProvider.tsx";
import { formatNumber } from "../lib/formatNumber.ts";

/**
 * The **calendar heatmap** (Step 5 of `plans/plan-cube-ui.md`): a building's
 * `PT15M` series for one month flattened onto a **day × hour** grid — rows are the
 * month's days, the 24 columns are the hours of the day, each cell the summed kWh
 * of that hour, coloured on a sequential blue ramp (darker = more). The line chart
 * shows the profile *within* a day; this reveals the recurring load pattern
 * *across* days that a line hides (the daily peak hour, a weekend dip).
 *
 * Pure render over `buildCalendarGrid` (the unit-tested binning fn) and the same
 * `ReadingsByDay` the daily/profile charts already bulk-load (`useMonthReadings`) —
 * so the heatmap and those charts stay in step on the same month. Loading and the
 * month picker are owned by the caller (`UserEnergyChart`): this is the grid only,
 * fed already-warm data; no fetch, no spinner (CLAUDE.md — the header indicator is
 * the one spinner).
 */

const CELL = 14;
const DAY_COL = 84;
// Label only every third hour column so 24 columns don't crowd at this cell size.
const HOUR_LABEL_STEP = 3;

interface CalendarHeatmapProps {
  /** One month of day files keyed by `YYYY-MM-DD` (from `useMonthReadings`). */
  readingsByDay: ReadingsByDay;
}

export default function CalendarHeatmap({ readingsByDay }: CalendarHeatmapProps) {
  const t = useT();
  const grid = useMemo(() => buildCalendarGrid(readingsByDay), [readingsByDay]);
  const colorOf = useMemo(
    () => calendarColorScale(grid.min, grid.max),
    [grid.min, grid.max],
  );

  if (grid.rows.length === 0 || grid.max == null) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("calendarNoData")}
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("calendarSubtitle")}
      </Typography>

      <Box sx={{ overflow: "auto", maxWidth: "100%" }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `${DAY_COL}px repeat(24, ${CELL}px)`,
            alignItems: "center",
            gap: "2px",
            width: "max-content",
          }}
        >
          {/* Header row: a corner cell labelling the hour axis, then hour ticks. */}
          <Typography variant="caption" sx={{ color: "text.secondary", pr: 1 }}>
            {t("calendarAxisHour")} →
          </Typography>
          {Array.from({ length: 24 }, (_, h) => (
            <Typography
              key={h}
              variant="caption"
              sx={{ textAlign: "center", color: "text.secondary", lineHeight: 1 }}
            >
              {h % HOUR_LABEL_STEP === 0 ? h : ""}
            </Typography>
          ))}

          {/* One row per day: the date, then a cell per hour. */}
          {grid.rows.map((row) => (
            <Box key={row.day} sx={{ display: "contents" }}>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", pr: 1, whiteSpace: "nowrap" }}
              >
                {row.day}
              </Typography>
              {row.cells.map((cell) => {
                const has = cell.value != null;
                const title = has
                  ? `${row.day} ${String(cell.hour).padStart(2, "0")}:00 — ${
                    formatNumber(cell.value as number, 2)
                  } kWh`
                  : `${row.day} ${
                    String(cell.hour).padStart(2, "0")
                  }:00 — ${t("calendarNoData")}`;
                return (
                  <Tooltip key={cell.hour} title={title} arrow>
                    <Box
                      aria-label={title}
                      sx={{
                        height: CELL,
                        borderRadius: "2px",
                        backgroundColor: has ? colorOf(cell.value) : "transparent",
                        border: has ? "none" : "1px dashed",
                        borderColor: "divider",
                      }}
                    />
                  </Tooltip>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Legend: the sequential ramp from pale to full, with less/more captions. */}
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}
      >
        <Typography variant="caption" color="text.secondary">
          {t("calendarLegendLess")}
        </Typography>
        <Box
          sx={{
            width: 96,
            height: 10,
            borderRadius: "2px",
            background:
              `linear-gradient(to right, ${colorOf(grid.min)}, ${CALENDAR_RAMP_COLOR})`,
            border: "1px solid",
            borderColor: "divider",
          }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("calendarLegendMore")}
        </Typography>
      </Box>
    </Box>
  );
}
