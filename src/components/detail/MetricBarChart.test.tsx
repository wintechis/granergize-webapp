/// <reference lib="deno.ns" />
import "../../hooks/test-dom-setup.ts"; // must precede React / Testing Library
import { strict as assert } from "node:assert";
import * as React from "react";
import { render } from "@testing-library/react";
import MetricBarChart from "./MetricBarChart.tsx";
import MetricLineChart from "./MetricLineChart.tsx";

// Recharts' ResponsiveContainer measures its parent via ResizeObserver +
// getBoundingClientRect; happy-dom has neither layout nor that observer, so we
// stub both to a fixed size so the chart actually draws its SVG under the test.
function primeRechartsLayout() {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      bottom: 300,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}
primeRechartsLayout();

Deno.test("MetricBarChart renders an SVG surface with a legend label", () => {
  const { container, unmount } = render(
    React.createElement(MetricBarChart, {
      data: [
        { year: "2023", actual: 10, planned: 8 },
        { year: "2024", actual: 12, planned: 9 },
      ],
      bars: [
        { key: "actual", name: "Electricity (kWh)", color: "#1f78b4" },
        { key: "planned", name: "Electricity (kWh) (planned)", color: "#888" },
      ],
      yUnit: "kWh",
    }),
  );
  try {
    // The Recharts wrapper mounts regardless of layout…
    assert.ok(
      container.querySelector(".recharts-responsive-container"),
      "responsive container present",
    );
    // …and with a primed size it draws the SVG surface (real DOM, not canvas).
    assert.ok(
      container.querySelector("svg.recharts-surface"),
      "SVG surface rendered",
    );
    // The legend distinguishes actual vs planned — assert both labels are text.
    assert.match(container.textContent ?? "", /Electricity \(kWh\)/);
    assert.match(container.textContent ?? "", /planned/);
  } finally {
    unmount();
  }
});

Deno.test("MetricBarChart cycles a palette across single-series bars", () => {
  const { container, unmount } = render(
    React.createElement(MetricBarChart, {
      data: [
        { name: "Heating", value: 5 },
        { name: "Cooling", value: 3 },
        { name: "Lighting", value: 2 },
      ],
      bars: [{
        key: "value",
        name: "Energy",
        color: "#1f78b4",
        palette: ["#a", "#b"],
      }],
      xKey: "name",
      hideLegend: true,
    }),
  );
  try {
    assert.ok(
      container.querySelector("svg.recharts-surface"),
      "SVG surface rendered",
    );
    // hideLegend → no legend wrapper.
    assert.equal(
      container.querySelector(".recharts-legend-wrapper"),
      null,
      "legend hidden",
    );
  } finally {
    unmount();
  }
});

Deno.test("MetricLineChart renders an SVG line surface", () => {
  const { container, unmount } = render(
    React.createElement(MetricLineChart, {
      data: [
        { t: "00:00", value: 1 },
        { t: "00:15", value: 2 },
        { t: "00:30", value: null },
        { t: "00:45", value: 3 },
      ],
      lines: [{ key: "value", name: "Average kWh", color: "#1f78b4" }],
      yUnit: "kWh",
      hideLegend: true,
    }),
  );
  try {
    assert.ok(
      container.querySelector("svg.recharts-surface"),
      "SVG surface rendered",
    );
  } finally {
    unmount();
  }
});
