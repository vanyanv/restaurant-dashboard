import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { cached, stableKey } from "@/lib/cache/cached"
import { otterRangeTags, rangeTtl } from "@/lib/cache/range"
import {
  COMMISSION_FREE_PLATFORMS,
  observedRates,
  type FulfillmentKind,
  type ObservedRate,
  type OrderFeeGroup,
} from "@/lib/counter/commission-core"

export * from "@/lib/counter/commission-core"

/**
 * The query half of the one commission function. The rules are in
 * `./commission-core.ts`; read that first.
 *
 * ONE grouped `OtterOrder` read per (account, stores, range), cached like the
 * statement it feeds: per store, LA day, platform, fulfilment mode and
 * whether a fee was recorded. Cancelled and in-house orders are left out in
 * SQL. Every caller — the P&L rollup, the channel mix, the menu-item fee —
 * folds these rows with `commission-core`, so no two pages can price a
 * marketplace's cut differently.
 *
 * `accountId` is the tenancy boundary: the query joins `"Store"` and filters
 * on it, so a store id from another account returns nothing even if a caller
 * passes one.
 */

interface RawGroup {
  storeId: string
  day: string
  platform: string
  mode: FulfillmentKind
  recorded: boolean
  orders: number
  fee: number
  ticket: number
}

const DAY_MS = 86_400_000

function utcDayFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export interface CommissionQuery {
  accountId: string
  storeIds: string[]
  /** Inclusive; floored to its UTC (= LA calendar) day. */
  startDate: Date
  /** Inclusive; the whole of its UTC (= LA calendar) day is read. */
  endDate: Date
}

/** Anything with `$queryRaw` — the app's client, or a chat tool's own `ctx.prisma`. */
type RawClient = Pick<typeof prisma, "$queryRaw">

export function loadOrderFeeGroups(
  input: CommissionQuery,
  db: RawClient = prisma,
): Promise<OrderFeeGroup[]> {
  const { accountId, storeIds } = input
  if (storeIds.length === 0) return Promise.resolve([])
  const from = utcDayFloor(input.startDate)
  const toExclusive = new Date(utcDayFloor(input.endDate).getTime() + DAY_MS)
  return cached(
    `counter:commission:${stableKey({
      a: accountId,
      ids: [...storeIds].sort(),
      from,
      to: toExclusive,
    })}`,
    rangeTtl(input.endDate),
    otterRangeTags(from, input.endDate),
    () => queryGroups(db, accountId, storeIds, from, toExclusive),
  )
}

async function queryGroups(
  db: RawClient,
  accountId: string,
  storeIds: string[],
  from: Date,
  toExclusive: Date,
): Promise<OrderFeeGroup[]> {
  const rows = await db.$queryRaw<RawGroup[]>(Prisma.sql`
    SELECT
      o."storeId",
      to_char(o."referenceTimeLocal", 'YYYY-MM-DD') AS "day",
      o."platform",
      CASE WHEN o."fulfillmentMode" = 'FULFILLMENT_MODE_PICKUP' THEN 'pickup' ELSE 'delivery' END AS "mode",
      (o."commission" <> 0) AS "recorded",
      COUNT(*)::integer AS "orders",
      SUM(GREATEST(0, -o."commission"))::double precision AS "fee",
      SUM(GREATEST(0, o."subtotal" + o."discount"))::double precision AS "ticket"
    FROM "OtterOrder" o
    JOIN "Store" s ON s."id" = o."storeId"
    WHERE s."accountId" = ${accountId}
      AND o."storeId" IN (${Prisma.join(storeIds)})
      AND o."referenceTimeLocal" >= ${from}
      AND o."referenceTimeLocal" < ${toExclusive}
      AND o."platform" NOT IN (${Prisma.join([...COMMISSION_FREE_PLATFORMS])})
      AND (o."orderStatus" IS NULL OR o."orderStatus" <> 'OFO_STATUS_CANCELED')
    GROUP BY 1, 2, 3, 4, 5
  `)
  return rows.map((r) => ({
    storeId: r.storeId,
    day: r.day,
    platform: r.platform,
    mode: r.mode === "pickup" ? "pickup" : "delivery",
    recorded: Boolean(r.recorded),
    orders: Number(r.orders) || 0,
    fee: Number(r.fee) || 0,
    ticket: Number(r.ticket) || 0,
  }))
}

/** How far back the store file reads what the orders actually show. */
export const OBSERVED_RATE_DAYS = 90

/**
 * What this store's RECORDED orders show each platform charging, over the
 * trailing 90 days to `asOf`. Read-only: the store file prints it beside the
 * editable rate so the owner can see drift. It is never used to price
 * anything — the store's own setting does that.
 */
export async function loadObservedRates(input: {
  accountId: string
  storeId: string
  asOf: Date
}): Promise<ObservedRate[]> {
  const end = utcDayFloor(input.asOf)
  const start = new Date(end.getTime() - (OBSERVED_RATE_DAYS - 1) * DAY_MS)
  const groups = await loadOrderFeeGroups({
    accountId: input.accountId,
    storeIds: [input.storeId],
    startDate: start,
    endDate: end,
  })
  return observedRates(groups)
}
