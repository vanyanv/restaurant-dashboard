"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { monoLabel } from "../styles"

const TABS = [
  { href: "/dashboard/monitoring",                label: "Bridge",   match: (p: string) => p === "/dashboard/monitoring" },
  { href: "/dashboard/monitoring/infrastructure", label: "Infra",    match: (p: string) => p.startsWith("/dashboard/monitoring/infrastructure") },
  { href: "/dashboard/monitoring/people",         label: "People",   match: (p: string) => p.startsWith("/dashboard/monitoring/people") },
  { href: "/dashboard/monitoring/costs",          label: "Costs",    match: (p: string) => p.startsWith("/dashboard/monitoring/costs") },
  { href: "/dashboard/monitoring/ml",             label: "ML",       match: (p: string) => p.startsWith("/dashboard/monitoring/ml") },
  { href: "/dashboard/monitoring/ingredient-audit", label: "Ingredients", match: (p: string) => p.startsWith("/dashboard/monitoring/ingredient-audit") },
  { href: "/dashboard/monitoring/activity",       label: "Activity", match: (p: string) => p.startsWith("/dashboard/monitoring/activity") },
  { href: "/dashboard/monitoring/cache",          label: "Cache",    match: (p: string) => p.startsWith("/dashboard/monitoring/cache") },
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
