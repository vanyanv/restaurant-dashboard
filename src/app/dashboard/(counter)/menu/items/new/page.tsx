import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMenuItemStartSectionPromises } from "@/lib/counter/adapters/menu-item-start"
import { CounterMenuItemStartClient } from "./counter-menu-item-start-client"

export const dynamic = "force-dynamic"

/** New menu item — start from something already selling, a copy of a dish, or blank. */
export default async function NewMenuItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const pos = typeof sp.pos === "string" ? sp.pos : null

  // NOT AWAITED: the lists stream in behind their own Suspense boundary.
  const sections = getMenuItemStartSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterMenuItemStartClient sections={sections} focusPos={pos} />
      <span hidden data-perf-ready="/dashboard/menu/items/new" />
    </>
  )
}
