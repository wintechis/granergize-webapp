import { MetricLineChart } from "webapp";

// A 15-minute electricity load profile over a day — the time-series chart on a
// building's energy page, in the brand blue.
export function DailyLoad() {
  const data = [
    { t: "00:00", load: 14 },
    { t: "04:00", load: 11 },
    { t: "08:00", load: 47 },
    { t: "12:00", load: 64 },
    { t: "16:00", load: 58 },
    { t: "20:00", load: 33 },
    { t: "23:45", load: 18 },
  ];
  const lines = [{ key: "load", name: "Electricity load", color: "#0277bd" }];
  return (
    <div style={{ width: 540, height: 280 }}>
      <MetricLineChart data={data} lines={lines} yUnit="kW" />
    </div>
  );
}

// Two-series comparison — actual vs planned (Soll-Ist), the planned line in grey.
export function ActualVsPlanned() {
  const data = [
    { t: "2021", actual: 102, planned: 100 },
    { t: "2022", actual: 98, planned: 95 },
    { t: "2023", actual: 92, planned: 90 },
    { t: "2024", actual: 90, planned: 84 },
  ];
  const lines = [
    { key: "actual", name: "Actual", color: "#0277bd" },
    { key: "planned", name: "Planned", color: "rgba(120, 120, 120, 0.75)" },
  ];
  return (
    <div style={{ width: 540, height: 280 }}>
      <MetricLineChart data={data} lines={lines} yUnit="MWh" xKey="t" />
    </div>
  );
}
