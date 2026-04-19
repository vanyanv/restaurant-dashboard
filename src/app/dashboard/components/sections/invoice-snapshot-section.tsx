import { InvoiceSnapshot } from "@/components/analytics/invoice-snapshot"
import { SectionHead } from "../section-head"
import { fetchInvoiceSummary, fetchInvoiceBreakdown } from "./data"

export async function InvoiceSnapshotSection() {
  const [summary, breakdown] = await Promise.all([
    fetchInvoiceSummary(),
    fetchInvoiceBreakdown(),
  ])
  if (!summary || !breakdown) return null

  return (
    <div className="dock-in dock-in-6">
      <SectionHead label="Invoices · last 30 days" />
      <InvoiceSnapshot summary={summary} breakdown={breakdown} />
    </div>
  )
}
