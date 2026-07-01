/**
 * Thin fetch wrapper for the FastAPI backend.
 * Uses relative /api paths — proxied to port 8000 by Vite in development.
 */

import type {
  Application,
  ApplicationCreatePayload,
  ApplicationSummary,
  DashboardStats,
  ApplicationStatus,
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
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.funding_year) q.set("funding_year", String(params.funding_year));
    if (params?.search) q.set("search", params.search);
    const qs = q.toString();
    return request<ApplicationSummary[]>(`/applications${qs ? `?${qs}` : ""}`);
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