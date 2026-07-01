/** Portfolio overview with stats, status breakdown, and recent applications. */

import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  LinearProgress,
  Stack,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import { api } from "../api/client";
import StatsCards from "../components/StatsCards";
import StatusBadge from "../components/StatusBadge";
import type { ApplicationSummary, DashboardStats, PaginatedApplications } from "../types";
import { Link as RouterLink } from "react-router-dom";
import { statusColors } from "../theme";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<ApplicationSummary[]>([]);
  const [fundingYear, setFundingYear] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const year = fundingYear === "" ? undefined : fundingYear;
    Promise.all([api.getStats(year), api.listApplications({ funding_year: year, limit: 5, offset: 0 })])
      .then(([s, response]: [DashboardStats, PaginatedApplications]) => {
        setStats(s);
        setRecent(response.items); // most recently updated first (API sort order)
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fundingYear]);

  if (loading) return <LinearProgress />;
  if (error)
    return (
      <Typography color="error" sx={{ mt: 2 }}>
        {error} — is the API running on port 8000?
      </Typography>
    );
  if (!stats) return null;

  const statusEntries = Object.entries(stats.by_status).filter(([, count]) => count > 0);

  return (
    <Stack spacing={4}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Dashboard
          </Typography>
          <Typography color="text.secondary">
            Track FCC Form 471 application status across your E-Rate portfolio
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Funding Year</InputLabel>
          <Select
            label="Funding Year"
            value={fundingYear}
            onChange={(e) => setFundingYear(e.target.value as number | "")}
          >
            <MenuItem value="">All Years</MenuItem>
            {stats.funding_years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <StatsCards stats={stats} />

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Status Breakdown
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                {statusEntries.map(([status, count]) => {
                  const pct = stats.total_applications
                    ? (count / stats.total_applications) * 100
                    : 0;
                  const color = statusColors[status] || "#6C63FF";
                  return (
                    <Box key={status}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <StatusBadge status={status} />
                        <Typography variant="body2" fontWeight={600}>
                          {count} ({pct.toFixed(0)}%)
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          height: 8,
                          borderRadius: 4,
                          bgcolor: `${color}22`,
                          overflow: "hidden",
                        }}
                      >
                        <Box
                          sx={{
                            width: `${pct}%`,
                            height: "100%",
                            bgcolor: color,
                            borderRadius: 4,
                            transition: "width 0.5s ease",
                          }}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Applications
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {recent.map((app) => (
                  <Box
                    key={app.id}
                    component={RouterLink}
                    to={`/applications/${app.id}`}
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      p: 2,
                      borderRadius: 2,
                      textDecoration: "none",
                      color: "inherit",
                      bgcolor: "background.default",
                      "&:hover": { bgcolor: "rgba(108, 99, 255, 0.06)" },
                      transition: "background 0.2s",
                    }}
                  >
                    <Box>
                      <Typography fontWeight={600}>{app.organization_name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {app.application_number} · FY {app.funding_year} · BEN {app.ben}
                      </Typography>
                    </Box>
                    <StatusBadge status={app.status} />
                  </Box>
                ))}
                {recent.length === 0 && (
                  <Typography color="text.secondary">No applications yet.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}