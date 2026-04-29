import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PnLAllStoresClient } from "@/components/pnl/pnl-all-stores-client"
import { defaultPnLRangeState } from "@/components/pnl/pnl-date-presets"
import { getAllStoresPnL } from "@/app/actions/store-actions"

export default async function AllStoresPnLPage() {
  const session = await getServerSession(authOptions)

  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const initialState = defaultPnLRangeState()
  const queryClient = new QueryClient()

  await queryClient.prefetchQuery({
    queryKey: [
      "pnl-all",
      initialState.startDate.toISOString(),
      initialState.endDate.toISOString(),
      initialState.granularity,
    ],
    queryFn: async () => {
      const result = await getAllStoresPnL({
        startDate: initialState.startDate,
        endDate: initialState.endDate,
        granularity: initialState.granularity,
      })
      if ("error" in result) throw new Error(result.error)
      return result
    },
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PnLAllStoresClient stores={stores} initialState={initialState} />
    </HydrationBoundary>
  )
}
