import { Package, ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/format"
import { fetchProducts, type InvoiceFilters } from "./data"

export async function TopProductsSection({
  filters,
}: {
  filters: InvoiceFilters
}) {
  const products = await fetchProducts(
    filters.storeId,
    filters.startDate,
    filters.endDate
  )
  if (products.topProducts.length === 0) return null

  const maxSpend = products.topProducts[0]?.totalSpend ?? 1

  return (
    <Collapsible defaultOpen={false}>
      <div className="inv-panel inv-panel--flush">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="editorial-tr w-full cursor-pointer select-none px-5 py-4 text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-(--ink-faint)" aria-hidden />
                <div>
                  <span className="font-display text-base italic text-(--ink)">
                    Top Products
                  </span>
                  <p className="text-xs text-(--ink-muted) mt-0.5">
                    Most ordered items by total spend in this period
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="inv-stamp" data-tone="muted">
                  {products.topProducts.length} items
                </span>
                <ChevronDown className="h-4 w-4 text-(--ink-faint) transition-transform duration-200 in-data-[state=open]:rotate-180" />
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-5 pb-5">
            <div
              className="overflow-x-auto"
              style={{ borderTop: "1px solid var(--hairline-bold)" }}
            >
              <Table>
                <TableHeader>
                  <TableRow style={{ borderBottom: "1px solid var(--hairline)" }}>
                    <TableHead className="w-10" style={{ color: "var(--ink-faint)" }}>
                      #
                    </TableHead>
                    <TableHead style={{ color: "var(--ink-faint)" }}>Product</TableHead>
                    <TableHead style={{ color: "var(--ink-faint)" }}>SKU</TableHead>
                    <TableHead style={{ color: "var(--ink-faint)" }}>Category</TableHead>
                    <TableHead className="text-right" style={{ color: "var(--ink-faint)" }}>
                      Qty
                    </TableHead>
                    <TableHead className="text-right" style={{ color: "var(--ink-faint)" }}>
                      Avg price
                    </TableHead>
                    <TableHead className="text-right" style={{ color: "var(--ink-faint)" }}>
                      Total spend
                    </TableHead>
                    <TableHead className="w-30" style={{ color: "var(--ink-faint)" }}></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.topProducts.map((p, i) => {
                    const pct = (p.totalSpend / maxSpend) * 100
                    const isLeader = i === 0
                    return (
                      <TableRow
                        key={`${p.productName}-${i}`}
                        className="editorial-tr"
                        style={{ borderBottom: "1px solid var(--hairline)" }}
                      >
                        <TableCell
                          className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-[0.12em]"
                          style={{ color: "var(--ink-faint)" }}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </TableCell>
                        <TableCell
                          className="text-[13px] font-medium"
                          style={{ color: "var(--ink)", maxWidth: 250 }}
                        >
                          <span className="truncate block">{p.productName}</span>
                        </TableCell>
                        <TableCell
                          className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] tracking-[0.12em] uppercase"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {p.sku ?? "·"}
                        </TableCell>
                        <TableCell>
                          {p.category ? (
                            <span
                              className="text-[11px]"
                              style={{ color: "var(--ink-muted)" }}
                            >
                              {p.category}
                            </span>
                          ) : (
                            <span style={{ color: "var(--ink-faint)" }}>·</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right text-[13px] [font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"
                          style={{ color: "var(--ink)" }}
                        >
                          {p.totalQuantity.toFixed(0)}
                          {p.unit ? (
                            <span
                              className="text-[10px] ml-1"
                              style={{ color: "var(--ink-faint)" }}
                            >
                              {p.unit}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className="text-right text-[13px] [font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"
                          style={{ color: "var(--ink-muted)" }}
                        >
                          {formatCurrency(p.avgUnitPrice)}
                        </TableCell>
                        <TableCell
                          className="editorial-tr__total text-right text-[13px] font-semibold [font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"
                        >
                          {formatCurrency(p.totalSpend)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="h-1 overflow-hidden relative"
                            style={{ background: "var(--hairline)" }}
                          >
                            <div
                              className="absolute inset-0 origin-left"
                              style={{
                                background: isLeader
                                  ? "var(--accent)"
                                  : "var(--ink)",
                                opacity: isLeader ? 0.85 : 0.35,
                                ["--bar-scale" as string]: pct / 100,
                                transform: `scaleX(var(--bar-scale))`,
                                transition: "transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1)",
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
