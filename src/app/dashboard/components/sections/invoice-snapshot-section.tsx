import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { fetchInvoiceSummary } from "./data"

/**
 * Invoice spend, compact.
 *
 * Not `InvoiceSnapshot` — that component carries its own title bar, a
 * store/vendor toggle and a search field, which read as a second page inside
 * this one when the section head above already names it. Here the section head
 * does that work and the panel is three figures and the vendors behind them.
 */

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export async function InvoiceSnapshotSection() {
  const summary = await fetchInvoiceSummary()
  if (!summary) return null

  const vendors = summary.spendByVendor.slice(0, 5)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-(--hairline) pb-3">
        <span className="editorial-section-label">Invoices · last 30 days</span>
        <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
        <Link
          href="/dashboard/invoices"
          className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-muted) transition-colors hover:text-(--accent)"
        >
          All invoices
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
        </Link>
      </div>

      <div className="ov-invoices">
        <div className="ov-invoices__kpis">
          <div>
            <div className="ov-invoices__kpi-label">Spend</div>
            <div className="ov-invoices__kpi-value">
              {money(summary.totalSpend)}
            </div>
          </div>
          <div>
            <div className="ov-invoices__kpi-label">Invoices</div>
            <div className="ov-invoices__kpi-value">{summary.invoiceCount}</div>
          </div>
          <div>
            <div className="ov-invoices__kpi-label">Needs review</div>
            <div
              className={`ov-invoices__kpi-value${
                summary.pendingReviewCount > 0 ? " is-flagged" : ""
              }`}
            >
              {summary.pendingReviewCount}
            </div>
          </div>
          {summary.pendingReviewCount > 0 && (
            <div>
              <div className="ov-invoices__kpi-label">Held from COGS</div>
              <div className="ov-invoices__kpi-value">
                {money(summary.pendingReviewTotal)}
              </div>
            </div>
          )}
        </div>

        {vendors.length === 0 ? (
          <div className="px-5 py-6 text-[13px] text-(--ink-muted)">
            No invoices in the last 30 days.
          </div>
        ) : (
          vendors.map((v) => (
            <div key={v.vendor} className="ov-invoices__vendor">
              <span className="ov-invoices__vendor-name">{v.vendor}</span>
              <span className="ov-invoices__vendor-total">
                {money(v.total)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
