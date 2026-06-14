import { useMemo, useState } from "react";
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

const SERIES_COLOR = "rgba(31, 120, 180, 1)";

interface UserEnergyChartProps {
  seriesDatasets: EnergyDatasetRef[];
}

const errText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export default function UserEnergyChart(
  { seriesDatasets }: UserEnergyChartProps,
) {
  // The daily reading files live in each series descriptor's container; the
  // listing feeds the date/month pickers (read through the data layer).
  const days = useSeriesDays(seriesDatasets);
  const dateEntries = useMemo(() => days.data ?? [], [days.data]);

  const availableMonths = useMemo(
    () => [...new Set(dateEntries.map((d) => d.day.substring(0, 7)))],
    [dateEntries],
  );

  // ── Tab 0: Day View ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const selectedEntry = dateEntries.find((d) => d.day === selectedDay);
  const dayQuery = useDayReadings(selectedEntry?.url);
  const readings = useMemo(() => dayQuery.data ?? [], [dayQuery.data]);

  // ── Tabs 1 & 2: Monthly bulk fetch ───────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // Once the daily files are listed, default the pickers to the first day /
  // latest month (the listing arrives async, after the initial render). The
  // during-render reset keyed on the list identity (vs an effect) reseeds only
  // when the listing actually changes — no cascading second render.
  const [seededFor, setSeededFor] = useState(dateEntries);
  if (dateEntries !== seededFor) {
    setSeededFor(dateEntries);
    if (dateEntries.length > 0) {
      if (!dateEntries.find((d) => d.day === selectedDay)) {
        setSelectedDay(dateEntries[0].day);
      }
      if (!availableMonths.includes(selectedMonth)) {
        setSelectedMonth(availableMonths[availableMonths.length - 1]);
      }
    }
  }

  const monthEntries = useMemo(
    () => dateEntries.filter((d) => d.day.startsWith(selectedMonth)),
    [dateEntries, selectedMonth],
  );
  const monthQuery = useMonthReadings(
    monthEntries,
    activeTab === 1 || activeTab === 2,
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
        label="Month"
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
        onChange={(_e, v) => setActiveTab(v as 0 | 1 | 2)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Day View" />
        <Tab label="Daily Totals" />
        <Tab label="Average Profile" />
      </Tabs>

      {activeTab === 0 && (
        <Box>
          <TextField
            type="date"
            size="small"
            label="Date"
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
            <Typography variant="body2" sx={{ mb: 1 }}>Loading…</Typography>
          )}
          {dayQuery.error != null && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              {errText(dayQuery.error)}
            </Typography>
          )}
          {!dayQuery.isFetching && dayQuery.error == null && selectedDay &&
            !selectedEntry && (
            <Typography variant="body2" color="text.secondary">
              No data available for this date.
            </Typography>
          )}
          {!dayQuery.isFetching && dayQuery.error == null &&
            readings.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Daily total: <strong>{formatNumber(dailyTotal, 2)} kWh</strong>
                {" "}
                ({readings.length} readings)
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricLineChart
                  data={dayViewRows}
                  lines={[{
                    key: "value",
                    name: "Electricity Consumption (kWh)",
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
                Average daily consumption:{" "}
                <strong>{formatNumber(avgDailyTotal, 2)} kWh</strong>{" "}
                ({dailyTotals.length} days)
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricBarChart
                  data={dailyTotalsRows}
                  bars={[{
                    key: "value",
                    name: "Daily Consumption (kWh)",
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
                Average 15-minute profile across{" "}
                <strong>{allDaysData.size} days</strong>
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <MetricLineChart
                  data={avgProfileRows}
                  lines={[{
                    key: "value",
                    name: "Average kWh",
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
    </Box>
  );
}
