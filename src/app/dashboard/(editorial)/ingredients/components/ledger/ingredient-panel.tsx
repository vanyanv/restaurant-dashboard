"use client"

import Link from "next/link"
import { formatUnitPrice } from "@/lib/pantry-format"
import { PriceChart } from "./price-chart"
import type {
  PantryIngredientHistory,
  PantryLedgerRow,
} from "@/app/actions/pantry-ledger-actions"

/**
 * The expanded ledger row: everything an owner needs to decide whether a price
 * move is real, without leaving the ledger.
 *
 * Deliveries carry the RAW invoice product name and link to the invoice.
 * That link is not a convenience — every number on this page is an inference
 * over invoice lines a fuzzy matcher grouped together, and the invoice is the
 * only artefact in the system that cannot be wrong.
 */

const money = (n: number, dp = 0) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })

const shortDate = (iso: string): string => {
  const [, m, d] = iso.split("-")
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[Number(m) - 1]} ${Number(d)}`
}

type Props = {
  row: PantryLedgerRow
  history: PantryIngredientHistory | null
  loading: boolean
}

export function IngredientPanel({ row, history, loading }: Props) {
  if (loading || !history) {
    return (
      <div className="pl-panel">
        <p className="pl-none pl-panel__wide">Loading history…</p>
      </div>
    )
  }

  const { series, deliveries, products, recipes } = history
  const capped = deliveries.length > 0 && series.length === 60

  return (
    <div className="pl-panel">
      <PriceChart series={series} capped={capped} />

      {deliveries.length > 0 && (
        <div>
          <h4>
            Recent deliveries
            <span className="pl-panel__ct">tap a date to open the invoice</span>
          </h4>
          <table className="pl-mini">
            <tbody>
              {deliveries.map((d) => (
                <tr key={`${d.invoiceId}-${d.date}-${d.sku ?? ""}-${d.extendedPrice}`}>
                  <td className="pl-mini__mono">
                    <Link
                      href={`/dashboard/invoices/${d.invoiceId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pl-invoice-link"
                    >
                      {shortDate(d.date)}
                    </Link>
                  </td>
                  <td>
                    {d.productName}
                    <span className="pl-sub">
                      {d.vendor}
                      {d.sku ? ` · sku ${d.sku}` : ""} · inv {d.invoiceNumber}
                    </span>
                  </td>
                  <td className="pl-mini__n">
                    {d.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    <span className="pl-unit__suffix"> {(d.unit ?? "").toLowerCase()}</span>
                  </td>
                  <td className="pl-mini__n">{formatUnitPrice(d.unitPrice)}</td>
                  <td className="pl-mini__n pl-mini__b">{money(d.extendedPrice, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {products.length > 1 ? (
        <div>
          <h4>
            Products bought under this name
            <span className="pl-panel__ct">{products.length}</span>
          </h4>
          <table className="pl-mini">
            <tbody>
              {products.map((p) => (
                <tr key={p.sku ?? "none"}>
                  <td>
                    {p.productName}
                    <span className="pl-sub">
                      {p.vendor}
                      {p.sku ? ` · sku ${p.sku}` : " · no sku"}
                    </span>
                  </td>
                  <td className="pl-mini__mono pl-mini__dim">
                    {shortDate(p.firstAt)}–{shortDate(p.lastAt)}
                  </td>
                  <td className="pl-mini__n">
                    {formatUnitPrice(p.lastUnitPrice)}
                    <span className="pl-unit__suffix">/{(p.unit ?? "unit").toLowerCase()}</span>
                  </td>
                  <td className="pl-mini__n pl-mini__b">{money(p.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pl-insight">
            <b>{products.length} different SKUs</b> share this ingredient, so a price trend across
            them compares different products. Open an invoice to confirm which.
          </p>
        </div>
      ) : (
        row.vendors.length > 1 && (
          <div>
            <h4>
              Vendors
              <span className="pl-panel__ct">{row.vendors.length}</span>
            </h4>
            <p className="pl-none">
              {row.vendors.join(" · ")} — one SKU, so these prices are comparable.
            </p>
          </div>
        )
      )}

      <div>
        <h4>
          On the menu
          {recipes.length > 0 && <span className="pl-panel__ct">{recipes.length}</span>}
        </h4>
        {recipes.length === 0 ? (
          <p className="pl-none">
            Not used in any recipe, so this cost never reaches a plate.
          </p>
        ) : (
          <table className="pl-mini">
            <tbody>
              {recipes.slice(0, 8).map((r) => (
                <tr key={r.recipeName}>
                  <td>{r.recipeName}</td>
                  <td className="pl-mini__mono pl-mini__dim">
                    {r.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} {r.unit}
                  </td>
                  <td className="pl-mini__n pl-mini__b">
                    {r.costPerServing != null ? (
                      money(r.costPerServing, 2)
                    ) : (
                      <span className="pl-mini__dim">unit mismatch</span>
                    )}
                  </td>
                  <td className="pl-mini__mono pl-mini__dim">per serving</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="pl-xref">
        Consumption and waste for this ingredient live on{" "}
        <Link href="/dashboard/operations/product-usage">Product Usage</Link>
        {row.isPackaging && (
          <>
            {" · container economics on "}
            <Link href="/dashboard/operations/packaging">Packaging Costs</Link>
          </>
        )}
        .
      </p>
    </div>
  )
}
