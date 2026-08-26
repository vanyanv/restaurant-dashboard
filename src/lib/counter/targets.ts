import { prisma } from "@/lib/prisma"

/**
 * What the six figures in Overview's headline strip are judged against — and,
 * for five of them, the fact that nothing judges them.
 *
 * THE PROTOTYPE HARDCODES ALL SIX. `docs/counter/counter-prototype.html` has
 * `FOOD_PLAN = 29.0` (line 3395), `PRIME_PLAN = 60.0` (3414), an avg-ticket
 * band of $25.10–$26.40 (4264), an orders band of ±0.92/1.05 of whatever the
 * range happened to produce (4260), a labour band of 23.9–26.2% plus salaried
 * (4272), and a marketplace-fee band of $560–$690 (4287). Those are a design
 * fiction's furniture. Copying them here would put six bullet meters on a real
 * restaurant's dashboard, five of them judging real money against a number
 * invented for a mockup — and a meter is not decoration, it is the page
 * asserting that somebody set this benchmark and this figure is inside or
 * outside it.
 *
 * `Store.targetCogsPct` is the ONLY published reference in the schema. The
 * other five have no column, no settings screen and no owner who set them, so
 * they are `null` and `Figure` renders them bare: the figure, no bullet, no
 * band. Five bare figures is the true state of this data. The schema gap is a
 * real gap and worth closing — with a migration and a place for the owner to
 * enter the numbers, which is a separate piece of work, not something a
 * constant in this file can stand in for.
 *
 * ONE EXCEPTION WORTH KNOWING ABOUT, and it is deliberately NOT resolved here:
 * `src/lib/counter/prime-cost.ts` exports `PRIME_CEILING_PCT = 60` and
 * `primeCost()` already returns it as `ceilingPct`, with `roomPp` and
 * `overCeiling` derived from it — Plan 8's ruling R3, on the grounds that 60%
 * is the trade's benchmark rather than a per-store setting. That ceiling
 * belongs to `primeCost()`, which is the one function that owns prime cost
 * (note 60). It is not restated here, because a figure judged against a
 * threshold must get that threshold from one place, and for prime cost that
 * place already exists. `prime` below is `null` meaning "this module publishes
 * no reference for prime", NOT "prime has no ceiling" — a caller rendering the
 * prime cell takes its ceiling from `primeCost()`.
 */

/** A figure's published reference — the thing a bullet meter judges it against. */
export type Target =
  | { kind: "target"; value: number; better: "low" | "high" }
  | { kind: "band"; lo: number; hi: number; better: "low" | "high" }
  | null

export interface StripTargets {
  /** No column, no benchmark. The prototype's band was ±8%/+5% of its own figure. */
  orders: Target
  /** No column. The prototype's $25.10–$26.40 is a made-up band. */
  ticket: Target
  /** `Store.targetCogsPct`, the one published reference in the schema. */
  foodCost: Target
  /** No column. `Store.fixedMonthlyLabor` is a budget in dollars, not a percent of sales. */
  labor: Target
  /** See the module note: prime's ceiling lives in `prime-cost.ts`, not here. */
  prime: Target
  /** No column. Nothing in the schema says what fees SHOULD be. */
  marketplaceFees: Target
}

/**
 * The account-wide food-cost plan, when there is one to have.
 *
 * A single store answers for itself. Across stores there is only a published
 * plan if the stores that have one AGREE: two stores on 28% and 31% have two
 * plans, and a meter drawn against their average (or against a
 * sales-weighted blend, which is what `src/lib/chat/tools/pnl.ts` computes for
 * a different purpose) would be judging the account against a number no
 * operator ever set. That is the same fabrication as the prototype's
 * constants, arrived at by arithmetic instead of by typing.
 */
function agreedTarget(values: Array<number | null>): number | null {
  const set = new Set(values.filter((v): v is number => v != null))
  return set.size === 1 ? [...set][0] : null
}

/**
 * @param storeId  null = every active store on the account.
 * @param accountId  Which account. Not optional: without it, `storeId: null`
 *   reads every store row in the database, and a stranger's food-cost plan is
 *   not this reader's. Same reason and same shape as
 *   `src/lib/counter/adapters/overview.ts` and `loadChannelMix` — this module
 *   must not fetch its own session, because importing `@/lib/auth` pulls
 *   `@/lib/prisma` in at module load and takes every importer down without a
 *   `DATABASE_URL`.
 */
export async function loadStripTargets(
  storeId: string | null,
  accountId: string,
): Promise<StripTargets> {
  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { targetCogsPct: true },
  })

  const foodPlan = agreedTarget(stores.map((s) => s.targetCogsPct))

  return {
    orders: null,
    ticket: null,
    // A percent, matching the column's own units (28.5 means 28.5%) and what
    // the food-cost figure beside it is printed in. Lower is better.
    foodCost:
      foodPlan == null ? null : { kind: "target", value: foodPlan, better: "low" },
    labor: null,
    prime: null,
    marketplaceFees: null,
  }
}
