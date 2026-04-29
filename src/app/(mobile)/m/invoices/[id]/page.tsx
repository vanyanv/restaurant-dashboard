import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { InvoiceActions } from "./invoice-actions"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtDate = (iso: string | null) => {
  if (!iso) return "—"
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function MobileInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  const { id } = await params

  const invoice = await prisma.invoice.findFirst({
    where: { id, accountId: session.user.accountId },
    select: {
      id: true,
      vendorName: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      subtotal: true,
      taxAmount: true,
      status: true,
      storeId: true,
      store: { select: { id: true, name: true } },
      lineItems: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          productName: true,
          description: true,
          category: true,
          quantity: true,
          unit: true,
          extendedPrice: true,
        },
      },
    },
  })

  if (!invoice) notFound()

  const stores = await prisma.store.findMany({
    where: { accountId: session.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const status = (invoice.status ?? "PENDING").toUpperCase()
  const invoiceDateIso = invoice.invoiceDate?.toISOString().slice(0, 10) ?? null
  const dueDateIso = invoice.dueDate?.toISOString().slice(0, 10) ?? null

  const cells: MastheadCell[] = [
    {
      label: "TOTAL",
      value: fmtMoney(invoice.totalAmount),
      sub:
        invoice.subtotal != null
          ? `${fmtMoney(invoice.subtotal)} subtotal`
          : invoice.store?.name ?? undefined,
    },
    dueDateIso
      ? {
          label: "DUE",
          value: fmtDate(dueDateIso),
          sub: invoice.store?.name ?? "unassigned",
        }
      : {
          label: "TAX",
          value: fmtMoney(invoice.taxAmount),
          sub: invoice.store?.name ?? "unassigned",
        },
  ]

  return (
    <>
      <Link href="/m/invoices" className="m-back-link">
        <span className="m-cap m-cap--ink">← All invoices</span>
      </Link>

      <PageHead
        dept={invoice.invoiceNumber ? `INV #${invoice.invoiceNumber}` : "INVOICE"}
        title={invoice.vendorName}
        sub={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>{fmtDate(invoiceDateIso)}</span>
            <span className="inv-stamp" data-status={status}>
              {status}
            </span>
          </span>
        }
      />

      <MastheadFigures cells={cells} />

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel dept="ACTIONS" title="Update">
          <InvoiceActions
            invoiceId={invoice.id}
            currentStatus={invoice.status}
            currentStoreId={invoice.storeId ?? null}
            stores={stores}
          />
        </Panel>
      </div>

      <div className="dock-in dock-in-4" style={{ marginTop: 14 }}>
        <Panel
          dept={`${invoice.lineItems.length} LINES`}
          title="Itemized"
          flush
        >
          {invoice.lineItems.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No line items extracted.</strong>
            </div>
          ) : (
            invoice.lineItems.map((li) => {
              const meta = [
                li.quantity != null
                  ? `${li.quantity}${li.unit ? ` ${li.unit}` : ""}`
                  : null,
                li.category,
              ]
                .filter(Boolean)
                .join(" · ")
              return (
                <div key={li.id} className="inv-line">
                  <span className="inv-line__name">
                    <span>
                      {li.productName ?? li.description ?? "Untitled"}
                    </span>
                    {meta ? <span className="inv-line__meta">{meta}</span> : null}
                  </span>
                  <span className="inv-line__total">
                    {fmtMoney(li.extendedPrice)}
                  </span>
                </div>
              )
            })
          )}
        </Panel>
      </div>
    </>
  )
}
