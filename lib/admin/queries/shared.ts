/*
  Phase 6I.6.37 - shared helpers for every admin query module. Every
  exported metric elsewhere in lib/admin/queries carries a
  `DataClassification` alongside its value (Part AO's own requirement:
  "every visible metric must document internally: source,
  classification... do not silently mix estimates and exact values").
*/
import { supabaseAdmin } from "../../supabaseAdmin";

export type DataClassification =
  | "EXACT_PROVIDER_DATA"
  | "EXACT_INTERNAL_DATA"
  | "DERIVED_ESTIMATE"
  | "MANUAL_PROVIDER_DASHBOARD_ONLY"
  | "NOT_AVAILABLE";

export type ClassifiedMetric<T> = {
  value: T;
  classification: DataClassification;
  note?: string;
};

export function metric<T>(
  value: T,
  classification: DataClassification,
  note?: string
): ClassifiedMetric<T> {
  return { value, classification, note };
}

export function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function startOfUtcMonth(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function daysAgo(days: number, from = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

export function minutesAgo(minutes: number, from = new Date()): Date {
  return new Date(from.getTime() - minutes * 60 * 1000);
}

/*
  Lists every auth.users row via the Admin API (there is no PostgREST-
  exposed `auth.users` table to query directly - see this phase's own
  audit). Paginates in batches of 1000, capped at 50 pages (50,000
  users) as a sane runaway guard for an admin-console read, not a
  product-facing limit - Career Élan is early-stage (Part AB), and this
  is re-evaluated if the user base ever approaches that scale.
*/
export type AuthUserSummary = {
  id: string;
  email: string | null;
  createdAt: string;
  provider: string;
  lastSignInAt: string | null;
};

const MAX_AUTH_USER_PAGES = 50;
const AUTH_USER_PAGE_SIZE = 1000;

export async function listAllAuthUsers(): Promise<AuthUserSummary[]> {
  const results: AuthUserSummary[] = [];

  for (let page = 1; page <= MAX_AUTH_USER_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: AUTH_USER_PAGE_SIZE });
    if (error || !data) break;

    for (const user of data.users) {
      const provider =
        typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";
      results.push({
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at,
        provider,
        lastSignInAt: user.last_sign_in_at ?? null,
      });
    }

    if (data.users.length < AUTH_USER_PAGE_SIZE) break;
  }

  return results;
}
