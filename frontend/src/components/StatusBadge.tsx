/** Colored chip displaying a human-readable application or FRN status. */

import { Chip } from "@mui/material";
import { statusColors } from "../theme";

const labels: Record<string, string> = {
  draft: "Draft",
  certified: "Certified",
  under_review: "Under Review",
  fcdl_approved: "FCDL Approved",
  fcdl_denied: "FCDL Denied",
  cancelled: "Cancelled",
  appealing: "Appealing",
  pending: "Pending",
  funded: "Funded",
  denied: "Denied",
  partial: "Partial",
};

interface Props {
  status: string;
  size?: "small" | "medium";
}

export default function StatusBadge({ status, size = "small" }: Props) {
  const color = statusColors[status] || "#9E9E9E";
  return (
    <Chip
      label={labels[status] || status}
      size={size}
      sx={{
        bgcolor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    />
  );
}