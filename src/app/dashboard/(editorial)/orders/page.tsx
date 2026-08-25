import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getOrdersList } from "@/app/actions/order-actions"
import { OrdersContent } from "./components/orders-content"

export default async function OrdersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [initial, stores] = await Promise.all([
    getOrdersList({ limit: 50 }),
    prisma.store.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  return <OrdersContent initial={initial} stores={stores} />
}
