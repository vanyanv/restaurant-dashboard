import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getOrderDetail } from "@/app/actions/order-actions"
import { OrderDetailContent } from "./order-detail-content"

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params
  const order = await getOrderDetail(id)
  if (!order) notFound()

  return <OrderDetailContent order={order} />
}
