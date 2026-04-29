"use client"

import type { ReactNode } from "react"
import type { InvoiceByIdResult, InvoiceSpendResult, InvoiceSearchRow, TopInvoiceRow } from "@/lib/chat/tools/invoices"
import type { RecipeResult, RecipeSearchRow } from "@/lib/chat/tools/recipes"
import type { MenuItemDetailsResult, MenuPriceRow, TopMenuItemRow } from "@/lib/chat/tools/menu"
import type { CogsByItemRow } from "@/lib/chat/tools/cogs"
import type { StoreBreakdownRow, OperationalCostRow } from "@/lib/chat/tools/store-summary"
import type { DailySalesRow, HourlyTrendRow, CompareSalesResult } from "@/lib/chat/tools/sales"
import type { RefundRow } from "@/lib/chat/tools/refunds"
import { InvoiceCard, InvoiceSummaryCard } from "./artifacts/invoice-card"
import { RecipeCard } from "./artifacts/recipe-card"
import { MenuItemCard } from "./artifacts/menu-item-card"
import { StoreSummaryCard } from "./artifacts/store-summary-card"
import { TableCard } from "./artifacts/table-card"
import { TrendCard } from "./artifacts/trend-card"
import { Num, fmtMoney, fmtCount, fmtPct } from "./artifacts/card-shell"

interface ToolPart {
  type: string
  toolName?: string
  state?: string
  output?: unknown
}

interface Props {
  parts: ToolPart[]
}

/**
 * Dispatches each tool-call output to the right artifact card. Reads only
 * `parts` whose `state === "output-available"` (the AI SDK marker that the
 * tool has resolved); ignores the rest. The order of artifacts matches the
 * order of tool calls in the message — the model's prose paragraph is
 * rendered above by `<ChatMessage>`, the cards hang below.
 */
export function ChatArtifacts({ parts }: Props) {
  const cards: ReactNode[] = []

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) continue
    if (p.state !== "output-available") continue
    const tool = p.toolName ?? p.type.replace(/^tool-/, "")
    const out = p.output
    const k = `${tool}-${i}`

    switch (tool) {
      case "getInvoiceById": {
        if (out && typeof out === "object" && "invoiceId" in out) {
          cards.push(<InvoiceCard key={k} invoice={out as InvoiceByIdResult} />)
        }
        break
      }
      case "getTopInvoices": {
        if (Array.isArray(out)) {
          const rows = out as TopInvoiceRow[]
          rows.forEach((row, idx) =>
            cards.push(
              <InvoiceSummaryCard
                key={`${k}-${idx}`}
                row={{
                  invoiceId: row.invoiceId,
                  vendor: row.vendor,
                  totalAmount: row.totalAmount,
                  date: row.date,
                  lineCount: row.lineCount,
                }}
                isHighlighted={idx === 0 && rows.length > 1}
              />,
            ),
          )
        }
        break
      }
      case "searchInvoices": {
        if (Array.isArray(out)) {
          const rows = out as InvoiceSearchRow[]
          // Group by invoiceId so we don't render the same invoice 3x when
          // multiple line-hits share it.
          const seen = new Set<string>()
          for (let j = 0; j < rows.length; j++) {
            const r = rows[j]
            if (!r.invoiceId || seen.has(r.invoiceId)) continue
            seen.add(r.invoiceId)
            cards.push(
              <InvoiceSummaryCard
                key={`${k}-${j}`}
                row={{
                  invoiceId: r.invoiceId,
                  vendor: r.vendor,
                  totalAmount: r.amount,
                  date: r.date,
                }}
              />,
            )
          }
        }
        break
      }
      case "getRecipeByName":
      case "getRecipeById": {
        if (out && typeof out === "object" && "recipeId" in out) {
          cards.push(<RecipeCard key={k} recipe={out as RecipeResult} />)
        }
        break
      }
      case "searchRecipes": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as RecipeSearchRow[]
          cards.push(
            <TableCard
              key={k}
              dept="RECIPES"
              caption={`${rows.length} match${rows.length === 1 ? "" : "es"}`}
              rows={rows}
              footerHref="/dashboard/recipes"
              columns={[
                { header: "Name", render: (r) => r.itemName },
                { header: "Category", render: (r) => r.category },
                {
                  header: "Match",
                  align: "right",
                  render: (r) => `${(r.score * 100).toFixed(0)}%`,
                },
              ]}
            />,
          )
        }
        break
      }
      case "getMenuItemDetails": {
        if (out && typeof out === "object" && "itemName" in out) {
          cards.push(
            <MenuItemCard key={k} details={out as MenuItemDetailsResult} />,
          )
        }
        break
      }
      case "getMenuPrices": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as MenuPriceRow[]
          cards.push(
            <TableCard
              key={k}
              dept="MENU PRICES"
              caption={`${rows.length} item${rows.length === 1 ? "" : "s"}`}
              rows={rows}
              footerHref="/dashboard/menu/catalog"
              columns={[
                { header: "Item", render: (r) => r.menuItem },
                { header: "Store", render: (r) => r.store },
                { header: "Category", render: (r) => r.category },
                {
                  header: "Current price",
                  align: "right",
                  render: (r) => fmtMoney(r.currentPrice),
                },
                {
                  header: "Last sale",
                  align: "right",
                  render: (r) => r.lastChangedAt ?? "—",
                },
              ]}
            />,
          )
        }
        break
      }
      case "getTopMenuItems": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as TopMenuItemRow[]
          cards.push(
            <TableCard
              key={k}
              dept="TOP MENU ITEMS"
              caption={`Top ${rows.length}`}
              rows={rows}
              highlightedRowIndex={rows.length > 1 ? 0 : undefined}
              footerHref="/dashboard/menu/catalog"
              columns={[
                { header: "Item", render: (r) => r.itemName },
                { header: "Category", render: (r) => r.category },
                {
                  header: "Qty",
                  align: "right",
                  render: (r) => fmtCount(r.qty),
                },
                {
                  header: "Revenue",
                  align: "right",
                  render: (r) => fmtMoney(r.revenue),
                },
                {
                  header: "Avg price",
                  align: "right",
                  render: (r) => fmtMoney(r.avgPrice),
                },
              ]}
            />,
          )
        }
        break
      }
      case "getCogsByItem": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as CogsByItemRow[]
          cards.push(
            <TableCard
              key={k}
              dept="ITEM COGS"
              caption={`${rows.length} costed item${rows.length === 1 ? "" : "s"}`}
              rows={rows}
              footerHref="/dashboard/cogs"
              columns={[
                { header: "Item", render: (r) => r.menuItem },
                { header: "Category", render: (r) => r.category },
                {
                  header: "Sold qty",
                  align: "right",
                  render: (r) => fmtCount(r.soldQty),
                },
                {
                  header: "Revenue",
                  align: "right",
                  render: (r) => fmtMoney(r.revenue),
                },
                {
                  header: "COGS",
                  align: "right",
                  render: (r) => fmtMoney(r.cogs),
                },
                {
                  header: "Margin",
                  align: "right",
                  render: (r) =>
                    r.marginPct !== null
                      ? `${r.marginPct.toFixed(1)}%`
                      : "—",
                },
              ]}
            />,
          )
        }
        break
      }
      case "getStoreBreakdown": {
        if (Array.isArray(out)) {
          const rows = out as StoreBreakdownRow[]
          // Highlight the store with the highest net (the answer to
          // "which store is doing best?"). When only one store is in the
          // owner's scope, no highlight is meaningful.
          let bestIdx = -1
          let bestNet = -Infinity
          for (let n = 0; n < rows.length; n++) {
            if (rows[n].net > bestNet) {
              bestNet = rows[n].net
              bestIdx = n
            }
          }
          rows.forEach((row, idx) =>
            cards.push(
              <StoreSummaryCard
                key={`${k}-${idx}`}
                row={row}
                collapsedDefault={rows.length > 3}
                isHighlighted={rows.length > 1 && idx === bestIdx}
              />,
            ),
          )
        }
        break
      }
      case "getOperationalCosts": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as OperationalCostRow[]
          cards.push(
            <TableCard
              key={k}
              dept="FIXED COSTS"
              caption={`${rows.length} store${rows.length === 1 ? "" : "s"}`}
              rows={rows}
              footerHref="/dashboard/stores"
              columns={[
                { header: "Store", render: (r) => r.storeName },
                {
                  header: "Labor /mo",
                  align: "right",
                  render: (r) => fmtMoney(r.fixedMonthlyLabor),
                },
                {
                  header: "Rent /mo",
                  align: "right",
                  render: (r) => fmtMoney(r.fixedMonthlyRent),
                },
                {
                  header: "Towels /mo",
                  align: "right",
                  render: (r) => fmtMoney(r.fixedMonthlyTowels),
                },
                {
                  header: "Cleaning /mo",
                  align: "right",
                  render: (r) => fmtMoney(r.fixedMonthlyCleaning),
                },
                {
                  header: "Total /mo",
                  align: "right",
                  render: (r) => fmtMoney(r.totalFixedMonthly),
                },
                {
                  header: "Target COGS",
                  align: "right",
                  render: (r) =>
                    r.targetCogsPct !== null
                      ? `${r.targetCogsPct.toFixed(1)}%`
                      : "—",
                },
              ]}
            />,
          )
        }
        break
      }
      case "getInvoiceSpend": {
        if (out && typeof out === "object") {
          const r = out as InvoiceSpendResult
          if (r.byVendor.length > 0) {
            cards.push(
              <TableCard
                key={`${k}-vendors`}
                dept="VENDOR SPEND"
                caption={
                  <>
                    Total <Num>{fmtMoney(r.totalAmount)}</Num> across{" "}
                    <Num>{fmtCount(r.invoiceCount)}</Num> invoices
                  </>
                }
                rows={r.byVendor}
                highlightedRowIndex={r.byVendor.length > 1 ? 0 : undefined}
                footerHref="/dashboard/invoices"
                columns={[
                  { header: "Vendor", render: (v) => v.vendor },
                  {
                    header: "Spend",
                    align: "right",
                    render: (v) => fmtMoney(v.amount),
                  },
                  {
                    header: "Invoices",
                    align: "right",
                    render: (v) => fmtCount(v.invoiceCount),
                  },
                  {
                    header: "Share",
                    align: "right",
                    render: (v) => fmtPct(v.share),
                  },
                ]}
              />,
            )
          }
          if (r.byMonth.length > 0) {
            cards.push(
              <TrendCard
                key={`${k}-months`}
                dept="MONTHLY SPEND"
                caption="Spend by month"
                points={r.byMonth.map((m) => ({
                  label: m.month,
                  value: m.amount,
                  secondary: m.invoiceCount,
                  secondaryLabel: "Invoices",
                }))}
                valueLabel="Spend"
                footerHref="/dashboard/invoices"
              />,
            )
          }
        }
        break
      }
      case "getDailySales": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as DailySalesRow[]
          if (rows[0].date !== undefined) {
            cards.push(
              <TrendCard
                key={k}
                dept="DAILY SALES"
                caption="Net sales by day"
                points={rows.map((r) => ({
                  label: r.date ?? "?",
                  value: r.net,
                  secondary: r.count,
                  secondaryLabel: "Orders",
                }))}
                valueLabel="Net sales"
                highlightedIndex={maxIndexBy(rows, (r) => r.net)}
                footerHref="/dashboard/analytics"
              />,
            )
          } else if (rows[0].platform !== undefined) {
            cards.push(
              <TableCard
                key={k}
                dept="SALES BY PLATFORM"
                caption={`${rows.length} platform${rows.length === 1 ? "" : "s"}`}
                rows={rows}
                footerHref="/dashboard/analytics"
                columns={[
                  { header: "Platform", render: (r) => r.platform ?? "—" },
                  {
                    header: "Gross",
                    align: "right",
                    render: (r) => fmtMoney(r.gross),
                  },
                  {
                    header: "Net",
                    align: "right",
                    render: (r) => fmtMoney(r.net),
                  },
                  {
                    header: "Orders",
                    align: "right",
                    render: (r) => fmtCount(r.count),
                  },
                ]}
              />,
            )
          } else if (rows[0].paymentMethod !== undefined) {
            cards.push(
              <TableCard
                key={k}
                dept="SALES BY PAYMENT"
                caption={`${rows.length} method${rows.length === 1 ? "" : "s"}`}
                rows={rows}
                footerHref="/dashboard/analytics"
                columns={[
                  {
                    header: "Method",
                    render: (r) => r.paymentMethod ?? "—",
                  },
                  {
                    header: "Gross",
                    align: "right",
                    render: (r) => fmtMoney(r.gross),
                  },
                  {
                    header: "Net",
                    align: "right",
                    render: (r) => fmtMoney(r.net),
                  },
                  {
                    header: "Orders",
                    align: "right",
                    render: (r) => fmtCount(r.count),
                  },
                ]}
              />,
            )
          }
        }
        break
      }
      case "getHourlyTrend": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as HourlyTrendRow[]
          cards.push(
            <TrendCard
              key={k}
              dept="HOURLY TREND"
              caption="Net sales by hour of day"
              points={rows.map((r) => ({
                label: `${String(r.hour).padStart(2, "0")}:00`,
                value: r.netSales,
                secondary: r.count,
                secondaryLabel: "Orders",
              }))}
              valueLabel="Net sales"
              highlightedIndex={maxIndexBy(rows, (r) => r.netSales)}
              footerHref="/dashboard/analytics"
            />,
          )
        }
        break
      }
      case "getPlatformBreakdown": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as Array<{
            platform: string
            gross: number
            net: number
            count: number
            share: number
          }>
          cards.push(
            <TableCard
              key={k}
              dept="PLATFORM SPLIT"
              caption={`${rows.length} platform${rows.length === 1 ? "" : "s"}`}
              rows={rows}
              footerHref="/dashboard/analytics"
              columns={[
                { header: "Platform", render: (r) => r.platform },
                {
                  header: "Gross",
                  align: "right",
                  render: (r) => fmtMoney(r.gross),
                },
                {
                  header: "Net",
                  align: "right",
                  render: (r) => fmtMoney(r.net),
                },
                {
                  header: "Orders",
                  align: "right",
                  render: (r) => fmtCount(r.count),
                },
                {
                  header: "Share",
                  align: "right",
                  render: (r) => fmtPct(r.share),
                },
              ]}
            />,
          )
        }
        break
      }
      case "getRefunds": {
        if (Array.isArray(out) && out.length > 0) {
          const rows = out as RefundRow[]
          if (rows[0].date !== undefined) {
            cards.push(
              <TrendCard
                key={k}
                dept="REFUNDS"
                caption="Refunds by day (3P)"
                points={rows.map((r) => ({
                  label: r.date ?? "?",
                  value: r.refunds,
                }))}
                valueLabel="Refunds"
                highlightedIndex={maxIndexBy(rows, (r) => r.refunds)}
                footerHref="/dashboard/analytics"
              />,
            )
          } else {
            cards.push(
              <TableCard
                key={k}
                dept="REFUNDS BY PLATFORM"
                caption={`${rows.length} platform${rows.length === 1 ? "" : "s"}`}
                rows={rows}
                highlightedRowIndex={rows.length > 1 ? 0 : undefined}
                footerHref="/dashboard/analytics"
                columns={[
                  { header: "Platform", render: (r) => r.platform ?? "—" },
                  {
                    header: "Refunds",
                    align: "right",
                    render: (r) => fmtMoney(r.refunds),
                  },
                ]}
              />,
            )
          }
        }
        break
      }
      case "compareSales": {
        if (out && typeof out === "object" && "periodA" in out) {
          const r = out as CompareSalesResult
          cards.push(
            <TableCard
              key={k}
              dept="PERIOD COMPARISON"
              caption={
                <>
                  <span>
                    {r.periodA.from} → {r.periodA.to}
                  </span>
                  {" vs "}
                  <span>
                    {r.periodB.from} → {r.periodB.to}
                  </span>
                </>
              }
              rows={[
                {
                  metric: "Net sales",
                  a: fmtMoney(r.periodA.net),
                  b: fmtMoney(r.periodB.net),
                  delta:
                    r.delta.netPctChange !== null
                      ? `${r.delta.net >= 0 ? "+" : ""}${fmtMoney(r.delta.net)} (${(r.delta.netPctChange * 100).toFixed(1)}%)`
                      : `${r.delta.net >= 0 ? "+" : ""}${fmtMoney(r.delta.net)}`,
                },
                {
                  metric: "Gross sales",
                  a: fmtMoney(r.periodA.gross),
                  b: fmtMoney(r.periodB.gross),
                  delta: `${r.delta.gross >= 0 ? "+" : ""}${fmtMoney(r.delta.gross)}`,
                },
                {
                  metric: "Orders",
                  a: fmtCount(r.periodA.count),
                  b: fmtCount(r.periodB.count),
                  delta: `${r.delta.count >= 0 ? "+" : ""}${fmtCount(r.delta.count)}`,
                },
              ]}
              footerHref="/dashboard/analytics"
              highlightedRowIndex={0}
              columns={[
                { header: "Metric", render: (r) => r.metric },
                { header: "A", align: "right", render: (r) => r.a },
                { header: "B", align: "right", render: (r) => r.b },
                { header: "Δ", align: "right", render: (r) => r.delta },
              ]}
            />,
          )
        }
        break
      }
    }
  }

  if (cards.length === 0) return null
  return <div className="chat-artifacts">{cards}</div>
}

/** Index of the row maximising `value`, or undefined if rows is empty or has
 *  only one row (highlighting a sole row reads as redundant noise). */
function maxIndexBy<T>(rows: T[], value: (r: T) => number): number | undefined {
  if (rows.length <= 1) return undefined
  let bestIdx = 0
  let bestVal = -Infinity
  for (let i = 0; i < rows.length; i++) {
    const v = value(rows[i])
    if (v > bestVal) {
      bestVal = v
      bestIdx = i
    }
  }
  return bestIdx
}
