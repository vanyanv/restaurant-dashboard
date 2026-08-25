"use client"

import { RouteError } from "@/components/dashboard/route-error"

/**
 * Catch-all boundary for the dashboard. Segments with their own `error.tsx`
 * (analytics, cogs, invoices, operations, pnl, recipes, ingredients/prices)
 * still win; everything else — Decisions, Labor, Menu Profit, Product Mix,
 * Ingredients, Menu Catalog, Orders, Stores, Chat, Settings, Monitoring —
 * previously fell through to Next's unstyled default screen.
 */
export default function Error(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <RouteError {...props} title="This page could not load" />
}
