import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getOperationalAnalytics } from "@/app/actions/operational-actions"
import { OperationsContent } from "./components/operations-content"

export default async function OperationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [data, stores] = await Promise.all([
    getOperationalAnalytics(undefined, { days: 30 }),
    prisma.store.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ])

  return (
    <OperationsContent
      initialData={data}
      stores={stores}
      userRole={session.user.role}
    />
  )
}
