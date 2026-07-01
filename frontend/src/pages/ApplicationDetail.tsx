/** Single application view with FRNs, status updates, and audit history. */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import type { Application, ApplicationStatus } from "../types";

const STATUS_OPTIONS: ApplicationStatus[] = [
  "draft",
  "certified",
  "under_review",
  "fcdl_approved",
  "fcdl_denied",
  "cancelled",
  "appealing",
];

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusNote, setStatusNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    api
      .getApplication(Number(id))
      .then(setApp)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  /** PATCH status — backend records the transition in status_history */
  const handleStatusChange = async (newStatus: ApplicationStatus) => {
    if (!app) return;
    setSaving(true);
    try {
      const updated = await api.updateApplication(app.id, {
        status: newStatus,
        status_note: statusNote || undefined,
      });
      setApp(updated);
      setStatusNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!app || !confirm("Delete this application?")) return;
    await api.deleteApplication(app.id);
    navigate("/applications");
  };

  const formatMoney = (v: number | null) =>
    v != null
      ? v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
      : "—";

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—";

  if (loading) return <LinearProgress />;
  if (error && !app) return <Alert severity="error">{error}</Alert>;
  if (!app) return null;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/applications")} sx={{ mb: 1 }}>
            Back
          </Button>
          <Typography variant="h4">{app.organization_name}</Typography>
          <Typography color="text.secondary">
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
            {" · Funding Year "}{app.funding_year}
            {app.usac_file_url && " · PDF"}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <StatusBadge status={app.status} size="medium" />
          <Button color="error" startIcon={<DeleteIcon />} onClick={handleDelete}>
            Delete
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Application Details
              </Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                {[
                  ["BEN", app.ben],
                  ["Discount Rate", app.discount_rate != null ? `${app.discount_rate}%` : "—"],
                  ["Total Requested", formatMoney(app.total_requested)],
                  ["Certified Date", formatDate(app.certified_date)],
                  ["Contact", app.contact_name || "—"],
                  ["Email", app.contact_email || "—"],
                ].map(([label, value]) => (
                  <Grid key={label as string} size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography fontWeight={600}>{value}</Typography>
                  </Grid>
                ))}
              </Grid>
              {app.notes && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    Notes
                  </Typography>
                  <Typography>{app.notes}</Typography>
                </Box>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Funding Request Numbers (FRNs)
              </Typography>
              {app.frns.length === 0 ? (
                <Typography color="text.secondary">No FRNs attached.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>FRN #</TableCell>
                      <TableCell>Service Type</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Requested</TableCell>
                      <TableCell align="right">Approved</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {app.frns.map((frn) => (
                      <TableRow key={frn.id}>
                        <TableCell>{frn.frn_number}</TableCell>
                        <TableCell>{frn.service_type}</TableCell>
                        <TableCell>
                          <StatusBadge status={frn.status} />
                        </TableCell>
                        <TableCell align="right">{formatMoney(frn.requested_amount)}</TableCell>
                        <TableCell align="right">{formatMoney(frn.approved_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Update Status
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>New Status</InputLabel>
                  <Select
                    label="New Status"
                    value={app.status}
                    onChange={(e) => handleStatusChange(e.target.value as ApplicationStatus)}
                    disabled={saving}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <MenuItem key={s} value={s}>
                        <StatusBadge status={s} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Status note (optional)"
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  size="small"
                  multiline
                  rows={2}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Status History
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                {app.status_history.map((entry, i) => (
                  <Box key={entry.id}>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                      {entry.from_status && <StatusBadge status={entry.from_status} />}
                      {entry.from_status && <Typography variant="body2">→</Typography>}
                      <StatusBadge status={entry.to_status} />
                      <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                        {new Date(entry.changed_at).toLocaleString()}
                      </Typography>
                    </Box>
                    {entry.note && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {entry.note}
                      </Typography>
                    )}
                    {i < app.status_history.length - 1 && <Divider sx={{ mt: 2 }} />}
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}