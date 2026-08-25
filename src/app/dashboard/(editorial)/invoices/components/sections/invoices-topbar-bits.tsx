import { InvoiceSyncButton } from "@/components/invoice-sync-button"
import { getLastSyncText } from "@/lib/dashboard-utils"
import { InvoicesStoreFilter } from "../invoices-topbar-store-filter"
import { fetchLastSync, fetchStoresForUser } from "./data"

export async function InvoicesLastSyncText() {
  const lastSyncAt = await fetchLastSync()
  return <span suppressHydrationWarning>{getLastSyncText(lastSyncAt)}</span>
}

export async function InvoicesTopbarSyncButton() {
  const lastSyncAt = await fetchLastSync()
  return (
    <InvoiceSyncButton lastSyncAt={lastSyncAt} size="sm" variant="outline" />
  )
}

export async function InvoicesTopbarStoreFilter({
  accountId,
  current,
}: {
  accountId: string
  current: string
}) {
  const stores = await fetchStoresForUser(accountId)
  return <InvoicesStoreFilter stores={stores} current={current} />
}
