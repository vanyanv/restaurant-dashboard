import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getOrderDetail } from "@/app/actions/order-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

const PLATFORM_LABEL: Record<string, string> = {
  doordash: "DOORDASH",
  ubereats: "UBEREATS",
  grubhub: "GRUBHUB",
  chownow: "CHOWNOW",
  "css-pos": "IN-HOUSE",
  "bnm-web": "ONLINE",
}

export default async function MobileOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  const { id } = await params

  const order = await getOrderDetail(id)
  if (!order) notFound()

  const t = order.referenceTimeLocal
  const cells: MastheadCell[] = [
    { label: "TOTAL", value: fmtMoney(order.total), sub: `${fmtMoney(order.subtotal)} subtotal` },
    {
      label: "FEES + TAX",
      value: fmtMoney(order.tax + order.commission),
      sub: order.tip > 0 ? `${fmtMoney(order.tip)} tip` : undefined,
    },
  ]

  return (
    <>
      <BackLink href="/m/orders" label="All orders" />

      <PageHead
        dept={`${PLATFORM_LABEL[order.platform] ?? order.platform.toUpperCase()} · ${fmtTime(t)}`}
        title={order.externalDisplayId ?? "Order"}
        sub={`${fmtDate(t)} · ${order.storeName}${order.fulfillmentMode ? ` · ${order.fulfillmentMode.toLowerCase()}` : ""}`}
      />

      <MastheadFigures cells={cells} />

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel
          dept={`${order.items.length} ITEM${order.items.length === 1 ? "" : "S"}`}
          title="Itemized"
          flush
        >
          {order.items.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No item details on file.</strong> Run a refetch from the
              desktop view if this looks wrong.
            </div>
          ) : (
            order.items.map((it) => (
              <div
                key={it.id}
                style={{
                  borderTop: "1px solid var(--hairline)",
                  padding: "14px 18px",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "baseline",
                  }}
                >
                  <span
                    className="inv-row__vendor-name"
                    style={{ fontSize: 15 }}
                  >
                    {it.quantity > 1 ? `${it.quantity}× ` : ""}
                    {it.name}
                  </span>
                  <span className="inv-row__total">
                    {fmtMoney(it.price * it.quantity)}
                  </span>
                </div>
                {it.subItems.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: "8px 0 0 14px",
                      margin: 0,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    {it.subItems.map((si) => (
                      <li
                        key={si.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12,
                          fontFamily:
                            "var(--font-dm-sans), ui-sans-serif, sans-serif",
                          fontSize: 12,
                          color: "var(--ink-muted)",
                          fontVariantNumeric: "tabular-nums lining-nums",
                        }}
                      >
                        <span>
                          {si.quantity > 1 ? `${si.quantity}× ` : "+ "}
                          {si.name}
                        </span>
                        {si.price !== 0 ? (
                          <span>{fmtMoney(si.price * si.quantity)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </Panel>
      </div>

      {order.customerName ? (
        <div className="dock-in dock-in-4" style={{ marginTop: 14 }}>
          <Panel dept="CUSTOMER" title={order.customerName}>
            <p
              style={{
                fontSize: 12,
                color: "var(--ink-muted)",
                margin: 0,
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {order.acceptanceStatus ?? order.orderStatus ?? "—"}
            </p>
          </Panel>
        </div>
      ) : null}
    </>
  )
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="m-back-link">
      <span className="m-cap m-cap--ink">← {label}</span>
    </Link>
  )
}
