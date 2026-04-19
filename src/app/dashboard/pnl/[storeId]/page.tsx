import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PnLPageClient } from "@/components/pnl/pnl-page-client"

export default async function StorePnLPage(props: {
  params: Promise<{ storeId: string }>
}) {
  const { storeId } = await props.params
  const session = await getServerSession(authOptions)

  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [store, allStores] = await Promise.all([
    prisma.store.findFirst({
      where: { id: storeId, ownerId: session.user.id },
      select: { id: true, name: true },
    }),
    prisma.store.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  if (!store) notFound()

  return <PnLPageClient storeId={store.id} storeName={store.name} allStores={allStores} />
}
