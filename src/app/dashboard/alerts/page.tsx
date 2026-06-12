import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { listAlerts } from "@/app/actions/alerts"
import { EditorialTopbar } from "../components/editorial-topbar"
import { ForecastsStorePicker } from "../forecasts/components/forecasts-store-picker"
import { AlertsInbox } from "./components/alerts-inbox"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

export default async function AlertsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const { storeId } = await searchParams
  const stores = await getStores()
  const result = await listAlerts({ storeId, limit: 100 })
  if (!result) redirect("/login")
  if (!result.ok) {
    return (
      <div className="px-5 py-6 text-[var(--ink-muted)]">
        Store not in account.
      </div>
    )
  }

  return (
    <>
      <EditorialTopbar section="Operations" title="Alerts">
        <div className="ml-auto">
          <ForecastsStorePicker stores={stores} selectedStoreId={storeId} />
        </div>
      </EditorialTopbar>

      <div className="px-5 py-4">
        <AlertsInbox data={result.data} />
      </div>
    </>
  )
}
