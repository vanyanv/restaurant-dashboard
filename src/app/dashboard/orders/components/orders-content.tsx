"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  getOrdersList,
  type OrderListFilters,
  type OrderListResponse,
  type OrderListRow,
} from "@/app/actions/order-actions"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OrderRow } from "./order-row"
import { formatPlatform } from "./platform-chip"

type Props = {
  initial: OrderListResponse
  stores: Array<{ id: string; name: string }>
}

export function OrdersContent({ initial, stores }: Props) {
  const [rows, setRows] = useState<OrderListRow[]>(initial.rows)
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [platforms] = useState<string[]>(initial.platforms)
  const [totalCount, setTotalCount] = useState<number>(initial.totalCount)

  const [storeId, setStoreId] = useState<string | null>(null)
  const [platform, setPlatform] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [pending, startTransition] = useTransition()
  const [isFiltered, setIsFiltered] = useState(false)
  const [pageSize, setPageSize] = useState<number>(50)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const sync = () => setPageSize(mq.matches ? 25 : 50)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  const storeName = storeId
    ? stores.find((s) => s.id === storeId)?.name ?? "Store"
    : null

  const todayStats = useMemo(() => summarizeToday(rows), [rows])

  const activeFilterCount =
    (storeId ? 1 : 0) + (platform ? 1 : 0) + (startDate && endDate ? 1 : 0)

  const buildFilters = (): OrderListFilters => ({
    storeId,
    platform,
    startDate: startDate || null,
    endDate: endDate || null,
    search: search || null,
    limit: pageSize,
  })

  function runQuery(filters: OrderListFilters, append = false) {
    startTransition(async () => {
      const res = await getOrdersList(filters)
      if (append) {
        setRows((prev) => [...prev, ...res.rows])
      } else {
        setRows(res.rows)
      }
      setNextCursor(res.nextCursor)
      setTotalCount(res.totalCount)
    })
  }

  function apply() {
    setIsFiltered(
      !!(storeId || platform || startDate || endDate || search.trim())
    )
    runQuery(buildFilters())
  }

  function resetAll() {
    setStoreId(null)
    setPlatform(null)
    setStartDate("")
    setEndDate("")
    setSearch("")
    setIsFiltered(false)
    runQuery({ limit: pageSize })
  }

  function loadMore() {
    if (!nextCursor) return
    runQuery({ ...buildFilters(), cursor: nextCursor }, true)
  }

  return (
    <>
      {/* ─── Top strip ─── */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--hairline)] bg-[color-mix(in_srgb,var(--paper)_90%,transparent)] px-6 backdrop-blur-md">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <span className="font-label text-[var(--ink-muted)]">Section</span>
        <span className="font-display text-[17px] leading-none">Orders</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
          <span className="live-dot" />
          <span className="font-mono uppercase tracking-[0.18em] text-[10px]">
            Live
          </span>
        </span>
      </header>

      {/* ─── Masthead ─── */}
      <section className="border-b border-[var(--hairline)] px-4 pt-6 pb-6 sm:px-6 sm:pt-10 sm:pb-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between dock-in dock-in-1">
          <div>
            <div className="font-label">Volume 1 · Orders ledger</div>
            <h1 className="editorial-h1 font-display mt-1 sm:text-[56px]">
              The daily <em className="italic">service</em>.
            </h1>
            <p className="mt-3 max-w-lg text-[13px] leading-[1.55] text-[var(--ink-muted)]">
              Every ticket across every channel, lined up for a quick read.
              Tap any row to open the order.
            </p>
          </div>

          {/* KPI trio — ribbon on phones, inline trio at ≥640w */}
          <dl className="editorial-kpi-ribbon shrink-0 items-end sm:flex sm:gap-10 sm:overflow-visible sm:pb-0 dock-in dock-in-2">
            <KpiStat
              label="Recent count"
              value={totalCount.toLocaleString()}
              unit="orders"
            />
            <KpiStat
              label="In view · gross"
              value={todayStats.totalDisplay}
              unit="usd"
            />
            <KpiStat
              label="In view · avg ticket"
              value={todayStats.avgDisplay}
              unit="usd"
            />
          </dl>
        </div>
      </section>

      {/* ─── Toolbar ─── */}
      <section className="border-b border-[var(--hairline)] px-4 py-3 sm:px-6 sm:py-4 dock-in dock-in-3">
        {/* Mobile (≤640w): search bar + single Filter button → bottom Sheet */}
        <div className="flex flex-col gap-2 sm:hidden">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
            className="search-shell !w-full"
            role="search"
          >
            <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search orders…"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("")
                  apply()
                }}
                className="text-[var(--ink-faint)] hover:text-[var(--ink)]"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </form>

          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={`toolbar-btn ${activeFilterCount > 0 ? "active" : ""}`}
                  aria-label="Open filters"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="ml-1 font-mono text-[10px] text-[var(--accent)]">
                      · {activeFilterCount}
                    </span>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent
                side="bottom"
                className="max-h-[85vh] overflow-y-auto bg-[var(--paper)] border-t border-[var(--hairline-bold)]"
              >
                <SheetHeader>
                  <SheetTitle className="font-display text-[20px]">
                    Filter orders
                  </SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-5 px-4 pb-6">
                  <div className="flex flex-col gap-2">
                    <div className="font-label">Store</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={`toolbar-btn ${!storeId ? "active" : ""}`}
                        onClick={() => {
                          setStoreId(null)
                          apply()
                        }}
                      >
                        Any store
                      </button>
                      {stores.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`toolbar-btn ${storeId === s.id ? "active" : ""}`}
                          onClick={() => {
                            setStoreId(s.id)
                            apply()
                          }}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="font-label">Platform</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={`toolbar-btn ${!platform ? "active" : ""}`}
                        onClick={() => {
                          setPlatform(null)
                          apply()
                        }}
                      >
                        Any platform
                      </button>
                      {platforms.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`toolbar-btn ${platform === p ? "active" : ""}`}
                          onClick={() => {
                            setPlatform(p)
                            apply()
                          }}
                        >
                          {formatPlatform(p)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="font-label">Date range</div>
                    <DateRangePicker
                      days={30}
                      customRange={
                        startDate && endDate ? { startDate, endDate } : null
                      }
                      onRangeChange={(s, e) => {
                        setStartDate(s)
                        setEndDate(e)
                        setIsFiltered(
                          !!(storeId || platform || s || e || search.trim())
                        )
                        runQuery({
                          storeId,
                          platform,
                          startDate: s || null,
                          endDate: e || null,
                          search: search || null,
                          limit: 50,
                        })
                      }}
                      isPending={pending}
                    />
                  </div>

                  {isFiltered && (
                    <button
                      type="button"
                      onClick={resetAll}
                      className="toolbar-btn self-start text-[var(--accent)]"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <div className="ml-auto font-mono text-[11px] text-[var(--ink-faint)]">
              {pending
                ? "Loading…"
                : `${rows.length} / ${totalCount.toLocaleString()}`}
            </div>
          </div>
        </div>

        {/* Tablet + desktop (≥640w): original inline toolbar */}
        <div className="hidden flex-wrap items-center gap-2 sm:flex">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              apply()
            }}
            className="search-shell"
            role="search"
          >
            <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search display ID, customer, order ID…"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("")
                  apply()
                }}
                className="text-[var(--ink-faint)] hover:text-[var(--ink)]"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <span className="kbd-chip">↵</span>
          </form>

          <FilterPopover
            label="Store"
            value={storeName}
            onClear={() => {
              setStoreId(null)
              apply()
            }}
          >
            {stores.map((s) => (
              <FilterOption
                key={s.id}
                active={storeId === s.id}
                onClick={() => {
                  setStoreId(s.id)
                  apply()
                }}
              >
                {s.name}
              </FilterOption>
            ))}
          </FilterPopover>

          <FilterPopover
            label="Platform"
            value={platform ? formatPlatform(platform) : null}
            onClear={() => {
              setPlatform(null)
              apply()
            }}
          >
            {platforms.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--ink-faint)]">
                No platforms yet
              </div>
            ) : (
              platforms.map((p) => (
                <FilterOption
                  key={p}
                  active={platform === p}
                  onClick={() => {
                    setPlatform(p)
                    apply()
                  }}
                >
                  {formatPlatform(p)}
                </FilterOption>
              ))
            )}
          </FilterPopover>

          <DateRangePicker
            days={30}
            customRange={
              startDate && endDate ? { startDate, endDate } : null
            }
            onRangeChange={(s, e) => {
              setStartDate(s)
              setEndDate(e)
              setIsFiltered(
                !!(storeId || platform || s || e || search.trim())
              )
              runQuery({
                storeId,
                platform,
                startDate: s || null,
                endDate: e || null,
                search: search || null,
                limit: 50,
              })
            }}
            isPending={pending}
          />

          {isFiltered && (
            <button
              type="button"
              onClick={resetAll}
              className="toolbar-btn text-[var(--accent)]"
            >
              Clear all
            </button>
          )}

          <div className="ml-auto font-mono text-[11px] text-[var(--ink-faint)]">
            {pending ? "Loading…" : `${rows.length} of ${totalCount.toLocaleString()} shown`}
          </div>
        </div>
      </section>

      {/* ─── List ─── */}
      <section className="px-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <div className="font-label mb-3">empty ledger</div>
            <p className="font-display text-[24px] leading-tight max-w-md">
              No orders match this view yet.
            </p>
            <p className="mt-2 text-[13px] text-[var(--ink-muted)] max-w-sm">
              Try widening the date range, or run an Otter orders sync if
              nothing has synced yet.
            </p>
          </div>
        ) : (
          <div role="list" className="border-b border-[var(--hairline)]">
            {rows.map((r, i) => (
              <OrderRow key={r.id} order={r} index={i} />
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="flex justify-center py-8">
            <button
              type="button"
              onClick={loadMore}
              disabled={pending}
              className="toolbar-btn"
            >
              {pending ? "Loading…" : `Load ${pageSize} more`}
            </button>
          </div>
        )}
      </section>
    </>
  )
}

function KpiStat({
  label,
  value,
  unit,
}: {
  label: string
  value: string
  unit: string
}) {
  return (
    <div>
      <div className="font-label">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <div className="font-display-tight text-[36px] leading-none tracking-[-0.03em]">
          {value}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {unit}
        </div>
      </div>
    </div>
  )
}

function FilterPopover({
  label,
  value,
  onClear,
  children,
}: {
  label: string
  value: string | null
  onClear: () => void
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`toolbar-btn ${value ? "active" : ""}`}>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            {label}
          </span>
          <span className="ml-1.5">{value ?? "Any"}</span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onClear()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation()
                  onClear()
                }
              }}
              className="ml-2 text-[var(--ink-faint)] hover:text-[var(--ink)]"
              aria-label={`Clear ${label}`}
            >
              <X className="inline h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(calc(100vw-1rem),280px)] min-w-[220px] p-0 bg-[var(--paper)] border border-[var(--hairline-bold)] shadow-md"
      >
        <div className="py-1.5">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

function FilterOption({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] ${
        active
          ? "bg-[var(--accent-bg)] text-[var(--accent-dark)]"
          : "hover:bg-[rgba(0,0,0,0.03)]"
      }`}
    >
      <span>{children}</span>
      {active && (
        <span className="font-mono text-[10px] text-[var(--accent)]">✓</span>
      )}
    </button>
  )
}

function summarizeToday(rows: OrderListRow[]): {
  totalDisplay: string
  avgDisplay: string
} {
  if (rows.length === 0) return { totalDisplay: "—", avgDisplay: "—" }
  const total = rows.reduce((s, r) => s + r.total, 0)
  const avg = total / rows.length
  return {
    totalDisplay: formatUsd(total),
    avgDisplay: formatUsd(avg),
  }
}

function formatUsd(n: number): string {
  if (n >= 10_000) {
    return `$${(n / 1000).toFixed(1)}k`
  }
  return `$${n.toFixed(0)}`
}
