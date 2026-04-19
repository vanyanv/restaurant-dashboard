import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PnLAllStoresClient } from "@/components/pnl/pnl-all-stores-client"

export default async function AllStoresPnLPage() {
  const session = await getServerSession(authOptions)

  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const stores = await prisma.store.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return <PnLAllStoresClient stores={stores} />
}
