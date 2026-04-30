import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getInvoiceList,
  getInvoiceSummary,
} from "@/app/actions/invoice-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtMoneyAggregate = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtDateShort = (iso: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso + "T12:00:00")
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase()
}

const weekKey = (iso: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso + "T12:00:00")
  const day = d.getUTCDay()
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setUTCDate(diff)
  return monday.toISOString().slice(0, 10)
}

const weekLabel = (iso: string) => {
  const d = new Date(iso + "T12:00:00")
  const end = new Date(d)
  end.setUTCDate(d.getUTCDate() + 6)
  const fmt = (x: Date) =>
    x
      .toLocaleDateString("en-US", { month: "short", day: "numeric" })
      .toUpperCase()
  return `WEEK OF ${fmt(d)} – ${fmt(end)}`
}

type FilterValue = "ALL" | "REVIEW" | "APPROVED" | "POSTED"

const FILTERS: Array<{ value: FilterValue; label: string; href: string }> = [
  { value: "ALL", label: "All", href: "/m/invoices" },
  { value: "REVIEW", label: "Review", href: "/m/invoices?status=REVIEW" },
  { value: "APPROVED", label: "Approved", href: "/m/invoices?status=APPROVED" },
  { value: "POSTED", label: "Posted", href: "/m/invoices?status=POSTED" },
]

export default async function MobileInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const status = sp.status ?? undefined
  const activeFilter: FilterValue = (status as FilterValue) ?? "ALL"
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const [list, summary] = await Promise.all([
    getInvoiceList({ status, page, limit: 50 }),
    getInvoiceSummary({ days: 30 }),
  ])

  const cells: MastheadCell[] = [
    {
      label: "30D SPEND",
      value: fmtMoneyAggregate(summary.totalSpend),
      sub: `${summary.invoiceCount} invoices`,
    },
    {
      label: "PENDING",
      value: String(summary.pendingReviewCount),
      sub: "awaiting review",
    },
  ]

  const isEmpty = list.invoices.length === 0
  const panelDept = isEmpty
    ? "LEDGER"
    : `${list.total.toLocaleString()} INVOICES`

  return (
    <>
      <PageHead
        dept="LEDGER"
        title="Invoices"
        sub={`Last 30 days · ${summary.vendorCount} vendors`}
      />
      <MastheadFigures cells={cells} />

      <nav
        className="m-segmented dock-in dock-in-3"
        aria-label="Filter invoices by status"
        style={{ marginTop: 14 }}
      >
        {FILTERS.map((f) => {
          const active = activeFilter === f.value
          return (
            <Link
              key={f.value}
              href={f.href}
              className={`m-segmented__item${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          )
        })}
      </nav>

      <div className="dock-in dock-in-4" style={{ marginTop: 14 }}>
        <Panel dept={panelDept} title="Open ledger" flush>
          {isEmpty ? (
            <div className="m-empty m-empty--flush">
              <strong>No invoices match this filter.</strong>
            </div>
          ) : (
            <InvoiceLedger invoices={list.invoices} />
          )}
        </Panel>
      </div>

      {list.totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          style={{
            marginTop: 14,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          {page > 1 ? (
            <Link
              className="m-toolbar-btn"
              href={`/m/invoices?${status ? `status=${status}&` : ""}page=${page - 1}`}
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span style={{ minWidth: 1 }} />
          )}
          <span className="m-cap" style={{ flex: "0 0 auto" }}>
            Page {page} of {list.totalPages}
          </span>
          {page < list.totalPages ? (
            <Link
              className="m-toolbar-btn"
              href={`/m/invoices?${status ? `status=${status}&` : ""}page=${page + 1}`}
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span style={{ minWidth: 1 }} />
          )}
        </nav>
      ) : null}
    </>
  )
}

type Invoice = Awaited<
  ReturnType<typeof getInvoiceList>
>["invoices"][number]

function InvoiceLedger({ invoices }: { invoices: Invoice[] }) {
  const groups: Array<{ key: string; label: string; rows: Invoice[] }> = []
  for (const inv of invoices) {
    const key = weekKey(inv.invoiceDate)
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.rows.push(inv)
    } else {
      groups.push({
        key,
        label:
          key === "—" ? "UNDATED" : weekLabel(key),
        rows: [inv],
      })
    }
  }

  return (
    <>
      {groups.map((g, gi) => (
        <div key={g.key + gi}>
          {gi > 0 || groups.length > 1 ? (
            <div className="m-perforation">{g.label}</div>
          ) : null}
          {g.rows.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} />
          ))}
        </div>
      ))}
    </>
  )
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const dateLabel = fmtDateShort(inv.invoiceDate)
  const storeLabel = inv.storeName ?? null
  const status = (inv.status ?? "PENDING").toUpperCase()
  return (
    <Link
      href={`/m/invoices/${inv.id}`}
      className="inv-row"
      style={{
        gridTemplateColumns: "[meta] 1fr [total] auto",
        gap: 14,
        padding: "16px 18px",
        alignItems: "start",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span className="m-cap">
          {dateLabel}
          {storeLabel ? ` · ${storeLabel}` : ""}
        </span>
        <span className="inv-row__vendor-name">{inv.vendorName}</span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 2,
          }}
        >
          {inv.invoiceNumber ? (
            <span
              className="m-cap m-cap--ink"
              style={{ letterSpacing: "0.12em" }}
            >
              #{inv.invoiceNumber}
            </span>
          ) : null}
          <span className="inv-stamp" data-status={status}>
            {status}
          </span>
        </span>
      </span>
      <span className="inv-row__total">
        {fmtMoney(inv.totalAmount ?? 0)}
      </span>
    </Link>
  )
}
