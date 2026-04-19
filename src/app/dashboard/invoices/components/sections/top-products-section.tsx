import { Package, ChevronDown } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { fetchProducts } from "./data"

export async function TopProductsSection({
  storeId,
}: {
  storeId?: string
}) {
  const products = await fetchProducts(storeId)
  if (products.topProducts.length === 0) return null

  const maxSpend = products.topProducts[0]?.totalSpend ?? 1

  return (
    <Collapsible defaultOpen={false}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Top Products</CardTitle>
                  <CardDescription>
                    Most ordered items by total spend (last 90 days)
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {products.topProducts.length} items
                </Badge>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 in-data-[state=open]:rotate-180" />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Avg Price</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.topProducts.map((p, i) => {
                    const pct = (p.totalSpend / maxSpend) * 100
                    return (
                      <TableRow key={`${p.productName}-${i}`}>
                        <TableCell className="font-mono text-muted-foreground text-xs">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium max-w-[250px]">
                          <span className="truncate block">
                            {p.productName}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.sku ?? "—"}
                        </TableCell>
                        <TableCell>
                          {p.category ? (
                            <Badge
                              variant="outline"
                              className="text-xs font-normal"
                            >
                              {p.category}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.totalQuantity.toFixed(0)}
                          {p.unit ? (
                            <span className="text-muted-foreground text-xs ml-1">
                              {p.unit}
                            </span>
                          ) : (
                            ""
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(p.avgUnitPrice)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(p.totalSpend)}
                        </TableCell>
                        <TableCell>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/25 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
