// Design-sync bundle entry. Scoped re-exports so the converter bundles ONLY the
// brand provider plus the handful of presentational components that render
// standalone — the app's other components need Solid/I18n/Confirm/dev-mode
// contexts and can't render in the design tool. The theme tokens themselves ship
// via .design-sync/theme-tokens.css (cfg.cssEntry); this bundle carries the
// runtime MUI styling so designs built with these components look on-brand.
import { ThemeProvider } from "@mui/material/styles";
import type { ReactNode } from "react";
import theme from "../src/theme.ts";

/**
 * Wrap any Granergize design in this to apply the brand theme — the blue/green
 * palette, the deliberately narrow three-tier type scale, rem-based spacing, and
 * the component defaults (outlined Cards, flat Buttons). Required for the
 * components below, and for any MUI primitive, to render on-brand.
 */
export function GranergizeThemeProvider({ children }: { children?: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

export { default as TierDot } from "../src/components/TierDot.tsx";
export { default as Pager } from "../src/components/Pager.tsx";
export { default as MetricBarChart } from "../src/components/detail/MetricBarChart.tsx";
export { default as MetricLineChart } from "../src/components/detail/MetricLineChart.tsx";
