/** Form to register a new FCC Form 471 application with optional FRNs. */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  IconButton,
  Divider,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api/client";
import type { ApplicationStatus, FrnStatus } from "../types";

/** Local FRN row state — amounts kept as strings for controlled TextField inputs */
interface FrnDraft {
  frn_number: string;
  service_type: string;
  status: FrnStatus;
  requested_amount: string;
}

const emptyFrn = (): FrnDraft => ({
  frn_number: "",
  service_type: "",
  status: "pending",
  requested_amount: "",
});

export default function ApplicationForm() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    application_number: "",
    ben: "",
    organization_name: "",
    funding_year: new Date().getFullYear(),
    status: "draft" as ApplicationStatus,
    discount_rate: "",
    total_requested: "",
    contact_name: "",
    contact_email: "",
    notes: "",
    certified_date: "",
  });
  const [frns, setFrns] = useState<FrnDraft[]>([]);

  const update = (field: string, value: string | number) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await api.createApplication({
        application_number: form.application_number,
        ben: form.ben,
        organization_name: form.organization_name,
        funding_year: Number(form.funding_year),
        status: form.status,
        discount_rate: form.discount_rate ? Number(form.discount_rate) : null,
        total_requested: form.total_requested ? Number(form.total_requested) : null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        notes: form.notes || null,
        certified_date: form.certified_date || null,
        // Only send FRNs that have the minimum required fields filled in
        frns: frns
          .filter((f) => f.frn_number && f.service_type)
          .map((f) => ({
            frn_number: f.frn_number,
            service_type: f.service_type,
            status: f.status,
            requested_amount: f.requested_amount ? Number(f.requested_amount) : null,
          })),
      });
      navigate(`/applications/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} maxWidth={800}>
      <Typography variant="h4" gutterBottom>
        New Form 471 Application
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Register a new E-Rate FCC Form 471 filing for tracking
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Application Number"
                required
                fullWidth
                placeholder="471-2025-001234"
                value={form.application_number}
                onChange={(e) => update("application_number", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="BEN (Billed Entity Number)"
                required
                fullWidth
                value={form.ben}
                onChange={(e) => update("ben", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Organization Name"
                required
                fullWidth
                value={form.organization_name}
                onChange={(e) => update("organization_name", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Funding Year"
                type="number"
                required
                fullWidth
                value={form.funding_year}
                onChange={(e) => update("funding_year", Number(e.target.value))}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                >
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="certified">Certified</MenuItem>
                  <MenuItem value="under_review">Under Review</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Discount Rate (%)"
                type="number"
                fullWidth
                value={form.discount_rate}
                onChange={(e) => update("discount_rate", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Total Requested ($)"
                type="number"
                fullWidth
                value={form.total_requested}
                onChange={(e) => update("total_requested", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Certified Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={form.certified_date}
                onChange={(e) => update("certified_date", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <TextField
                label="Contact Name"
                fullWidth
                value={form.contact_name}
                onChange={(e) => update("contact_name", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                label="Contact Email"
                type="email"
                fullWidth
                value={form.contact_email}
                onChange={(e) => update("contact_email", e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Notes"
                fullWidth
                multiline
                rows={3}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <Typography variant="h6">FRNs (optional)</Typography>
            <Button startIcon={<AddIcon />} onClick={() => setFrns((f) => [...f, emptyFrn()])}>
              Add FRN
            </Button>
          </Box>
          <Stack spacing={2}>
            {frns.map((frn, i) => (
              <Box key={i}>
                <Grid container spacing={2} alignItems="center">
                  <Grid size={{ xs: 12, sm: 3 }}>
                    <TextField
                      label="FRN #"
                      fullWidth
                      size="small"
                      value={frn.frn_number}
                      onChange={(e) => {
                        const next = [...frns];
                        next[i] = { ...frn, frn_number: e.target.value };
                        setFrns(next);
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="Service Type"
                      fullWidth
                      size="small"
                      value={frn.service_type}
                      onChange={(e) => {
                        const next = [...frns];
                        next[i] = { ...frn, service_type: e.target.value };
                        setFrns(next);
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <TextField
                      label="Requested $"
                      type="number"
                      fullWidth
                      size="small"
                      value={frn.requested_amount}
                      onChange={(e) => {
                        const next = [...frns];
                        next[i] = { ...frn, requested_amount: e.target.value };
                        setFrns(next);
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 4, sm: 2 }}>
                    <IconButton color="error" onClick={() => setFrns((f) => f.filter((_, j) => j !== i))}>
                      <DeleteIcon />
                    </IconButton>
                  </Grid>
                </Grid>
                {i < frns.length - 1 && <Divider sx={{ mt: 2 }} />}
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
        <Button type="submit" variant="contained" size="large" disabled={saving}>
          {saving ? "Saving…" : "Create Application"}
        </Button>
        <Button onClick={() => navigate("/applications")}>Cancel</Button>
      </Stack>
    </Box>
  );
}