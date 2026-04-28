"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

interface RouteEntry {
  key: string
  label: string
  href: string
}

const ROUTES: RouteEntry[] = [
  { key: "overview", label: "Overview", href: "/dashboard/ai-analytics" },
  { key: "sales", label: "Sales", href: "/dashboard/ai-analytics/sales" },
  { key: "menu", label: "Menu", href: "/dashboard/ai-analytics/menu" },
  { key: "cogs", label: "COGS", href: "/dashboard/ai-analytics/cogs" },
  { key: "invoices", label: "Invoices", href: "/dashboard/ai-analytics/invoices" },
]

/**
 * Newspaper-style horizontal route bar — the four sub-routes plus Overview.
 * Active route uses the proofmark red. Selected store passes through via
 * `?store=<id>` so the user keeps their scope when changing routes.
 */
export function RouteNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const qs = searchParams.toString()

  return (
    <nav className="flex items-baseline gap-5 font-display text-[15px] italic">
      {ROUTES.map((r, i) => {
        const isActive =
          r.href === "/dashboard/ai-analytics"
            ? pathname === r.href
            : pathname.startsWith(r.href)
        const href = qs ? `${r.href}?${qs}` : r.href
        return (
          <span key={r.key} className="flex items-baseline gap-5">
            {i > 0 ? (
              <span aria-hidden className="font-mono text-[8px] text-(--ink-faint)">
                ·
              </span>
            ) : null}
            <Link
              href={href}
              className={
                isActive
                  ? "text-(--accent)"
                  : "text-(--ink-muted) hover:text-(--ink)"
              }
            >
              {r.label}
            </Link>
          </span>
        )
      })}
    </nav>
  )
}
