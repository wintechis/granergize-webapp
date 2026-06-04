import { createTheme } from "@mui/material/styles";

// A custom theme for this app
const theme = createTheme({
  cssVariables: true,
  // rem-based spacing so padding/gaps/margins scale with the (fluid) root font
  // alongside the rem type scale below. 0.5rem * factor === 8px * factor at the
  // default 16px root, so this is visually identical at baseline — it just
  // scales now. Driven by the `html { font-size: clamp(...) }` rule in index.css.
  spacing: (factor: number) => `${factor * 0.5}rem`,
  palette: {
    primary: {
      main: "#0277bd", // Clean professional blue — evokes energy infrastructure
    },
    secondary: {
      main: "#388e3c", // Medium green — sustainability / renewables
    },
    error: {
      main: "#c62828", // Deep red
    },
    warning: {
      main: "#e65100", // Deep orange
    },
    success: {
      main: "#2e7d32", // Dark green — used for "below average" energy indicators
    },
    background: {
      default: "#f5f7fa", // Subtle cool-grey so white Paper cards visually pop
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: [
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "Roboto",
      '"Helvetica Neue"',
      "Arial",
      "sans-serif",
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(","),
    fontWeightMedium: 500,
    // Deliberately narrow type scale: MUI's defaults span a dozen widely-spaced
    // styles, which read as visually "busy". Collapse everything into three calm
    // tiers — heading / body / muted — with small steps and consistent weights,
    // so the many existing variant="…" call-sites stop clashing.
    //
    //   heading tier (all 600):  h3 1.5 · h4 1.35 · h5 1.2 · h6 1.05 · subtitleN 0.95
    //   body tier:               body1 0.95
    //   muted tier:              body2 0.875 · caption 0.8
    h3: { fontSize: "1.5rem", fontWeight: 600, lineHeight: 1.3 },
    h4: { fontSize: "1.35rem", fontWeight: 600, lineHeight: 1.3 },
    h5: { fontSize: "1.2rem", fontWeight: 600, lineHeight: 1.35 },
    h6: { fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: "0.95rem", fontWeight: 600, lineHeight: 1.4 },
    subtitle2: { fontSize: "0.95rem", fontWeight: 600, lineHeight: 1.4 },
    body1: { fontSize: "0.95rem", lineHeight: 1.5 },
    body2: { fontSize: "0.875rem", lineHeight: 1.45 },
    caption: { fontSize: "0.8rem", lineHeight: 1.4 },
  },
  components: {
    MuiCard: {
      defaultProps: {
        variant: "outlined",
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
    },
  },
});

export default theme;
