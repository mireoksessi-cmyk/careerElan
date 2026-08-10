"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminPermission } from "@/lib/admin/permissions";

/*
  Phase 6I.6.37 - cosmetic only. Hiding a link here does NOT gate
  access - every page independently calls guardAdminPage() server-side
  (see lib/admin/pageAuth.ts). This just avoids showing a staff member
  a tab they'd immediately be denied.
*/
const NAV_ITEMS: { href: string; label: string; permission: AdminPermission }[] = [
  { href: "/admin", label: "Overview", permission: "admin.overview.read" },
  { href: "/admin/users", label: "Users", permission: "admin.users.read" },
  { href: "/admin/product-usage", label: "Product Usage", permission: "admin.product_usage.read" },
  { href: "/admin/api-costs", label: "AI & API Costs", permission: "admin.api_costs.read" },
  { href: "/admin/system-health", label: "System Health", permission: "admin.system_health.read" },
  { href: "/admin/subscriptions", label: "Subscriptions", permission: "admin.subscriptions.read" },
  { href: "/admin/alerts", label: "Alerts", permission: "admin.alerts.read" },
  { href: "/admin/staff", label: "Staff & Permissions", permission: "admin.staff.read" },
  { href: "/admin/audit", label: "Audit Log", permission: "admin.audit.read" },
];

export default function AdminNav({ permissions }: { permissions: AdminPermission[] }) {
  const pathname = usePathname();
  const allowed = new Set(permissions);

  return (
    <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-slate-200 p-4">
      <div className="mb-4 px-2 text-sm font-semibold text-slate-500">Career Élan Admin</div>
      {NAV_ITEMS.filter((item) => allowed.has(item.permission)).map((item) => {
        const active = pathname === item.href || (item.href !== "/admin" && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm ${active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {item.label}
          </Link>
        );
      })}
      <Link href="/dashboard" className="mt-6 px-3 py-2 text-xs text-slate-400 hover:text-slate-600">
        &larr; Back to app
      </Link>
    </nav>
  );
}
