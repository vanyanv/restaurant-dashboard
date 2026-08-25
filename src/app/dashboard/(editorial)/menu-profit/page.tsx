import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { MenuProfitShell } from "./menu-profit-shell"

/**
 * Menu Profit — the owner's per-item view of what sells, how much it sells,
 * and what it costs. Backed entirely by getMenuEngineering (Kasavana–Smith
 * quadrants over materialized DailyCogsItem rows) — the corrected classifier,
 * not the price-proxy scatter on /dashboard/product-mix.
 */
export default async function MenuProfitPage(props: {
  searchParams: Promise<{ storeId?: string; days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const sp = await props.searchParams
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30

  return <MenuProfitShell storeId={sp.storeId} days={days} />
}
