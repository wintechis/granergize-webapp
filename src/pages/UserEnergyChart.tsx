import { useEffect, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import { Box, TextField, Typography } from "@mui/material";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import type { ChartData, ChartOptions } from "chart.js";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { EnergyDatasetRef } from "../../types/types.ts";
import { parseTtlReadings } from "../services/utils/userEnergyParser.ts";
import { listDirectChildren } from "../services/utils/podDelete.ts";

interface UserEnergyChartProps {
  seriesDatasets: EnergyDatasetRef[];
  session: Session;
}

export default function UserEnergyChart(
  { seriesDatasets, session }: UserEnergyChartProps,
) {
  // The daily reading files live in each series descriptor's container; list
  // them (async) to build the date/month pickers.
  const [dateEntries, setDateEntries] = useState<
    Array<{ label: string; location: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: Array<{ label: string; location: string }> = [];
      for (const ref of seriesDatasets) {
        // Descriptor `…/<year>-PT15M.ttl` → sibling `…/<year>-PT15M/` container.
        const container = ref.url.split("#")[0].replace(/\.ttl$/, "/");
        const children = (await listDirectChildren(container, session)) ?? [];
        for (const url of children) {
          if (!url.endsWith(".ttl")) continue;
          entries.push({
            label: url.split("/").pop()!.replace(".ttl", ""),
            location: url,
          });
        }
      }
      entries.sort((a, b) => a.label.localeCompare(b.label));
      if (!cancelled) setDateEntries(entries);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableMonths = [
    ...new Set(dateEntries.map((d) => d.label.substring(0, 7))),
  ];

  // ── Tab 0: Day View ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<0 | 1 | 2>(0);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [readings, setReadings] = useState<
    Array<{ begin: string; value: number }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const entry = dateEntries.find((d) => d.label === selectedLabel);
    if (!entry) return;

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    (async () => {
      try {
        const data = await parseTtlReadings(
          entry.location,
          session.fetch.bind(session),
        );
        if (!cancelled) setReadings(data);
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabel]);

  // ── Tabs 1 & 2: Monthly bulk fetch ───────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // Once the daily files are listed, default the pickers to the first day /
  // latest month (the listing arrives async, after the initial render).
  useEffect(() => {
    if (dateEntries.length === 0) return;
    if (!dateEntries.find((d) => d.label === selectedLabel)) {
      setSelectedLabel(dateEntries[0].label);
    }
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[availableMonths.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateEntries]);
  const [allDaysData, setAllDaysData] = useState<
    Map<string, Array<{ begin: string; value: number }>> | null
  >(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ loaded: 0, total: 0 });
  const [bulkError, setBulkError] = useState<string | null>(null);

  const monthEntries = dateEntries.filter((d) =>
    d.label.startsWith(selectedMonth)
  );

  async function fetchMonthDays() {
    if (bulkLoading) return;
    setBulkLoading(true);
    setAllDaysData(null);
    setBulkError(null);
    setBulkProgress({ loaded: 0, total: monthEntries.length });

    const result = new Map<string, Array<{ begin: string; value: number }>>();
    try {
      const settled = await Promise.allSettled(
        monthEntries.map((e) =>
          parseTtlReadings(e.location, session.fetch.bind(session)).then((
            data,
          ) => ({ label: e.label, data }))
        ),
      );
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") result.set(r.value.label, r.value.data);
        setBulkProgress({ loaded: i + 1, total: monthEntries.length });
      });
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : String(err));
    }

    setAllDaysData(result);
    setBulkLoading(false);
  }

  useEffect(() => {
    if (activeTab === 1 || activeTab === 2) fetchMonthDays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedMonth]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const dailyTotals = allDaysData
    ? Array.from(allDaysData.entries())
      .map(([label, rs]) => ({
        label,
        total: rs.reduce((s, r) => s + r.value, 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    : [];

  const avgDailyTotal = dailyTotals.length
    ? dailyTotals.reduce((s, d) => s + d.total, 0) / dailyTotals.length
    : 0;

  const avgProfile = (() => {
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
  })();

  // ── Chart configs ─────────────────────────────────────────────────────────
  const dayViewChartData: ChartData<"line", number[], string> = {
    labels: readings.map((r) => r.begin.substring(11, 16)),
    datasets: [{
      label: "Electricity Consumption (kWh)",
      data: readings.map((r) => r.value),
      borderColor: "rgba(31, 120, 180, 1)",
      backgroundColor: "rgba(31, 120, 180, 0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 2,
    }],
  };

  const dayViewOptions: ChartOptions<"line"> = {
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: "Time of day" } },
      y: { title: { display: true, text: "kWh" }, beginAtZero: true },
    },
  };

  const dailyTotalsChartData: ChartData<"bar", number[], string> = {
    labels: dailyTotals.map((d) => d.label),
    datasets: [{
      label: "Daily Consumption (kWh)",
      data: dailyTotals.map((d) => d.total),
      backgroundColor: "rgba(31, 120, 180, 0.7)",
      borderColor: "rgba(31, 120, 180, 1)",
      borderWidth: 1,
    }],
  };

  const dailyTotalsOptions: ChartOptions<"bar"> = {
    elements: { bar: { inflateAmount: 0 } },
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: "Date" } },
      y: { title: { display: true, text: "kWh" }, beginAtZero: true },
    },
  };

  const avgProfileChartData: ChartData<"line", number[], string> = {
    labels: avgProfile.map((d) => d.slot),
    datasets: [{
      label: "Average kWh",
      data: avgProfile.map((d) => d.avg),
      borderColor: "rgba(31, 120, 180, 1)",
      backgroundColor: "rgba(31, 120, 180, 0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 2,
    }],
  };

  const avgProfileOptions: ChartOptions<"line"> = {
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: "Time of day" } },
      y: { title: { display: true, text: "avg kWh" }, beginAtZero: true },
    },
  };

  const dailyTotal = readings.reduce((sum, r) => sum + r.value, 0);

  // ── Shared month picker + progress ────────────────────────────────────────
  const monthPickerAndProgress = (
    <>
      <TextField
        type="month"
        size="small"
        label="Month"
        value={selectedMonth}
        onChange={(e) => {
          setAllDaysData(null);
          setSelectedMonth(e.target.value);
        }}
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
          Loading {bulkProgress.loaded} / {bulkProgress.total} days…
        </Typography>
      )}
      {bulkError && (
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>
          {bulkError}
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
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: {
                min: dateEntries[0]?.label,
                max: dateEntries[dateEntries.length - 1]?.label,
              },
            }}
            sx={{ mb: 2, minWidth: 160 }}
          />

          {loading && (
            <Typography variant="body2" sx={{ mb: 1 }}>Loading…</Typography>
          )}
          {fetchError && (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              {fetchError}
            </Typography>
          )}
          {!loading && !fetchError && selectedLabel && !dateEntries.find((d) =>
            d.label === selectedLabel
          ) && (
            <Typography variant="body2" color="text.secondary">
              No data available for this date.
            </Typography>
          )}
          {!loading && !fetchError && readings.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Daily total:{" "}
                <strong>
                  {dailyTotal.toLocaleString("de-DE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} kWh
                </strong>{" "}
                ({readings.length} readings)
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <Line data={dayViewChartData} options={dayViewOptions} />
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
                <strong>
                  {avgDailyTotal.toLocaleString("de-DE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} kWh
                </strong>{" "}
                ({dailyTotals.length} days)
              </Typography>
              <Box sx={{ position: "relative", width: "100%" }}>
                <Bar data={dailyTotalsChartData} options={dailyTotalsOptions} />
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
                <Line data={avgProfileChartData} options={avgProfileOptions} />
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
