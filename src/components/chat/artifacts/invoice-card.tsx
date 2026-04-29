"use client"

import type { InvoiceByIdResult } from "@/lib/chat/tools/invoices"
import { CardShell, Num, fmtMoney } from "./card-shell"

interface Props {
  invoice: InvoiceByIdResult
  /** When true (typical for `getTopInvoices` / `searchInvoices` per-row),
   *  starts collapsed; clicking the head opens the full line-item table. */
  collapsedDefault?: boolean
}

export function InvoiceCard({ invoice, collapsedDefault }: Props) {
  return (
    <CardShell
      dept="INVOICE"
      headline={<Num>{fmtMoney(invoice.totalAmount)}</Num>}
      subline={
        <>
          <span>{invoice.vendor}</span>
          {invoice.invoiceNumber ? <span> · #{invoice.invoiceNumber}</span> : null}
          {invoice.date ? <span> · {invoice.date}</span> : null}
          {invoice.storeName ? <span> · {invoice.storeName}</span> : null}
        </>
      }
      footerHref={`/dashboard/invoices/${invoice.invoiceId}`}
      defaultOpen={!collapsedDefault}
    >
      <div className="chat-artifact__table-wrap">
        <table className="chat-artifact__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th className="num">Unit price</th>
              <th className="num">Extended</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.lineId}>
                <td>{l.lineNumber}</td>
                <td>
                  <div className="chat-artifact__line-name">{l.productName}</div>
                  {l.canonicalIngredient ? (
                    <div className="chat-artifact__line-sub">
                      {l.canonicalIngredient}
                    </div>
                  ) : null}
                </td>
                <td className="num">
                  <Num>{l.quantity.toLocaleString()}</Num>
                </td>
                <td>{l.unit ?? ""}</td>
                <td className="num">
                  <Num>{fmtMoney(l.unitPrice)}</Num>
                </td>
                <td className="num">
                  <Num>{fmtMoney(l.extendedPrice)}</Num>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="chat-artifact__tfoot-label">
                Subtotal
              </td>
              <td className="num">
                <Num>{fmtMoney(invoice.subtotal)}</Num>
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="chat-artifact__tfoot-label">
                Tax
              </td>
              <td className="num">
                <Num>{fmtMoney(invoice.taxAmount)}</Num>
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="chat-artifact__tfoot-label chat-artifact__tfoot-label--bold">
                Total
              </td>
              <td className="num">
                <Num>{fmtMoney(invoice.totalAmount)}</Num>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </CardShell>
  )
}

interface InvoiceSummaryRow {
  invoiceId: string
  vendor: string
  totalAmount: number
  date: string | null
  lineCount?: number
}

/** Compact card used per-row when getTopInvoices / searchInvoices return
 *  multiple hits. Header carries the totals; the body is a small note plus
 *  a link out — full line-items live behind the dashboard page since the
 *  smoke list shouldn't fire N parallel `getInvoiceById` calls. */
export function InvoiceSummaryCard({
  row,
  isHighlighted,
}: {
  row: InvoiceSummaryRow
  /** When true, the card frame paints a red proofmark left-bar — the
   *  invoice the assistant is answering about (e.g. row 0 of getTopInvoices). */
  isHighlighted?: boolean
}) {
  return (
    <CardShell
      dept="INVOICE"
      isHighlighted={isHighlighted}
      headline={<Num>{fmtMoney(row.totalAmount)}</Num>}
      subline={
        <>
          <span>{row.vendor}</span>
          {row.date ? <span> · {row.date}</span> : null}
          {row.lineCount !== undefined ? (
            <span> · {row.lineCount} line items</span>
          ) : null}
        </>
      }
      footerHref={`/dashboard/invoices/${row.invoiceId}`}
      defaultOpen={false}
    >
      <div className="chat-artifact__hint">
        Open the invoice in the dashboard to see every line item.
      </div>
    </CardShell>
  )
}
