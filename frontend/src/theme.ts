/**
 * MUI theme and status color palette.
 * statusColors is shared by StatusBadge and dashboard progress bars.
 */

import { createTheme, alpha } from "@mui/material/styles";

/** Hex colors keyed by application/FRN status slug from the API */
export const statusColors: Record<string, string> = {
  draft: "#9E9E9E",
  certified: "#42A5F5",
  under_review: "#FFA726",
  fcdl_approved: "#66BB6A",
  fcdl_denied: "#EF5350",
  cancelled: "#78909C",
  appealing: "#AB47BC",
  pending: "#FFA726",
  funded: "#66BB6A",
  denied: "#EF5350",
  partial: "#FFCA28",
};

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#6C63FF", light: "#9B95FF", dark: "#4A42CC" },
    secondary: { main: "#FF6B9D", light: "#FF9BBD", dark: "#CC3D73" },
    success: { main: "#00C9A7" },
    warning: { main: "#FFB347" },
    error: { main: "#FF5C5C" },
    info: { main: "#4ECDC4" },
    background: {
      default: "#F4F6FC",
      paper: "#FFFFFF",
    },
  },
  typography: {
    fontFamily: '"Outfit", "Segoe UI", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 10,
        },
        contained: {
          boxShadow: "0 4px 14px rgba(108, 99, 255, 0.35)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: "0 4px 24px rgba(108, 99, 255, 0.08)",
          border: "1px solid rgba(108, 99, 255, 0.06)",
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "linear-gradient(135deg, #6C63FF 0%, #FF6B9D 55%, #FFB347 100%)",
          boxShadow: "0 4px 20px rgba(108, 99, 255, 0.3)",
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: alpha("#6C63FF", 0.04),
          },
        },
      },
    },
  },
});