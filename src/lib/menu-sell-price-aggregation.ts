export type PrimarySellPriceRow = {
  itemName: string
  totalQty: number | bigint
  totalSales: number | bigint
}

export type FallbackSellPriceRow = {
  name: string
  price: number
  quantity: number
}

export type SellPriceEntry = { avgPrice: number; qtySold: number }

export function mergeSellPrices(
  primary: PrimarySellPriceRow[],
  fallback: FallbackSellPriceRow[]
): Map<string, SellPriceEntry> {
  const out = new Map<string, SellPriceEntry>()

  for (const row of primary) {
    const qty = Number(row.totalQty)
    const sales = Number(row.totalSales)
    if (qty <= 0 || sales <= 0) continue
    out.set(row.itemName.toLowerCase(), { avgPrice: sales / qty, qtySold: qty })
  }

  for (const row of fallback) {
    const key = row.name.toLowerCase()
    if (out.has(key)) continue
    const unit = row.quantity > 0 ? row.price / row.quantity : row.price
    out.set(key, { avgPrice: unit, qtySold: Math.round(row.quantity) })
  }

  return out
}
