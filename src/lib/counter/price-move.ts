import { prisma } from "@/lib/prisma"
import {
  COST_CANDIDATE_WINDOW,
  COST_SPIKE_THRESHOLD,
  deriveCostFromLineItem,
  selectNonSpikeCostIndex,
  type IngredientConversion,
} from "@/lib/invoice-line-shape"
import { businessQueryDate } from "@/lib/counter/business-date"
import { median } from "@/lib/counter/median"

/**
 * THE ONE FUNCTION THAT OWNS "HOW FAR HAS THIS INGREDIENT'S PRICE MOVED".
 *
 * Five pages printed a price move and no two computed it the same way:
 *
 *   | page                        | compared                                          |
 *   |-----------------------------|---------------------------------------------------|
 *   | Ingredients "30d move"      | weekly median of RAW `unitPrice`, now vs 30d ago  |
 *   | Ingredient detail           | first vs last of 8 weekly raw medians             |
 *   | COGS "What moved"           | two single normalised readings 30 days apart,     |
 *   |                             | no spike guard                                    |
 *   | Prices / Invoices → Prices  | latest normalised vs trailing 120-day median      |
 *
 * The same ingredient could read ▲ 12% on one, ▼ 4% on another and +1,005% on
 * a third. They now all read this module, and the definition is the Prices
 * page's, because its docblock is the one that was measured against the data:
 *
 *   - **Price is normalised per recipe unit** (`deriveCostFromLineItem`, the
 *     same derivation booked costs use, with the same per-ingredient
 *     conversion). Raw `unitPrice` is per CASE on one line and per POUND on
 *     the next; a median of those is a median of pack sizes.
 *   - **"Latest" is spike-guarded the way booked costs are.** The newest
 *     `COST_CANDIDATE_WINDOW` readings go through `selectNonSpikeCostIndex`
 *     — the guard `ingredient-cost.ts` and `canonical-cost-batch.ts` run
 *     before they book a cost — so the latest price a move is measured FROM
 *     is the one recipes are costed at, not a pack mis-parse the cost layer
 *     already threw away. What it set aside is returned (`setAside`) so a page
 *     can say so.
 *   - **The baseline is the trailing median** of every priced reading older
 *     than that latest one, inside `HISTORY_DAYS` (120). Not window against
 *     window: the fry price steps between two levels on one pack, and a
 *     30-days-against-30-days reading taken mid-step reports +67% at a moment
 *     the price has already come back down. A median of the ingredient's own
 *     history is what "dearer than usual" means.
 *   - **Held**, when even the guarded latest sits more than
 *     `COST_SPIKE_THRESHOLD`× from the baseline. That is a pack read wrong,
 *     not a price; consumers leave it out of their move rather than print it.
 *
 * ## The money: Δ per recipe unit × recipe units bought
 *
 * `impact30` is `(latest − baseline) × volume30`, and both factors are per
 * RECIPE unit. The Prices page used to multiply a per-recipe-unit Δ by a
 * volume summed from `getLineItemBaseQty` — the invoice's BASE unit — so an
 * ingredient costed per ounce and billed by the pound reported its impact
 * 16× too small (and one costed per pound, billed in ounces, 16× too large).
 * The volume here is each line's money divided by its own per-recipe-unit
 * cost, `|extendedPrice| / cost`, which is exactly the line's quantity in
 * recipe units under the same conversion that produced the cost — including a
 * per-ingredient conversion no dimensional table knows. Credit lines count
 * against it (their quantity carries its natural negative sign).
 *
 * ## Windows
 *
 * Every window is anchored on the business day of `asOf` and none follows a
 * page's date control: a price moves on invoice cadence, and a one-day range
 * has no history to compare against. `HISTORY_DAYS` of readings,
 * `VOLUME_DAYS` of volume.
 *
 * ## Tenancy and scope
 *
 * Every query filters on `accountId` (the boundary, `auth-scope.ts`). A
 * store-scoped page passes `storeIds`; omitted, every invoice on the account
 * counts — including ones the sync could not attribute to a store.
 */

/** How far back a price history is read. */
export const HISTORY_DAYS = 120
/** The window the volume — and so the money — is taken over. */
export const VOLUME_DAYS = 30
/** Priced readings an ingredient needs: one latest, and two to take a median of. */
export const MIN_READINGS = 3

const DAY_MS = 86_400_000

export interface PricedReading {
  at: Date
  /** Normalised cost per recipe unit. */
  cost: number
  /** Recipe units on the line, signed (a credit is negative). */
  qty: number
  /** SKU, or product name when the line has none. */
  key: string
  /** packSize × unitSize — more than one per SKU is a pack-shape change. */
  shape: number
}

export interface PriceMoveFigures {
  /** The spike-guarded latest cost per recipe unit. */
  latest: number
  latestAt: Date
  /** Readings newer than `latest` the guard set aside, newest first. */
  setAside: PricedReading[]
  /** Median of every priced reading older than `latest`. */
  baseline: number
  /** (latest − baseline) / baseline — a FRACTION, 0.12 for 12%. */
  move: number
  /** Recipe units bought in the last `VOLUME_DAYS`. */
  volume30: number
  /** (latest − baseline) × volume30, in dollars. */
  impact30: number
  /** True when even the guarded latest is beyond the spike threshold. */
  held: boolean
  /** Priced readings in the history window. */
  readings: PricedReading[]
  /** One SKU billed under more than one pack shape. */
  packVaries: boolean
}

export interface PriceMove extends PriceMoveFigures {
  id: string
  name: string
  recipeUnit: string
  /** How many recipe lines reference this ingredient. */
  recipes: number
}

export interface PriceMoveSet {
  moves: Map<string, PriceMove>
  /** Ingredients with invoice lines in the window that could not be priced at all. */
  unpriceable: number
  /** Every canonical ingredient considered. */
  totalCanonicals: number
}

export interface PriceMoveInput {
  accountId: string
  /** A store-scoped page passes its stores; omitted means every invoice on the account. */
  storeIds?: string[] | null
  asOf: Date
  /** Restrict to these ingredients — the detail page asks for one. */
  ingredientIds?: string[]
}

/**
 * The move, from readings already priced — pure, so every caller and every
 * test reads the same arithmetic. `readings` oldest first.
 *
 * Null when there are fewer than `MIN_READINGS`, or the baseline would come
 * from fewer than two.
 */
export function priceMoveOf(
  readings: PricedReading[],
  volumeSince: Date,
): PriceMoveFigures | null {
  const valid = readings
    .filter((r) => Number.isFinite(r.cost) && r.cost > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  // Credits and returns net out of volume but never set the price: a credit
  // line can be the newest reading and is not a delivery at that price.
  const priced = valid.filter((r) => r.qty > 0)
  if (priced.length < MIN_READINGS) return null

  // The booked-cost guard, over the same window booked costs judge.
  const newestFirst = [...priced].reverse().slice(0, COST_CANDIDATE_WINDOW)
  const { index } = selectNonSpikeCostIndex(newestFirst.map((r) => r.cost))
  const chosen = newestFirst[index]
  const setAside = newestFirst.slice(0, index)
  const chosenAt = priced.length - 1 - index

  const older = priced.slice(0, chosenAt)
  if (older.length < MIN_READINGS - 1) return null
  const baseline = median(older.map((r) => r.cost))
  if (baseline === null || baseline <= 0) return null

  // Every unit bought in the window, set-aside readings included (the guard
  // decides the price, not what arrived), net of credits and never below 0.
  const volume30 = Math.max(
    0,
    valid
      .filter((r) => r.at.getTime() >= volumeSince.getTime())
      .reduce((t, r) => t + r.qty, 0),
  )

  const shapes = new Map<string, Set<number>>()
  for (const r of priced) {
    const set = shapes.get(r.key) ?? new Set<number>()
    set.add(r.shape)
    shapes.set(r.key, set)
  }

  const latest = chosen.cost
  return {
    latest,
    latestAt: chosen.at,
    setAside,
    baseline,
    move: (latest - baseline) / baseline,
    volume30,
    impact30: (latest - baseline) * volume30,
    held:
      latest > baseline * COST_SPIKE_THRESHOLD || latest < baseline / COST_SPIKE_THRESHOLD,
    readings: priced,
    packVaries: [...shapes.values()].some((s) => s.size > 1),
  }
}

/** The line fields `pricedReadingOf` reads. */
export interface PriceLine {
  sku: string | null
  productName: string
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  unitPrice: number
  extendedPrice: number
  invoice: { invoiceDate: Date | null }
}

/**
 * One invoice line as a reading: cost per recipe unit and recipe units on the
 * line, or null when it cannot be priced or has no date to sit on a series.
 */
export function pricedReadingOf(
  line: PriceLine,
  recipeUnit: string,
  conversion?: IngredientConversion,
): PricedReading | null {
  const at = line.invoice.invoiceDate
  if (at === null) return null
  const cost = deriveCostFromLineItem(line, recipeUnit, conversion)
  if (cost === null || !(cost > 0)) return null
  return {
    at,
    cost,
    // |money| ÷ cost per recipe unit = recipe units, under the conversion
    // that produced the cost. Signed by the line's own quantity.
    qty: (Math.sign(line.quantity) * Math.abs(line.extendedPrice)) / cost,
    key: line.sku ?? line.productName.toLowerCase(),
    shape: (line.packSize ?? 1) * (line.unitSize ?? 1),
  }
}

/** The windows, from `asOf`'s business day in `@db.Date` encoding. */
export function priceMoveWindows(asOf: Date): { day: Date; since: Date; volumeSince: Date } {
  const day = businessQueryDate(asOf)
  return {
    day,
    since: new Date(day.getTime() - HISTORY_DAYS * DAY_MS),
    volumeSince: new Date(day.getTime() - VOLUME_DAYS * DAY_MS),
  }
}

/** Every canonical ingredient's move, for one account (and optionally some stores). */
export async function loadPriceMoves(input: PriceMoveInput): Promise<PriceMoveSet> {
  const { accountId, storeIds, ingredientIds } = input
  const { day, since, volumeSince } = priceMoveWindows(input.asOf)

  const [canonicals, lines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId, ...(ingredientIds ? { id: { in: ingredientIds } } : {}) },
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        _count: { select: { recipeIngredients: true } },
        // The conversion booked costs apply (`recomputeCanonicalCost` and
        // `batchCanonicalCosts` both take the first match).
        skuMatches: {
          take: 1,
          select: { conversionFactor: true, fromUnit: true, toUnit: true },
        },
      },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: ingredientIds ? { in: ingredientIds } : { not: null },
        quantity: { not: 0 },
        // The account boundary reaches a line through its invoice.
        invoice: {
          accountId,
          invoiceDate: { gte: since, lte: day },
          ...(storeIds ? { storeId: { in: storeIds } } : {}),
        },
      },
      orderBy: { invoice: { invoiceDate: "asc" } },
      select: {
        canonicalIngredientId: true,
        sku: true,
        productName: true,
        quantity: true,
        unit: true,
        packSize: true,
        unitSize: true,
        unitSizeUom: true,
        unitPrice: true,
        extendedPrice: true,
        invoice: { select: { invoiceDate: true } },
      },
    }),
  ])

  const byCanonical = new Map<string, typeof lines>()
  for (const line of lines) {
    const id = line.canonicalIngredientId
    if (id === null) continue
    const bucket = byCanonical.get(id) ?? []
    bucket.push(line)
    byCanonical.set(id, bucket)
  }

  const moves = new Map<string, PriceMove>()
  let unpriceable = 0
  for (const c of canonicals) {
    const bucket = byCanonical.get(c.id)
    if (!bucket) continue
    if (!c.recipeUnit) {
      unpriceable++
      continue
    }
    const match = c.skuMatches?.[0]
    const conversion = match
      ? { conversionFactor: match.conversionFactor, fromUnit: match.fromUnit, toUnit: match.toUnit }
      : undefined
    const readings = bucket
      .map((l) => pricedReadingOf(l, c.recipeUnit!, conversion))
      .filter((r): r is PricedReading => r !== null)
    if (readings.length === 0) {
      unpriceable++
      continue
    }
    const figures = priceMoveOf(readings, volumeSince)
    if (figures === null) continue
    moves.set(c.id, {
      id: c.id,
      name: c.name,
      recipeUnit: c.recipeUnit,
      recipes: c._count.recipeIngredients,
      ...figures,
    })
  }

  return { moves, unpriceable, totalCanonicals: canonicals.length }
}

/** The move as a percent, or null when there is none to print (absent or held). */
export function movePctOf(m: PriceMove | PriceMoveFigures | undefined | null): number | null {
  return m && !m.held ? m.move * 100 : null
}
