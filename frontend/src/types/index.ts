/**
 * TypeScript types mirroring the FastAPI Pydantic schemas.
 * Keep in sync with backend/app/schemas.py and models.py enums.
 */

/** Form 471 application lifecycle status (matches ApplicationStatus enum) */
export type ApplicationStatus =
  | "draft"
  | "certified"
  | "under_review"
  | "fcdl_approved"
  | "fcdl_denied"
  | "cancelled"
  | "appealing";

/** FRN decision status (matches FrnStatus enum) */
export type FrnStatus = "pending" | "funded" | "denied" | "cancelled" | "partial";

export interface Frn {
  id: number;
  application_id: number;
  frn_number: string;
  service_type: string;
  status: FrnStatus;
  requested_amount: number | null;
  approved_amount: number | null;
}

export interface StatusHistoryEntry {
  id: number;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  note: string | null;
  changed_at: string;
}

/** Full application detail returned by GET /api/applications/:id */
export interface Application {
  id: number;
  application_number: string;
  ben: string;
  organization_name: string;
  funding_year: number;
  status: ApplicationStatus;
  discount_rate: number | null;
  total_requested: number | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  certified_date: string | null;
  usac_file_url: string | null;
  entity_type: string | null;
  created_at: string;
  updated_at: string;
  frns: Frn[];
  status_history: StatusHistoryEntry[];
}

/** Lightweight row for list and dashboard views */
export interface ApplicationSummary {
  id: number;
  application_number: string;
  ben: string;
  organization_name: string;
  funding_year: number;
  status: ApplicationStatus;
  discount_rate: number | null;
  total_requested: number | null;
  certified_date: string | null;
  usac_file_url: string | null;
  updated_at: string;
  frn_count: number;
}

/** Dashboard aggregates from GET /api/applications/stats */
export interface DashboardStats {
  total_applications: number;
  by_status: Record<string, number>;
  total_requested: number;
  total_funded: number;
  funding_years: number[];
}

/** Paginated response from GET /api/applications */
export interface PaginatedApplications {
  items: ApplicationSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** Request body for POST /api/applications */
export interface ApplicationCreatePayload {
  application_number: string;
  ben: string;
  organization_name: string;
  funding_year: number;
  status?: ApplicationStatus;
  discount_rate?: number | null;
  total_requested?: number | null;
  contact_name?: string | null;
  contact_email?: string | null;
  notes?: string | null;
  certified_date?: string | null;
  frns?: {
    frn_number: string;
    service_type: string;
    status?: FrnStatus;
    requested_amount?: number | null;
    approved_amount?: number | null;
  }[];
}