import { MetricBarChart } from "webapp";

// Annual energy consumption — the bar chart on a building's energy page, two
// metrics (electricity + heat) over three years, in the app's chart colours.
export function AnnualConsumption() {
  const data = [
    { year: "2022", electricity: 98000, heat: 64000 },
    { year: "2023", electricity: 92000, heat: 61000 },
    { year: "2024", electricity: 90000, heat: 60000 },
  ];
  const bars = [
    { key: "electricity", name: "Electricity", color: "rgba(31, 120, 180, 0.8)" },
    { key: "heat", name: "Heat", color: "rgba(227, 26, 28, 0.8)" },
  ];
  return (
    <div style={{ width: 540, height: 280 }}>
      <MetricBarChart data={data} bars={bars} yUnit="kWh" />
    </div>
  );
}

// Single-series variant — water consumption only, legend hidden.
export function SingleSeries() {
  const data = [
    { year: "2022", water: 1450 },
    { year: "2023", water: 1380 },
    { year: "2024", water: 1320 },
  ];
  const bars = [{ key: "water", name: "Water", color: "rgba(51, 160, 44, 0.8)" }];
  return (
    <div style={{ width: 540, height: 280 }}>
      <MetricBarChart data={data} bars={bars} yUnit="m³" hideLegend />
    </div>
  );
}
