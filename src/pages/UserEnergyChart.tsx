import { useState, useEffect } from "react";
import { Line } from "react-chartjs-2";
import {
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import type { ChartData, ChartOptions } from "chart.js";
import { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store, DataFactory } from "n3";
import type { EnergyMeasurementData } from "../../types/types.ts";

const USERVOC_NS = "https://solid.ti.rw.fau.de/private/granergize/user-vocab.ttl#";
const SOSA_NS    = "http://www.w3.org/ns/sosa/";
const TIME_NS    = "http://www.w3.org/2006/time#";
const RDF_TYPE   = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const { namedNode } = DataFactory;

interface UserEnergyChartProps {
  availableDates: EnergyMeasurementData[];
  session: Session;
}

export default function UserEnergyChart({ availableDates, session }: UserEnergyChartProps) {
  // Derive sorted date labels from the location URLs (e.g. ".../2024-01-01.ttl" - "2024-01-01")
  const dateEntries = availableDates
    .map((d) => ({
      label: d.location.split("/").pop()?.replace(".ttl", "") ?? d.location,
      location: d.location,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const [selectedLabel, setSelectedLabel] = useState<string>(dateEntries[0]?.label ?? "");
  const [readings, setReadings] = useState<Array<{ begin: string; value: number }>>([]);
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
        const response = await session.fetch(entry.location);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const text = await response.text();
        const parser = new Parser({ baseIRI: entry.location });
        const quads = parser.parse(text);
        const store = new Store(quads);

        const readingQuads = store.getQuads(
          null,
          namedNode(RDF_TYPE),
          namedNode(`${USERVOC_NS}EnergyConsumptionReading`),
          null,
        );

        const parsed: Array<{ begin: string; value: number }> = [];
        readingQuads.forEach((obs) => {
          const resultQs = store.getQuads(obs.subject, namedNode(`${SOSA_NS}hasResult`), null, null);
          if (!resultQs.length) return;
          const valueQs = store.getQuads(resultQs[0].object, namedNode(`${SOSA_NS}hasSimpleResult`), null, null);
          if (!valueQs.length) return;

          const timeQs = store.getQuads(obs.subject, namedNode(`${SOSA_NS}phenomenonTime`), null, null);
          if (!timeQs.length) return;
          const beginQs = store.getQuads(timeQs[0].object, namedNode(`${TIME_NS}hasBeginning`), null, null);
          if (!beginQs.length) return;

          parsed.push({ begin: beginQs[0].object.value, value: parseFloat(valueQs[0].object.value) });
        });

        parsed.sort((a, b) => a.begin.localeCompare(b.begin));
        if (!cancelled) setReadings(parsed);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLabel]);

  const dailyTotal = readings.reduce((sum, r) => sum + r.value, 0);

  const chartData: ChartData<"line", number[], string> = {
    labels: readings.map((r) => r.begin.substring(11, 16)), // "HH:MM"
    datasets: [
      {
        label: "Electricity Consumption (kWh)",
        data: readings.map((r) => r.value),
        borderColor: "rgba(31, 120, 180, 1)",
        backgroundColor: "rgba(31, 120, 180, 0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    plugins: { legend: { display: false } },
    scales: {
      x: { title: { display: true, text: "Time of day" } },
      y: { title: { display: true, text: "kWh" }, beginAtZero: true },
    },
  };

  return (
    <Box>
      <FormControl size="small" sx={{ mb: 2, minWidth: 160 }}>
        <InputLabel>Date</InputLabel>
        <Select
          value={selectedLabel}
          label="Date"
          onChange={(e) => setSelectedLabel(e.target.value)}
        >
          {dateEntries.map((d) => (
            <MenuItem key={d.label} value={d.label}>
              {d.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {loading && (
        <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      )}
      {fetchError && (
        <Typography color="error" variant="body2" sx={{ mb: 1 }}>
          {fetchError}
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
              })}{" "}
              kWh
            </strong>{" "}
            ({readings.length} readings)
          </Typography>
          <Line data={chartData} options={options} />
        </>
      )}
    </Box>
  );
}