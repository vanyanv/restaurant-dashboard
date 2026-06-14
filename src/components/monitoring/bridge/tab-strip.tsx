"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { monoLabel } from "../styles"

const TABS = [
  { href: "/dashboard/admin/monitoring",                label: "Bridge",   match: (p: string) => p === "/dashboard/admin/monitoring" },
  { href: "/dashboard/admin/monitoring/infrastructure", label: "Infra",    match: (p: string) => p.startsWith("/dashboard/admin/monitoring/infrastructure") },
  { href: "/dashboard/admin/monitoring/people",         label: "People",   match: (p: string) => p.startsWith("/dashboard/admin/monitoring/people") },
  { href: "/dashboard/admin/monitoring/costs",          label: "Costs",    match: (p: string) => p.startsWith("/dashboard/admin/monitoring/costs") },
  { href: "/dashboard/admin/monitoring/ml",             label: "ML",       match: (p: string) => p.startsWith("/dashboard/admin/monitoring/ml") },
  { href: "/dashboard/admin/monitoring/ingredient-audit", label: "Ingredients", match: (p: string) => p.startsWith("/dashboard/admin/monitoring/ingredient-audit") },
  { href: "/dashboard/admin/monitoring/activity",       label: "Activity", match: (p: string) => p.startsWith("/dashboard/admin/monitoring/activity") },
  { href: "/dashboard/admin/monitoring/cache",          label: "Cache",    match: (p: string) => p.startsWith("/dashboard/admin/monitoring/cache") },
] as const

export function TabStrip() {
  const pathname = usePathname() ?? ""
  return (
    <nav
      aria-label="Monitoring sections"
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--hairline)",
        marginBottom: 16,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            style={{
              ...monoLabel,
              letterSpacing: "0.22em",
              padding: "10px 14px",
              color: active ? "var(--ink)" : "var(--ink-muted)",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              textDecoration: "none",
              transform: "translateY(1px)",
            }}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
