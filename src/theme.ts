import { createTheme } from "@mui/material/styles";

// A custom theme for this app
const theme = createTheme({
  cssVariables: true,
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
