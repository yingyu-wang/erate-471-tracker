/** Searchable, filterable table of all Form 471 applications. */

import { useEffect, useState } from "react";
import {
  Box,
  Card,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  LinearProgress,
  IconButton,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Link as RouterLink } from "react-router-dom";
import { api } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import type { ApplicationStatus, ApplicationSummary } from "../types";

const STATUS_OPTIONS: { value: ApplicationStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "certified", label: "Certified" },
  { value: "under_review", label: "Under Review" },
  { value: "fcdl_approved", label: "FCDL Approved" },
  { value: "fcdl_denied", label: "FCDL Denied" },
  { value: "cancelled", label: "Cancelled" },
  { value: "appealing", label: "Appealing" },
];

export default function ApplicationList() {
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "">("");
  const [fundingYear, setFundingYear] = useState<number | "">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Debounce search/filter changes to avoid hammering the API on every keystroke
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .listApplications({
          search: search || undefined,
          status: status || undefined,
          funding_year: fundingYear === "" ? undefined : fundingYear,
        })
        .then(setApps)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, status, fundingYear]);

  // Derive year filter options from current result set
  const years = [...new Set(apps.map((a) => a.funding_year))].sort((a, b) => b - a);

  const formatMoney = (v: number | null) =>
    v != null
      ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : "—";

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Applications
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Search and filter FCC Form 471 filings
      </Typography>

      <Box sx={{ display: "flex", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <TextField
          label="Search"
          placeholder="Organization, app #, or BEN"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ minWidth: 280 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | "")}>
            {STATUS_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Year</InputLabel>
          <Select
            label="Year"
            value={fundingYear}
            onChange={(e) => setFundingYear(e.target.value as number | "")}
          >
            <MenuItem value="">All</MenuItem>
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Organization</TableCell>
                <TableCell>App #</TableCell>
                <TableCell>BEN</TableCell>
                <TableCell>Year</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Requested</TableCell>
                <TableCell align="center">FRNs</TableCell>
                <TableCell align="center">View</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {apps.map((app) => (
                <TableRow key={app.id} hover>
                  <TableCell>
                    <Typography fontWeight={600}>{app.organization_name}</Typography>
                  </TableCell>
                  <TableCell>
                    {app.usac_file_url ? (
                      <Box
                        component="a"
                        href={app.usac_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                      >
                        {app.application_number}
                      </Box>
                    ) : (
                      app.application_number
                    )}
                  </TableCell>
                  <TableCell>{app.ben}</TableCell>
                  <TableCell>{app.funding_year}</TableCell>
                  <TableCell>
                    <StatusBadge status={app.status} />
                  </TableCell>
                  <TableCell align="right">{formatMoney(app.total_requested)}</TableCell>
                  <TableCell align="center">{app.frn_count}</TableCell>
                  <TableCell align="center">
                    <IconButton
                      component={RouterLink}
                      to={`/applications/${app.id}`}
                      color="primary"
                      size="small"
                    >
                      <VisibilityIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && apps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">No applications match your filters.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}