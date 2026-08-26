/**
 * Per-line "what did the channel take, what did it cost us" for one order.
 *
 * Deliberately a pure function with no Prisma access: the caller (a page
 * adapter, built in a later task) resolves `recipeBySku` from
 * `OtterItemMapping` / `OtterSubItemMapping` and `costByRecipe` from
 * `batchRecipeCosts`, then hands both in as plain maps. That split is what
 * makes this testable without mocking the database, and it means a change to
 * how mappings or recipe costs are queried never has to touch this file.
 */

export interface LineCostInput {
  /** `OtterOrderItem` and `OtterOrderSubItem` flattened, in render order. */
  lines: Array<{
    key: string
    name: string
    /** A sub-item — the prototype's `l.mod`. */
    modifier: boolean
    skuId: string
    quantity: number
    /** What the channel charged for this line. */
    price: number
  }>
  /** skuId -> recipeId, from OtterItemMapping / OtterSubItemMapping. */
  recipeBySku: Map<string, string>
  /** recipeId -> { totalCost, partial }, from batchRecipeCosts. */
  costByRecipe: Map<string, { totalCost: number; partial: boolean }>
  /** The order's commission as a fraction of its ticket. */
  commissionRate: number
}

export interface LineCost {
  key: string
  name: string
  modifier: boolean
  quantity: number
  price: number
  /** price × (1 − commissionRate) — the prototype's `l.keep`. */
  keep: number
  /** null when this line has no recipe behind it, or its recipe does not fully price. */
  cost: number | null
  /** Why there is no cost, for the queue item. */
  uncostedReason: "unmapped" | "partial" | null
}

export function resolveLineCosts(input: LineCostInput): LineCost[] {
  const { lines, recipeBySku, costByRecipe, commissionRate } = input

  return lines.map((line) => {
    const keep = line.price * (1 - commissionRate)

    const recipeId = recipeBySku.get(line.skuId)
    if (!recipeId) {
      return {
        key: line.key,
        name: line.name,
        modifier: line.modifier,
        quantity: line.quantity,
        price: line.price,
        keep,
        cost: null,
        uncostedReason: "unmapped",
      }
    }

    const recipeCost = costByRecipe.get(recipeId)
    // No entry for a mapped recipe is the same failure mode as "partial":
    // batchRecipeCosts didn't produce a full price for it.
    if (!recipeCost || recipeCost.partial) {
      return {
        key: line.key,
        name: line.name,
        modifier: line.modifier,
        quantity: line.quantity,
        price: line.price,
        keep,
        cost: null,
        uncostedReason: "partial",
      }
    }

    return {
      key: line.key,
      name: line.name,
      modifier: line.modifier,
      quantity: line.quantity,
      price: line.price,
      keep,
      cost: recipeCost.totalCost * line.quantity,
      uncostedReason: null,
    }
  })
}
