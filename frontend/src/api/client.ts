/**
 * Thin fetch wrapper for the FastAPI backend.
 * Uses relative /api paths — proxied to port 8000 by Vite in development.
 */

import type {
  Application,
  ApplicationCreatePayload,
  DashboardStats,
  ApplicationStatus,
  ApplicationSummary,
  PaginatedApplications,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  // DELETE endpoints return 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getStats: (fundingYear?: number) =>
    request<DashboardStats>(
      `/applications/stats${fundingYear ? `?funding_year=${fundingYear}` : ""}`
    ),

  listApplications: (params?: {
    status?: ApplicationStatus;
    funding_year?: number;
    search?: string;
    limit?: number;
    offset?: number;
    live_status_check?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.funding_year) q.set("funding_year", String(params.funding_year));
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.live_status_check) q.set("live_status_check", "true");
    const qs = q.toString();
    return request<PaginatedApplications | ApplicationSummary[]>(`/applications${qs ? `?${qs}` : ""}`).then(
      (data) => {
        // Backward compatibility: older API images return a plain array.
        if (Array.isArray(data)) {
          const limit = params?.limit ?? data.length;
          const offset = params?.offset ?? 0;
          return {
            items: data,
            total: data.length,
            limit,
            offset,
          };
        }
        return data;
      }
    );
  },

  getApplication: (id: number) => request<Application>(`/applications/${id}`),

  createApplication: (data: ApplicationCreatePayload) =>
    request<Application>("/applications", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateApplication: (id: number, data: Partial<ApplicationCreatePayload> & { status_note?: string }) =>
    request<Application>(`/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteApplication: (id: number) =>
    request<void>(`/applications/${id}`, { method: "DELETE" }),
};