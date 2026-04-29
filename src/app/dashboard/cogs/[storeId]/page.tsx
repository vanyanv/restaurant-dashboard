import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { CogsShell } from "./cogs-shell"
import { parseCogsFilters } from "../components/sections/data"

export default async function StoreCogsPage(props: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<{
    start?: string
    end?: string
    days?: string
    gran?: string
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const { storeId } = await props.params
  const sp = await props.searchParams

  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId: session.user.accountId },
    select: { id: true, name: true, targetCogsPct: true },
  })
  if (!store) notFound()

  const filters = parseCogsFilters(sp)

  return (
    <CogsShell
      storeId={store.id}
      storeName={store.name}
      targetCogsPct={store.targetCogsPct}
      filters={filters}
      activeDays={sp.days ? Math.max(1, Math.min(365, Number(sp.days))) : null}
    />
  )
}
