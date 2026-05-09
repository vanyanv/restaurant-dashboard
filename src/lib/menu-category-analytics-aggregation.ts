import type {
  MenuCategoryRow,
  MenuCategoryWithItems,
  MenuItemRow,
} from "@/types/analytics"

export type CategoryAggregateRow = {
  category: string
  fpQuantitySold: number | bigint
  fpTotalInclModifiers: number | bigint
  fpTotalSales: number | bigint
  tpQuantitySold: number | bigint
  tpTotalInclModifiers: number | bigint
  tpTotalSales: number | bigint
}

export type ItemAggregateRow = CategoryAggregateRow & {
  itemName: string
}

export type ShapedMenuCategoryAnalytics = {
  categories: MenuCategoryWithItems[]
  totals: {
    fpQuantitySold: number
    fpTotalSales: number
    tpQuantitySold: number
    tpTotalSales: number
    totalQuantitySold: number
    totalSales: number
  }
}

function toCategoryRow(r: CategoryAggregateRow): MenuCategoryRow {
  const fpQuantitySold = Number(r.fpQuantitySold)
  const fpTotalInclModifiers = Number(r.fpTotalInclModifiers)
  const fpTotalSales = Number(r.fpTotalSales)
  const tpQuantitySold = Number(r.tpQuantitySold)
  const tpTotalInclModifiers = Number(r.tpTotalInclModifiers)
  const tpTotalSales = Number(r.tpTotalSales)
  return {
    category: r.category,
    fpQuantitySold,
    fpTotalInclModifiers,
    fpTotalSales,
    tpQuantitySold,
    tpTotalInclModifiers,
    tpTotalSales,
    totalQuantitySold: fpQuantitySold + tpQuantitySold,
    totalSales: fpTotalSales + tpTotalSales,
  }
}

function toItemRow(r: ItemAggregateRow): MenuItemRow {
  const base = toCategoryRow(r)
  const { category: _omit, ...rest } = base
  return { ...rest, itemName: r.itemName, category: r.category }
}

export function shapeMenuCategoryAnalytics(
  categoryRows: CategoryAggregateRow[],
  itemRows: ItemAggregateRow[]
): ShapedMenuCategoryAnalytics {
  const categories = categoryRows.map(toCategoryRow)

  const itemsByCategory = new Map<string, MenuItemRow[]>()
  for (const row of itemRows) {
    const shaped = toItemRow(row)
    const list = itemsByCategory.get(shaped.category)
    if (list) {
      list.push(shaped)
    } else {
      itemsByCategory.set(shaped.category, [shaped])
    }
  }

  const nested: MenuCategoryWithItems[] = categories.map((c) => {
    const items = (itemsByCategory.get(c.category) ?? []).slice().sort(
      (a, b) => b.totalQuantitySold - a.totalQuantitySold
    )
    return { ...c, items }
  })

  nested.sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)

  const totals = nested.reduce(
    (acc, c) => {
      acc.fpQuantitySold += c.fpQuantitySold
      acc.fpTotalSales += c.fpTotalSales
      acc.tpQuantitySold += c.tpQuantitySold
      acc.tpTotalSales += c.tpTotalSales
      acc.totalQuantitySold += c.totalQuantitySold
      acc.totalSales += c.totalSales
      return acc
    },
    {
      fpQuantitySold: 0,
      fpTotalSales: 0,
      tpQuantitySold: 0,
      tpTotalSales: 0,
      totalQuantitySold: 0,
      totalSales: 0,
    }
  )

  return { categories: nested, totals }
}
