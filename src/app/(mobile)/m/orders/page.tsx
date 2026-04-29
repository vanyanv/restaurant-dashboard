import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOrdersList } from "@/app/actions/order-actions"
import { getStores } from "@/app/actions/store-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { MToolbar } from "@/components/mobile/m-toolbar"
import {
  parsePeriod,
  periodToDateRange,
  MOBILE_PERIODS,
} from "@/lib/mobile/period"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtTime = (d: Date | string) => {
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

const PLATFORM_LABEL: Record<string, string> = {
  doordash: "DOORDASH",
  ubereats: "UBEREATS",
  grubhub: "GRUBHUB",
  chownow: "CHOWNOW",
  "css-pos": "IN-HOUSE",
  "bnm-web": "ONLINE",
}

export default async function MobileOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const period = parsePeriod(sp.period)
  const storeId = sp.store && sp.store !== "" ? sp.store : null

  const stores = await getStores()
  const validStoreId = storeId && stores.some((s) => s.id === storeId)
    ? storeId
    : null

  const range = periodToDateRange(period)
  const startStr = range.startDate.toISOString().slice(0, 10)
  const endStr = range.endDate.toISOString().slice(0, 10)

  const list = await getOrdersList({
    storeId: validStoreId ?? undefined,
    platform: sp.platform,
    startDate: startStr,
    endDate: endStr,
    limit: 50,
  })

  const periodLabel =
    MOBILE_PERIODS.find((p) => p.value === period)?.label ?? "Today"

  return (
    <>
      <MToolbar
        pathname="/m/orders"
        searchParams={sp}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={validStoreId}
        period={period}
      />

      <PageHead
        dept="LEDGER"
        title="Orders"
        sub={`${list.totalCount.toLocaleString()} ${periodLabel.toLowerCase()}`}
      />

      <div className="dock-in dock-in-2">
        <Panel
          dept={`${list.rows.length} OF ${list.totalCount.toLocaleString()}`}
          title="Live ledger"
          flush
        >
          {list.rows.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No orders match.</strong> Try a wider period or a
              different store.
            </div>
          ) : (
            list.rows.map((o) => (
              <Link
                key={o.id}
                href={`/m/orders/${o.id}`}
                className="order-row"
                style={{
                  gridTemplateColumns: "[meta] 1fr [total] auto",
                  gap: 12,
                  padding: "14px 18px",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="m-cap">
                    {fmtTime(o.referenceTimeLocal)} ·{" "}
                    {PLATFORM_LABEL[o.platform] ?? o.platform.toUpperCase()}
                  </span>
                  <span className="inv-row__vendor-name">
                    {o.externalDisplayId ?? "—"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                    {o.storeName} · {o.itemCount} items
                  </span>
                </span>
                <span className="total-num inv-row__total">
                  {fmtMoney(o.total)}
                </span>
              </Link>
            ))
          )}
        </Panel>
      </div>
    </>
  )
}
