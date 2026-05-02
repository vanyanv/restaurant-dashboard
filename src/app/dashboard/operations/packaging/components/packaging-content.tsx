"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import type { ReactNode } from "react"
import { Calculator, PackageCheck, ReceiptText, ShieldCheck } from "lucide-react"
import { getPackagingCostReport } from "@/app/actions/packaging-actions"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import { CONTAINER_GROUP_LABELS, type ContainerCounts } from "@/lib/container-packaging"
import type {
  PackagingContainerRow,
  PackagingCostData,
  PackagingInvoiceValidationRow,
  PackagingOrderExample,
} from "@/types/packaging"

type PackagingContentProps = {
  initialData: PackagingCostData | null
  stores: { id: string; name: string }[]
}

const NUMBER = new Intl.NumberFormat("en-US")
const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function money(value: number): string {
  return MONEY.format(value)
}

function moneyCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? "-" : ""
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function number(value: number): string {
  return NUMBER.format(Math.round(value))
}

function pct(value: number | null): string {
  if (value == null) return "n/a"
  return `${value.toFixed(1)}%`
}

function unitMoney(value: number | null): string {
  if (value == null) return "n/a"
  return value < 1 ? `$${value.toFixed(3)}` : money(value)
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function containerText(counts: ContainerCounts): string {
  const parts = (Object.keys(CONTAINER_GROUP_LABELS) as Array<keyof ContainerCounts>)
    .filter((group) => counts[group] > 0)
    .map((group) => `${NUMBER.format(counts[group])} ${CONTAINER_GROUP_LABELS[group]}`)
  return parts.length > 0 ? parts.join(", ") : "none"
}

export function PackagingContent({ initialData, stores }: PackagingContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()
  const [days, setDays] = useState(30)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")

  useEffect(() => {
    setData(initialData)
  }, [initialData])

  const dateOptions = useCallback((): { startDate: string; endDate: string } | { days: number } => {
    if (customRange) return customRange
    return { days }
  }, [customRange, days])

  const fetchData = useCallback(
    (storeId: string, options: { startDate: string; endDate: string } | { days: number }) => {
      startTransition(async () => {
        const sid = storeId === "all" ? undefined : storeId
        const fresh = await getPackagingCostReport({ ...options, storeId: sid })
        setData(fresh)
      })
    },
    []
  )

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const matchedPreset = [1, -1, 3, 7, 14, 30, 90].find((p) => p === presetDays)
      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      fetchData(selectedStore, { startDate, endDate })
    },
    [fetchData, selectedStore]
  )

  const handleStoreChange = useCallback(
    (storeId: string) => {
      setSelectedStore(storeId)
      fetchData(storeId, dateOptions())
    },
    [dateOptions, fetchData]
  )

  const hasPackagingRows = useMemo(
    () => Boolean(data && data.containers.some((row) => row.units > 0 || row.lineCost > 0)),
    [data]
  )

  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar
        section="§ 04"
        title="Packaging Costs"
        stamps={
          data?.dateRange ? (
            <span>{formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}</span>
          ) : undefined
        }
      >
        <DateRangePicker
          days={days}
          customRange={customRange}
          onRangeChange={handleRangeChange}
          isPending={isPending}
        />
        {stores.length > 1 ? (
          <Select value={selectedStore} onValueChange={handleStoreChange}>
            <SelectTrigger className="h-8 w-[150px] text-sm">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </EditorialTopbar>

      <div
        className={`flex-1 overflow-auto px-4 pb-10 pt-4 sm:px-6 sm:pt-6 ${
          isPending ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {!data ? (
          <EmptyPanel title="Packaging data could not load." />
        ) : (
          <div className="space-y-6">
            <KpiStrip data={data} />

            {!hasPackagingRows ? (
              <EmptyPanel title="No packaging rows in this period." />
            ) : null}

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <ContainerLedger rows={data.containers} />
              <FulfillmentPanel data={data} />
            </div>

            <OrderExamples examples={data.examples} />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <InvoiceValidation rows={data.validation} />
              <MethodPanel scenario={data.scenario} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiStrip({ data }: { data: PackagingCostData }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCell
        icon={<PackageCheck className="h-4 w-4" />}
        label="Packaging COGS"
        value={moneyCompact(data.totals.packagingCogs)}
        sub={`${pct(data.totals.packagingShareOfCogs)} of total COGS`}
      />
      <KpiCell
        icon={<ReceiptText className="h-4 w-4" />}
        label="Containers"
        value={number(data.totals.packagingUnits)}
        sub={`${number(data.totals.eligibleOrders)} pickup/delivery orders`}
      />
      <KpiCell
        icon={<Calculator className="h-4 w-4" />}
        label="Cost / eligible order"
        value={data.totals.costPerEligibleOrder == null ? "n/a" : money(data.totals.costPerEligibleOrder)}
        sub={`${data.storeLabel} · ${data.scenario}`}
      />
      <KpiCell
        icon={<ShieldCheck className="h-4 w-4" />}
        label="In-store excluded"
        value={number(data.totals.excludedOrders)}
        sub={`${money(data.totals.avoidedDineInCost)} avoided estimate`}
      />
    </div>
  )
}

function KpiCell({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode
  label: string
  value: string
  sub: string
}) {
  return (
    <section className="border border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-3">
      <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        <span>{label}</span>
        <span className="text-[var(--ink-faint)]">{icon}</span>
      </div>
      <div className="mt-3 font-display text-[28px] leading-none text-[var(--ink)] [font-variant-numeric:tabular-nums_lining-nums]">
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[var(--ink-muted)]">{sub}</div>
    </section>
  )
}

function ContainerLedger({ rows }: { rows: PackagingContainerRow[] }) {
  return (
    <section className="inv-panel inv-panel--flush">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">Container ledger</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          Posted COGS rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--hairline-bold)] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <th className="px-4 py-3 text-left font-normal">Container</th>
              <th className="px-4 py-3 text-right font-normal">Units</th>
              <th className="px-4 py-3 text-right font-normal">Unit cost</th>
              <th className="px-4 py-3 text-right font-normal">Total</th>
              <th className="px-4 py-3 text-right font-normal">Packaging share</th>
              <th className="px-4 py-3 text-right font-normal">COGS share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.group} className="border-b border-[var(--hairline)] last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--ink)]">{row.label}</div>
                  {row.partialCost ? (
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent-dark)]">
                      partial cost
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{number(row.units)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{unitMoney(row.unitCost)}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{money(row.lineCost)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(row.shareOfPackaging)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(row.shareOfTotalCogs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function FulfillmentPanel({ data }: { data: PackagingCostData }) {
  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">Fulfillment scope</span>
      </div>
      <div className="space-y-3 px-4 pb-4">
        {data.fulfillment.length === 0 ? (
          <p className="text-[13px] text-[var(--ink-muted)]">No orders in this period.</p>
        ) : (
          data.fulfillment.map((row) => (
            <div
              key={row.bucket}
              className="flex items-baseline justify-between gap-4 border-b border-dashed border-[var(--hairline)] pb-2 last:border-0"
            >
              <div>
                <div className="text-[14px] text-[var(--ink)]">{row.label}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                  {row.bucket === "DELIVERY" || row.bucket === "PICKUP" ? "container demand" : "not charged"}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[15px] tabular-nums text-[var(--ink)]">
                  {number(row.orders)}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                  {pct(row.shareOfOrders)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function OrderExamples({ examples }: { examples: PackagingOrderExample[] }) {
  return (
    <section className="inv-panel inv-panel--flush">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">Recent packaging examples</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          Same basket rules as COGS
        </span>
      </div>
      {examples.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-[var(--ink-muted)]">
          No recent orders in this period.
        </div>
      ) : (
        <div className="divide-y divide-[var(--hairline)]">
          {examples.map((example) => (
            <article key={example.orderId} className="px-4 py-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-[var(--ink)]">
                      {example.displayId ?? example.orderId.slice(-8)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                      {formatDateTime(example.orderedAt)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                      {example.platform}
                    </span>
                    <span
                      className={`border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                        example.chargeStatus === "charged"
                          ? "border-[var(--hairline-bold)] text-[var(--ink)]"
                          : "border-dashed border-[var(--hairline-bold)] text-[var(--ink-muted)]"
                      }`}
                    >
                      {example.chargeStatus === "charged" ? "charged" : "in-store excluded"}
                    </span>
                  </div>
                  <div className="mt-2 text-[14px] text-[var(--ink)]">
                    {example.basketSignature}
                  </div>
                  <div className="mt-1 text-[12px] text-[var(--ink-muted)]">
                    {example.items.map((item) => `${NUMBER.format(item.quantity)} ${item.name}`).join(" + ")}
                  </div>
                  {example.warnings.length > 0 ? (
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-dark)]">
                      {example.warnings.join(" · ")}
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-dashed border-[var(--hairline)] pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                    Containers
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--ink)]">{containerText(example.containers)}</div>
                  <div className="mt-2 font-mono text-[15px] tabular-nums text-[var(--ink)]">
                    {money(example.estimatedCost)}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function InvoiceValidation({ rows }: { rows: PackagingInvoiceValidationRow[] }) {
  return (
    <section className="inv-panel inv-panel--flush">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">Invoice validation</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          Purchases are timing-sensitive
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-[var(--hairline-bold)] font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <th className="px-4 py-3 text-left font-normal">Container</th>
              <th className="px-4 py-3 text-right font-normal">Inferred</th>
              <th className="px-4 py-3 text-right font-normal">Purchased</th>
              <th className="px-4 py-3 text-right font-normal">Gap</th>
              <th className="px-4 py-3 text-right font-normal">Utilization</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.group} className="border-b border-[var(--hairline)] last:border-0">
                <td className="px-4 py-3 text-[var(--ink)]">{row.label}</td>
                <td className="px-4 py-3 text-right tabular-nums">{number(row.inferredUnits)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <div>{number(row.purchasedUnits)}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    {unitMoney(row.purchasedUnitCost)}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{number(row.unitGap)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{pct(row.utilizationPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MethodPanel({ scenario }: { scenario: string }) {
  const rows = [
    ["Source", "Posted Packaging rows in DailyCogsItem"],
    ["Scenario", scenario],
    ["Charged", "Pickup and OFO delivery"],
    ["Excluded", "Dine-in / in-store"],
    ["Examples", "Recomputed from recent order baskets with the same packing helper"],
  ]

  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">Method</span>
      </div>
      <div className="px-4 pb-4">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-dashed border-[var(--hairline)] py-2 last:border-0"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {label}
            </span>
            <span className="max-w-[70%] text-right text-[13px] text-[var(--ink)]">{value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <section className="border border-dashed border-[var(--hairline-bold)] bg-[var(--paper)] px-6 py-12 text-center">
      <div className="font-display text-[22px] italic text-[var(--ink)]">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-[13px] text-[var(--ink-muted)]">
        Change the store or date range to review posted packaging COGS and recent order examples.
      </p>
    </section>
  )
}
