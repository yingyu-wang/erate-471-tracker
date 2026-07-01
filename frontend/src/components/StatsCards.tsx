/** Gradient stat cards shown at the top of the dashboard. */

import { Box, Card, CardContent, Typography } from "@mui/material";
import Grid from "@mui/material/Grid2";
import AssignmentIcon from "@mui/icons-material/Assignment";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import type { DashboardStats } from "../types";

const cards = [
  {
    key: "total",
    label: "Total Applications",
    icon: AssignmentIcon,
    gradient: "linear-gradient(135deg, #6C63FF, #9B95FF)",
    getValue: (s: DashboardStats) => s.total_applications,
    format: (v: number) => String(v),
  },
  {
    key: "requested",
    label: "Total Requested",
    icon: AttachMoneyIcon,
    gradient: "linear-gradient(135deg, #FF6B9D, #FFB347)",
    getValue: (s: DashboardStats) => s.total_requested,
    format: (v: number) =>
      v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
  },
  {
    key: "funded",
    label: "Total Funded",
    icon: CheckCircleIcon,
    gradient: "linear-gradient(135deg, #00C9A7, #4ECDC4)",
    getValue: (s: DashboardStats) => s.total_funded,
    format: (v: number) =>
      v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }),
  },
  {
    key: "review",
    label: "Under Review",
    icon: PendingActionsIcon,
    gradient: "linear-gradient(135deg, #FFA726, #FFCA28)",
    getValue: (s: DashboardStats) => s.by_status.under_review || 0,
    format: (v: number) => String(v),
  },
] as const;

interface Props {
  stats: DashboardStats;
}

export default function StatsCards({ stats }: Props) {
  return (
    <Grid container spacing={3}>
      {cards.map(({ key, label, icon: Icon, gradient, getValue, format }) => (
        <Grid key={key} size={{ xs: 12, sm: 6, md: 3 }}>
          <Card
            sx={{
              background: gradient,
              color: "white",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Decorative circle for visual depth */}
            <Box
              sx={{
                position: "absolute",
                right: -20,
                top: -20,
                width: 100,
                height: 100,
                borderRadius: "50%",
                bgcolor: "rgba(255,255,255,0.1)",
              }}
            />
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <Icon />
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  {label}
                </Typography>
              </Box>
              <Typography variant="h4" fontWeight={700}>
                {format(getValue(stats))}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}