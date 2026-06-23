import { msg } from "../lib/messages.ts";
import { annualMetricLabel } from "../constants/annualMetrics.ts";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  resolveSeriesDay,
  resolveSeriesMonth,
  resolveSeriesTabIndex,
  seriesDayToParams,
  seriesMonthToParams,
  seriesTabToParams,
} from "../services/seriesChartParams.ts";
import { Box, TextField, Typography } from "@mui/material";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import type { EnergyDatasetRef } from "../types.ts";
import {
  useDayReadings,
  useMonthReadings,
  useSeriesDays,
} from "../hooks/queries.ts";
import { formatNumber } from "../lib/formatNumber.ts";
import MetricBarChart from "../components/detail/MetricBarChart.tsx";
import MetricLineChart from "../components/detail/MetricLineChart.tsx";
import CalendarHeatmap from "../components/CalendarHeatmap.tsx";
import { useT } from "../context/I18nProvider.tsx";

const SERIES_COLOR = "rgba(31, 120, 180, 1)";

interface UserEnergyChartProps {
  seriesDatasets: EnergyDatasetRef[];
}

const errText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export default function UserEnergyChart(
  { seriesDatasets }: UserEnergyChartProps,
) {
  const t = useT();
  // The daily reading files live in each series descriptor's container; the
  // listing feeds the date/month pickers (read through the data layer).
  const days = useSeriesDays(seriesDatasets);
  const dateEntries = useMemo(() => days.data ?? [], [days.data]);

  const availableMonths = useMemo(
    () => [...new Set(dateEntries.map((d) => d.day.substring(0, 7)))],
    [dateEntries],
  );

  // ── View tab + day/month pickers — all in the URI (deep-linkable, ui-state.md
  //    → seriesChartParams.ts) ──────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveSeriesTabIndex(searchParams);
  const setActiveTab = (index: number) =>
    setSearchParams((prev) => seriesTabToParams(index, prev), { replace: true });

  // The day/month: the URI's choice when it's still in the listing, else the first
  // day / latest month — derived, so a fresh listing re-defaults with no during-render
  // reset. An absent ?day/?month → the auto-seed.
  const urlDay = resolveSeriesDay(searchParams);
  const selectedDay = urlDay && dateEntries.some((d) => d.day === urlDay)
    ? urlDay
    : (dateEntries[0]?.day ?? "");
  const setSelectedDay = (day: string) =>
    setSearchParams((prev) => seriesDayToParams(day, prev), { replace: true });

  const urlMonth = resolveSeriesMonth(searchParams);
  const selectedMonth = urlMonth && availableMonths.includes(urlMonth)
    ? urlMonth
    : (availableMonths[availableMonths.length - 1] ?? "");
  const setSelectedMonth = (month: string) =>
    setSearchParams((prev) => seriesMonthToParams(month, prev), { replace: true });

  const selectedEntry = dateEntries.find((d) => d.day === selectedDay);
  const dayQuery = useDayReadings(selectedEntry?.uri);
  const readings = useMemo(() => dayQuery.data ?? [], [dayQuery.data]);

  const monthEntries = useMemo(
    () => dateEntries.filter((d) => d.day.startsWith(selectedMonth)),
    [dateEntries, selectedMonth],
  );
  const monthQuery = useMonthReadings(
    monthEntries,
    activeTab === 1 || activeTab === 2 || activeTab === 3,
  );
  const allDaysData = monthQuery.data ?? null;
  const bulkLoading = monthQuery.isFetching;

  // ── Derived data (memoized — a month is ~31 × 96 readings, and any state
  // change re-renders; fresh array identities would also re-render Recharts) ──
  const dailyTotals = useMemo(() =>
    allDaysData
      ? Array.from(allDaysData.entries())
        .map(([day, rs]) => ({
          day,
          total: rs.reduce((s, r) => s + r.value, 0),
        }))
        .sort((a, b) => a.day.localeCompare(b.day))
      : [], [allDaysData]);

  const avgDailyTotal = dailyTotals.length
    ? dailyTotals.reduce((s, d) => s + d.total, 0) / dailyTotals.length
    : 0;

  const avgProfile = useMemo(() => {
    if (!allDaysData) return [];
    const acc = new Map<string, { sum: number; count: number }>();
    allDaysData.forEach((rs) =>
      rs.forEach((r) => {
        const slot = r.begin.substring(11, 16);
        const cur = acc.get(slot) ?? { sum: 0, count: 0 };
        acc.set(slot, { sum: cur.sum + r.value, count: cur.count + 1 });
      })
    );
    return Array.from(acc.entries())
      .map(([slot, { sum, count }]) => ({ slot, avg: sum / count }))
      .sort((a, b) => a.slot.localeCompare(b.slot));
  }, [allDaysData]);

  // ── Chart rows (one `{ t, value }` point per reading/day/slot) ─────────────
  const dayViewRows = useMemo(() =>
    readings.map((r) => ({
      t: r.begin.substring(11, 16),
      value: r.value,
    })), [readings]);
  const dailyTotalsRows = useMemo(() =>
    dailyTotals.map((d) => ({
      t: d.day,
      value: d.total,
    })), [dailyTotals]);
  const avgProfileRows = useMemo(
    () => avgProfile.map((d) => ({ t: d.slot, value: d.avg })),
    [avgProfile],
  );

  const dailyTotal = readings.reduce((sum, r) => sum + r.value, 0);

  // ── Shared month picker + loading/error state ─────────────────────────────
  const monthPickerAndProgress = (
    <>
      <TextField
        type="month"
        size="small"
        label={msg("ucMonth")}
        value={selectedMonth}
        onChange={(e) => setSelectedMonth(e.target.value)}
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: {
            min: availableMonths[0],
            max: availableMonths[availableMonths.length - 1],
          },
        }}
        sx={{ mb: 2, minWidth: 160 }}
      />
      {bulkLoading && (
        <Typography variant="body2" sx={{ mb: 2 }}>
          Loading…
        </Typography>
      )}
      {monthQuery.error != null && (
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>
          {errText(monthQuery.error)}
        </Typography>
      )}
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box>
      <Tabs
        value={activeTab}
        onChange={(_e, v) => setActiveTab(v as number)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={msg("ucDayView")} />
        <Tab label={msg("ucDailyTotals")} />
        <Tab label={msg("ucAvgProfile")} />
        <Tab label={t("calendarTab")} />
      </Tabs>

      {activeTab === 0 && (
        <Box>
          <TextField
            type="date"
            size="small"
            label={msg("ucDate")}
            value={selectedDay}
            onChange={(e) => setSelectedDay(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                min: dateEntries[0]?.day,
                max: dateEntries[dateEntries.length - 1]?.day,
              },
            }}
            sx={{ mb: 2, minWidth: 160 }}
          />

          {dayQuery.isFetching && (
            <Typography variant="body2" sx={{ mb: 1 }}>
              {msg("loadingEllipsis")}
            </Typography>
          )}
          {dayQuery.error != null && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              {errText(dayQuery.error)}
            </Typography>
          )}
          {!dayQuery.isFetching && dayQuery.error == null && selectedDay &&
            !selectedEntry && (
            <Typography variant="body2" color="text.secondary">
              {msg("uecNoData")}
            </Typography>
          )}
          {!dayQuery.isFetching && dayQuery.error == null &&
            readings.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {msg("uecDailyTotal")}{" "}
                <strong>{formatNumber(dailyTotal, 2)} kWh</strong>{" "}
                ({msg("uecReadingsCount", { count: readings.length })})
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricLineChart
                  data={dayViewRows}
                  lines={[{
                    key: "value",
                    name: annualMetricLabel("electricityConsumption"),
                    color: SERIES_COLOR,
                  }]}
                  yUnit="kWh"
                  hideLegend
                />
              </Box>
            </>
          )}
        </Box>
      )}

      {activeTab === 1 && (
        <Box>
          {monthPickerAndProgress}
          {!bulkLoading && allDaysData && dailyTotals.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {msg("uecAvgDaily")}{" "}
                <strong>{formatNumber(avgDailyTotal, 2)} kWh</strong>{" "}
                ({msg("uecDaysCount", { count: dailyTotals.length })})
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricBarChart
                  data={dailyTotalsRows}
                  bars={[{
                    key: "value",
                    name: msg("uecDailyConsumption"),
                    color: "rgba(31, 120, 180, 0.7)",
                  }]}
                  xKey="t"
                  yUnit="kWh"
                  hideLegend
                />
              </Box>
            </>
          )}
        </Box>
      )}

      {activeTab === 2 && (
        <Box>
          {monthPickerAndProgress}
          {!bulkLoading && allDaysData && avgProfile.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {msg("uecAvgProfilePre")}{" "}
                <strong>{msg("uecDaysCount", { count: allDaysData.size })}</strong>
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricLineChart
                  data={avgProfileRows}
                  lines={[{
                    key: "value",
                    name: msg("uecAvgKwh"),
                    color: SERIES_COLOR,
                  }]}
                  yUnit="kWh"
                  hideLegend
                />
              </Box>
            </>
          )}
        </Box>
      )}

      {activeTab === 3 && (
        <Box>
          {monthPickerAndProgress}
          {!bulkLoading && allDaysData && (
            <CalendarHeatmap readingsByDay={allDaysData} />
          )}
        </Box>
      )}
    </Box>
  );
}
