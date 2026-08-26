import { getOrderDetail, getOrdersList, type OrderDetail, type OrderListResponse } from "@/app/actions/order-actions"
import { getHourlyPatternsForRange } from "@/app/actions/hourly-orders-actions"
import { batchRecipeCosts } from "@/lib/recipe-cost-batch"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import type { HourlyOrderPoint, OrderPatternsHourlyComparison } from "@/types/analytics"
import { resolveLineCosts, type LineCost } from "@/lib/counter/order-costs"
import { CHANNEL_FOR_PLATFORM } from "@/lib/counter/channel-mix"
import { channelById, markVarFor, type Channel, type ChannelId } from "@/lib/counter/channels"
import { count, money, pct } from "@/lib/counter/format"
import {
  comparisonContext,
  comparisonPhrase,
  type ComparisonContext,
} from "@/lib/counter/comparison"
import {
  comparisonRange,
  dayCount,
  isoDay,
  type ComparisonId,
  type DateRange,
} from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { classify } from "@/lib/counter/adapters/types"
import {
  dataOf,
  empty,
  mapReady,
  mapReadyTo,
  ready,
  type SectionData,
} from "@/lib/counter/section-data"
import type { StripCell } from "@/lib/counter/adapters/pnl"
import type { FilterToggle, KvRow, MathRow, QueueItem } from "@/components/counter"

/**
 * The Orders pages' data, classified — the LIST and ONE ORDER, in one file.
 *
 * They are one adapter because they are one subject seen at two zoom levels,
 * and every figure the detail page prints has to be the same figure the row
 * above it printed. A reader who presses a row whose Net column says $23.14
 * and lands on a page whose "You keep" says $24.02 has learned that neither
 * number can be trusted; that is note 60 at the grain of a single order.
 * `ticketOf`, `feeFigure` and `orderMoney` are what stop the two surfaces from
 * answering the same question twice.
 *
 * ## The four rules the tests pin, and why each exists
 *
 * 1. **The items table's total row is the sum of the rows drawn above it.**
 *    `buildOrderItems` is not given a route to `OtterOrder.total` for that
 *    figure — the column carries tax and can simply disagree with the lines,
 *    and a total that disagrees with its own column is the defect the whole
 *    cascade discipline exists to prevent. `tests/lib/counter/adapters/
 *    orders.test.ts` feeds it an order whose column is a cent out.
 * 2. **No margin is printed when `keep` is zero.** `(keep − cost) / keep` on a
 *    comped line divides by zero. `Infinity%` on a table cell is a figure a
 *    reader would act on; an em dash is the truth.
 * 3. **Tax is stated, never subtracted.** It appears only in `OrderKeep.note`.
 *    The prototype's own comment at line 6600 records this bug being repaired
 *    once already: tax was drawn as a `<span class="op">` subtraction and then
 *    not applied, so the net underneath it was the ticket less commission
 *    alone. `MathLines` refuses to render an unapplied row for the same
 *    reason, so the rule is enforced twice.
 * 4. **`needsYou` is EMPTY when every line is costed.** Not a queue of length
 *    zero — `Section` renders an empty section as an empty section, and a
 *    "Needs you" heading over nothing is a page telling a reader to look.
 *
 * ## Ruling O-R1 — the fifth strip cell keeps its slot and gets an honest name
 *
 * The prototype's fifth cell is "Unsynced to POS": orders the POS never
 * matched. This schema tracks a different thing under the same shape —
 * `detailsFetchedAt IS NULL`, orders whose line detail we have not drained
 * from Otter (`OrderListResponse.undrainedCount`). The figure is real, it
 * answers the same reader's question ("is anything missing?"), and it is zero
 * on a healthy day exactly as the prototype's is. It ships in that slot as
 * **"Details not drained"**. Dropping it would leave a four-cell strip and a
 * landmark absence for data we do have.
 *
 * ## Ruling O-R2 — no strip cell on either page carries a `reference`
 *
 * Nothing in this schema publishes a per-order target, a fee ceiling or a
 * ticket floor. Following the Overview's own precedent (Scan-R1), every figure
 * here ships bare: no bullet, no band, no sparkline. A `reference` built from
 * a constant in this file would judge the owner's business against a number
 * nobody set.
 *
 * ## The nullable `skuId`, which is this file's one real wiring problem
 *
 * `OtterItemMapping.skuId` is NULLABLE — the schema's own comment says
 * "Legacy rows may leave this null", and the table's uniqueness is on
 * `(storeId, otterItemName)`, not on the sku. So an item line's recipe is
 * found by sku when the mapping has one and by NAME when it does not.
 * `OtterSubItemMapping.skuId` is non-null and is its own `@@unique` key, so a
 * modifier needs no fallback. `buildRecipeBySku` is where that decision lives,
 * it is pure, and it is tested — because the failure mode is silent: a legacy
 * mapping missed reads as "this item has no recipe", which understates food
 * cost and OVERSTATES the contribution on every order carrying it.
 */

/* ── The shapes the pages' primitives render ──────────────────────────── */

/**
 * One strip cell. Deliberately the P&L's alias rather than a second
 * declaration: three adapters now hand `Figure` its props, and a second
 * `type StripCell = FigureProps` is a second thing to keep in step.
 */
export type { StripCell }

/** One row of the orders table — `ORDERS.map(...)` at prototype line 4844. */
export interface OrdersRow {
  key: string
  /** A route this app serves. */
  href: string
  /** `#4821` — the platform's own display id, falling back to Otter's. */
  id: string
  /** `9:32pm`, on the STORE's clock. See `clockTime`. */
  time: string
  /** `tint` is the chip's `--pc`, i.e. the full `var(--ch-dd)` the prototype writes. */
  channel: { label: string; tint: string }
  items: string
  /**
   * `subtotal − discount`, which is what `OrderListTotals.netSales` sums.
   *
   * The column is headed "Ticket" and the strip cell above it is headed "Net
   * sales" — the prototype's own two names for the same arithmetic. They are
   * the same number: Σ of this column over the matched range IS that cell.
   */
  ticket: string
  /** An em dash when the channel took nothing — never `$0.00`. */
  fees: string
  /** `ticket − commission`. What this order left behind before food. */
  net: string
}

export interface OrdersList {
  toggles: FilterToggle[]
  search: string
  /** The prototype's `8 of 187` — shown of matched. */
  count: string
  rows: OrdersRow[]
  /** `OrderListResponse.nextCursor`, so a page can ask for the next screenful. */
  nextCursor: string | null
}

/**
 * `sec('Orders by hour', …)` at prototype line 4870.
 *
 * A wrapper rather than the bare `ChartSpec` the brief names, because the
 * section's META is derived from the data too — the prototype's `band = the
 * last four ` + `CD.dowName()` + `s` — and `ChartSpec` has nowhere to carry it
 * but `bandLabel`, which belongs to a band. A page composing that string would
 * be a page deciding which weekday the baseline is made of.
 */
export interface OrdersByHour {
  meta: string
  chart: ChartSpec
}

export interface OrdersSectionsInput {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  /**
   * A raw Otter platform slug, or `null` for every channel.
   *
   * ONE slug, not a set, because `getOrdersList` filters on one — see
   * `buildToggles` for why the toggles are per slug rather than per channel.
   */
  platform?: string | null
  search?: string
  /** `"none"` prints no change on the strip rather than a row of em-dashes it calls a comparison. */
  comparisonId?: ComparisonId
  limit?: number
  cursor?: string | null
}

export interface OrdersSections {
  /** `strip([...])` line 4854. Five cells, none of them judged — ruling O-R2. */
  strip: SectionData<StripCell[]>
  /** The filter bar and the table, one section: the count is the table's own. */
  list: SectionData<OrdersList>
  /** `sec('Orders by hour', …)` line 4870. */
  byHour: SectionData<OrdersByHour>
}

/**
 * One `OtterOrderItem` or `OtterOrderSubItem`, flattened in render order.
 *
 * `LineCostInput.lines` plus the sku, which `LineCost` does not carry back out
 * — and the "Needs you" queue is keyed on the sku, so the flattened array is
 * kept beside the costed one rather than reconstructed from it.
 */
export interface OrderLine {
  key: string
  name: string
  modifier: boolean
  skuId: string
  quantity: number
  price: number
}

/** One row of the Items table — prototype line 6582. */
export interface OrderItemRow {
  key: string
  name: string
  /** A sub-item. The prototype indents it and drops the `<b>`. */
  modifier: boolean
  qty: string
  /** What the channel charged. */
  price: string
  /** `price × (1 − commission rate)`. */
  keep: string
  /** `not costed` when no recipe stands behind this line. */
  cost: string
  /** Em dash when `keep` is zero, or when the line has no cost — rule 2. */
  margin: string
  /** The cost cell reads as a warning rather than a figure. */
  uncosted: boolean
}

export interface OrderItems {
  meta: string
  rows: OrderItemRow[]
  /** The sum of `rows`. Never `OtterOrder.total` — rule 1. */
  total: OrderItemRow
}

export interface OrderKeep {
  rows: MathRow[]
  /** The tax sentence, the tip sentence and the uncosted warning, already assembled. */
  note: string
}

export interface OrderSectionsInput {
  orderId: string
  /**
   * The account the reader is on. `batchRecipeCosts` is scoped by it and
   * cannot fetch a session itself; the same reason `PnlSectionsInput` takes
   * one. Importing `@/lib/auth` pulls `@/lib/prisma` in at MODULE LOAD.
   */
  accountId: string
  /** Today, for the "sells N times a period" figure. Injected so a test can fix it. */
  today?: Date
}

export interface OrderSections {
  /** Line 6574. Five cells, none of them judged — ruling O-R2. */
  strip: SectionData<StripCell[]>
  /** `sec('Items', …)` line 6580 — the lines table with its total row. */
  items: SectionData<OrderItems>
  /** `sec('What you keep', …)` line 6593 — the MathLines panel and its prose. */
  keep: SectionData<OrderKeep>
  /** `sec('Timeline', 'from the POS', kv(…))` line 6608. */
  timeline: SectionData<KvRow[]>
  /** `sec('Platform', …, kv(…))` line 6610. */
  platform: SectionData<KvRow[]>
  /** `sec('Needs you', …, queue(…))` line 6613. Empty when nothing needs anyone. */
  needsYou: SectionData<QueueItem[]>
  /** The masthead's `title` and `sub` — line 6570. */
  head: SectionData<{ title: string; sub: string }>
}

/* ── Constants and small readings ─────────────────────────────────────── */

const DASH = "—"

/** How far back "sells N times a period" looks, in days. */
const CARRIED_LOOKBACK_DAYS = 28

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Written out, because "the last four Thus" is not a sentence. */
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]

/**
 * Raw Otter slug → the words on its filter toggle.
 *
 * NOT `Channel.name`, and the difference matters for exactly one channel:
 * `CHANNEL_FOR_PLATFORM` maps BOTH `css-pos` and `bnm-web` onto `house`, and
 * `getOrdersList` filters on ONE slug. Two toggles both labelled "In-house"
 * would be indistinguishable, and a single "In-house" toggle could not select
 * both slugs through a filter that takes one. So the toggles are per slug and
 * the house pair is named for what actually distinguishes them — the register
 * and the restaurant's own web ordering — while both still carry the house
 * tint, because they are one channel on every chart.
 */
const PLATFORM_LABEL: Record<string, string> = {
  "css-pos": "In-house",
  "bnm-web": "Own web",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
}

/** The Counter channel a raw platform slug belongs to, or none. */
function channelOf(platform: string): Channel | null {
  const id: ChannelId | undefined = CHANNEL_FOR_PLATFORM[platform]
  return id ? channelById(id) : null
}

/**
 * `FilterToggle.tint` is a BARE custom-property name (`--ch-dd`); `Channel.markVar`
 * is the `var(...)` form the prototype writes into a chip's `--pc`. `Filters`
 * wraps its own, so handing it `var(--ch-dd)` would emit `var(var(--ch-dd))`.
 * One unwrapping, here, rather than a second constant per channel.
 */
function tintName(id: ChannelId): string {
  return markVarFor(id).slice("var(".length, -1)
}

/**
 * `9:32pm`, read off the STORE's clock.
 *
 * `referenceTimeLocal` is Otter's `reference_time_local_without_tz`: the
 * store's own wall clock ENCODED as a UTC instant, exactly as `HarriShift`
 * does it. `getUTCHours()` therefore yields the posted clock hour with no
 * timezone maths, and `getHours()` would yield the hour wherever the server
 * happens to be running — which is the defect four monitoring components on
 * this project still carry under a "PT" masthead.
 */
function clockTime(d: Date): string {
  const h = d.getUTCHours()
  const m = d.getUTCMinutes().toString().padStart(2, "0")
  return `${((h + 11) % 12) + 1}:${m}${h < 12 ? "am" : "pm"}`
}

/** `Aug 21`, on the same clock and for the same reason. */
function clockDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** `Aug 21, 9:32pm`. */
function clockStamp(d: Date): string {
  return `${clockDate(d)}, ${clockTime(d)}`
}

/**
 * `syncedAt` and `detailsFetchedAt` are REAL instants — `@default(now())` and
 * `@updatedAt` — not the wall-clock trick `referenceTimeLocal` uses. Printing
 * them on the store's clock would be a lie about a timestamp, and printing
 * them in server-local time would be a lie about a timezone, so they are
 * printed in UTC and SAY so. Nothing in this schema publishes a store's IANA
 * zone (`User.timezone` is a person's, not a store's).
 */
function instantStamp(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${clockTime(d)} UTC`
}

/**
 * A fee cell: the figure when a channel took a share, an em dash when it did
 * not.
 *
 * `$0.00` of commission is the same lie `channel-mix.ts` refuses to tell about
 * Grubhub — the claim that a marketplace worked for free. An in-house order
 * has no marketplace at all, so there is nothing to state.
 */
function feeFigure(commission: number, opts: { cents?: boolean } = {}): string {
  return money(commission > 0 ? commission : null, opts)
}

/** A margin, or an em dash where the division has no reading — rule 2. */
function marginFigure(keep: number, cost: number | null): string {
  if (cost === null || keep === 0) return DASH
  return pct(((keep - cost) / keep) * 100, { scaled: true })
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/* ── The orders list ──────────────────────────────────────────────────── */

/**
 * Five cells, in the prototype's order, and not one of them judged.
 *
 * Every figure comes off `OrderListResponse.totals` and `totalCount`, which
 * cover the WHOLE matched range. `rows` is one screenful — `getOrdersList`
 * caps its `findMany` at `limit` — so a strip that summed `rows` would report
 * the page as if it were the range, and would get quieter the further a reader
 * scrolled. The action grew its own aggregate for exactly this.
 */
export function buildOrdersStrip(
  now: OrderListResponse,
  then: OrderListResponse | null,
  cmp: ComparisonContext,
): StripCell[] {
  const ticket = now.totalCount > 0 ? now.totals.netSales / now.totalCount : null
  const thenTicket =
    then && then.totalCount > 0 ? then.totals.netSales / then.totalCount : null

  const orders = comparisonPhrase(now.totalCount, cmp, then?.totalCount ?? null)
  const net = comparisonPhrase(now.totals.netSales, cmp, then?.totals.netSales ?? null)
  const avg = comparisonPhrase(ticket ?? 0, cmp, thenTicket)

  const feeShare =
    now.totals.thirdPartyNetSales > 0
      ? (now.totals.commission / now.totals.thirdPartyNetSales) * 100
      : null

  return [
    { label: "Orders", value: count(now.totalCount), delta: orders.text, deltaTone: orders.tone },
    { label: "Net sales", value: money(now.totals.netSales), delta: net.text, deltaTone: net.tone },
    {
      label: "Avg ticket",
      // `money(null)` is an em dash. A range with no orders has no average
      // ticket; `$0.00` would be the claim that every order on it was free.
      value: money(ticket, { cents: true }),
      delta: ticket === null ? "no orders in this range" : avg.text,
      deltaTone: ticket === null ? "is-flat" : avg.tone,
    },
    {
      label: "Marketplace fees",
      value: money(now.totals.commission),
      // The prototype puts this in `c[2]` (`.d`), not in `c[4]` (`.band`) —
      // see the report. Money leaving is `is-down` whichever way it moved.
      delta: feeShare === null ? "no marketplace sales" : `${pct(feeShare, { scaled: true })} of 3P`,
      deltaTone: feeShare === null ? "is-flat" : "is-down",
    },
    {
      // Ruling O-R1: the prototype's slot, this schema's figure, an honest name.
      label: "Details not drained",
      value: count(now.undrainedCount),
      delta: now.undrainedCount === 0 ? "all drained" : `${count(now.undrainedCount)} pending`,
      deltaTone: now.undrainedCount === 0 ? "is-flat" : "is-down",
    },
  ]
}

/**
 * One toggle per platform the account has actually traded on.
 *
 * Driven by `OrderListResponse.platforms` — the distinct slugs on file —
 * rather than by `CHANNELS`, so a store that has never taken a Grubhub order
 * is not offered a filter that can only ever return nothing. A slug with no
 * Counter channel (`chownow`, and whatever Otter adds next) gets a toggle with
 * NO tint: `channel-mix.ts` deliberately assigns it no CVD-safe band, and
 * `Filters` renders an untinted toggle in fallback ink rather than in a colour
 * that means something else on the charts.
 */
function buildToggles(platforms: string[], selected: string | null): FilterToggle[] {
  return platforms.map((p) => {
    const channel = channelOf(p)
    return {
      id: p,
      label: PLATFORM_LABEL[p] ?? p,
      ...(channel ? { tint: tintName(channel.id) } : {}),
      pressed: selected === p,
    }
  })
}

export function buildOrdersList(
  res: OrderListResponse,
  opts: { search: string; platform: string | null },
): OrdersList {
  return {
    toggles: buildToggles(res.platforms, opts.platform),
    search: opts.search,
    count: `${count(res.rows.length)} of ${count(res.totalCount)}`,
    nextCursor: res.nextCursor,
    rows: res.rows.map((r) => {
      const channel = channelOf(r.platform)
      const ticket = r.subtotal - r.discount
      return {
        key: r.id,
        href: `/dashboard/orders/${r.id}`,
        id: `#${r.externalDisplayId ?? r.otterOrderId}`,
        time: clockTime(r.referenceTimeLocal),
        channel: {
          label: PLATFORM_LABEL[r.platform] ?? r.platform,
          // The chip's `--pc`, which the prototype writes as `var(--ch-dd)`.
          // An unmapped platform inherits `.chip i`'s own fallback ink.
          tint: channel ? markVarFor(channel.id) : "var(--ink-3)",
        },
        items: count(r.itemCount),
        ticket: money(ticket, { cents: true }),
        fees: feeFigure(r.commission, { cents: true }),
        net: money(ticket - r.commission, { cents: true }),
      }
    }),
  }
}

/**
 * The hours, and what the same hours normally do.
 *
 * **The prototype's per-hour BAND is not buildable from this schema**, and
 * drawing one anyway would be inventing a spread. `getHourlyPatternsForRange`
 * returns `HourlyOrderPoint.avgOrderCount` — the MEAN of the four comparison
 * groups at that hour — and publishes the groups' spread only as
 * `groupTotals`, which are whole-period totals with no hour on them. A
 * `{lo, hi}` built from an average is `{avg, avg}`: a band of zero width drawn
 * as if it were a range, which is the same defect as the prototype's own
 * `ords * 0.92` orders band that `adapters/overview.ts` refuses. So the
 * baseline ships as what it actually is — one dashed line, `as: "line"` over
 * the bars, which `ChartSeries` documents as "the bars are what happened, the
 * line is what they are judged against".
 *
 * The meta names the baseline from THIS range's own weekday. Hardcoding
 * "Thursdays" would be right one day in seven.
 */
export function buildOrdersByHour(
  hourly: HourlyOrderPoint[],
  cmp: OrderPatternsHourlyComparison | null,
  range: DateRange,
): OrdersByHour {
  const baseline = hourly.map((h) => h.avgOrderCount)
  const hasBaseline = cmp !== null && baseline.some((v) => v > 0)

  return {
    meta: hasBaseline ? baselineMeta(range) : "no baseline for this range",
    chart: {
      type: "bars",
      h: 132,
      zero: true,
      labels: hourly.map((h) => h.label),
      alt: "Orders by hour",
      legend: hasBaseline,
      vs: hasBaseline ? 1 : null,
      vsLabel: "against the baseline",
      series: [
        { name: "Orders", color: "var(--ink)", data: hourly.map((h) => h.orderCount) },
        ...(hasBaseline
          ? [
              {
                name: "Baseline",
                color: "var(--ink-3)",
                data: baseline,
                as: "line" as const,
                dash: true,
                w: 1.5,
              },
            ]
          : []),
      ],
    },
  }
}

/** `band = the last four Thursdays`, built from the range rather than remembered. */
function baselineMeta(range: DateRange): string {
  const days = dayCount(range)
  if (days === 1) return `baseline = the last four ${WEEKDAYS[range.start.getDay()]}s`
  return `baseline = the same ${plural(days, "day")}, four weeks back`
}

/* ── One order: its lines ─────────────────────────────────────────────── */

/**
 * The order's items and their modifiers, in the order they are drawn — each
 * modifier directly under the item that carries it, which is what the
 * prototype's indented `&mdash;` row means.
 */
export function flattenOrderLines(order: OrderDetail): OrderLine[] {
  const lines: OrderLine[] = []
  for (const item of order.items) {
    lines.push({
      key: `i:${item.id}`,
      name: item.name,
      modifier: false,
      skuId: item.skuId,
      quantity: item.quantity,
      price: item.price,
    })
    for (const sub of item.subItems) {
      lines.push({
        key: `s:${sub.id}`,
        name: sub.name,
        modifier: true,
        skuId: sub.skuId,
        quantity: sub.quantity,
        price: sub.price,
      })
    }
  }
  return lines
}

/** As much of an `OtterItemMapping` row as the fallback needs. */
export interface ItemMappingRow {
  /** NULLABLE. Legacy rows were mapped before Otter SKUs were stored. */
  skuId: string | null
  otterItemName: string
  recipeId: string
}

/** `OtterSubItemMapping`. `skuId` is non-null and is its own `@@unique` key. */
export interface SubItemMappingRow {
  skuId: string
  recipeId: string
}

/**
 * `resolveLineCosts`' `recipeBySku`, resolved against a mapping table whose
 * key is only sometimes a sku.
 *
 * `OtterItemMapping` is unique on `(storeId, otterItemName)` and its `skuId`
 * is nullable — "Legacy rows may leave this null", says the schema. So an item
 * line matches on `skuId` when the mapping carries one and on `otterItemName`
 * when it does not, and a sku match WINS over a name match: a row that has
 * been given a sku is the row someone confirmed most recently, and the name on
 * an older row can have drifted ("Double Slider" → "Double Slider (2026)").
 *
 * Sub-items need no fallback at all. Both halves write into ONE map because
 * that is what `resolveLineCosts` reads, and the two sku namespaces are
 * disjoint in practice — an item sku and a sub-item sku colliding would be an
 * Otter data fault, and the item mapping would win it.
 *
 * A line with neither match is simply absent from the map, which
 * `resolveLineCosts` reports as `unmapped` — never a zero cost, which would
 * price a recipe nobody has written at nothing and read as pure margin.
 */
export function buildRecipeBySku(
  lines: OrderLine[],
  itemMappings: ItemMappingRow[],
  subMappings: SubItemMappingRow[],
): Map<string, string> {
  const bySku = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const m of itemMappings) {
    if (m.skuId) bySku.set(m.skuId, m.recipeId)
    byName.set(m.otterItemName, m.recipeId)
  }
  const bySubSku = new Map(subMappings.map((m) => [m.skuId, m.recipeId]))

  const out = new Map<string, string>()
  for (const line of lines) {
    const recipeId = line.modifier
      ? bySubSku.get(line.skuId)
      : (bySku.get(line.skuId) ?? byName.get(line.name))
    if (recipeId) out.set(line.skuId, recipeId)
  }
  return out
}

/**
 * The order's OWN commission as a share of the ticket its LINES add up to.
 *
 * Not `Channel.commission`: that is the trade's published rate, and this order
 * has a recorded figure. Using the recorded one keeps `Σ line.keep` exactly
 * equal to `ticket − commission`, so the items table's "After commission"
 * total and the strip's "You keep" cannot differ by a rounding step.
 *
 * The denominator is the LINES, not `subtotal`, for the same reason rule 1
 * exists: it has to be the number a reader can add up on the page.
 */
export function commissionRateOf(order: OrderDetail, lines: OrderLine[]): number {
  const ticket = lines.reduce((t, l) => t + l.price, 0)
  return ticket > 0 ? order.commission / ticket : 0
}

/** Every money figure the order page prints, derived once from the lines. */
interface OrderMoney {
  /** Σ line price — and `subtotal − discount` only when there are no lines at all. */
  ticket: number
  commission: number
  rate: number
  /** Σ line keep. */
  keep: number
  /** Σ of the lines that ARE costed, or `null` when not one of them is. */
  cost: number | null
  uncosted: number
}

function orderMoney(order: OrderDetail, costs: LineCost[]): OrderMoney {
  // With no lines on file, the order's own columns are all there is — and the
  // Items section says so rather than drawing a $0.00 ticket.
  if (costs.length === 0) {
    const ticket = order.subtotal - order.discount
    return {
      ticket,
      commission: order.commission,
      rate: ticket > 0 ? order.commission / ticket : 0,
      keep: ticket - order.commission,
      cost: null,
      uncosted: 0,
    }
  }

  const ticket = costs.reduce((t, l) => t + l.price, 0)
  const keep = costs.reduce((t, l) => t + l.keep, 0)
  const costed = costs.filter((l) => l.cost !== null)
  return {
    ticket,
    commission: order.commission,
    rate: ticket > 0 ? order.commission / ticket : 0,
    keep,
    // Zero costed lines is an absence, not a free order. A `0` here would
    // print a 100% contribution margin on an order nobody has priced.
    cost: costed.length === 0 ? null : costed.reduce((t, l) => t + (l.cost ?? 0), 0),
    uncosted: costs.length - costed.length,
  }
}

/* ── One order: the sections ──────────────────────────────────────────── */

/** `Order #4821` / `DoorDash · Aug 21, 9:32pm · 3 items` — prototype line 6570. */
export function buildOrderHead(order: OrderDetail): { title: string; sub: string } {
  return {
    title: `Order #${order.externalDisplayId ?? order.otterOrderId}`,
    sub: [
      PLATFORM_LABEL[order.platform] ?? order.platform,
      clockStamp(order.referenceTimeLocal),
      plural(order.items.length, "item"),
    ].join(" · "),
  }
}

/**
 * Five cells, in the prototype's order — and, per ruling O-R2, not one of them
 * carries a `reference`. Nothing in this schema publishes a per-order target.
 */
export function buildOrderStrip(order: OrderDetail, costs: LineCost[]): StripCell[] {
  const m = orderMoney(order, costs)
  const label = PLATFORM_LABEL[order.platform] ?? order.platform
  const house = channelOf(order.platform)?.id === "house"
  const contribution = m.cost === null ? null : m.keep - m.cost

  return [
    {
      label: "Ticket",
      value: money(m.ticket, { cents: true }),
      delta: house ? "your own prices" : `${label} prices`,
    },
    {
      label: "Commission",
      // An em dash, not `$0.00`: an in-house order has no marketplace to have
      // taken a share. Same rule as the list's Fees column.
      value: m.commission > 0 ? `−${money(m.commission, { cents: true })}` : DASH,
      delta:
        m.commission > 0
          ? `${pct(m.rate * 100, { scaled: true })} of ticket`
          : "no marketplace took a share",
      deltaTone: m.commission > 0 ? "is-down" : "is-flat",
    },
    {
      label: "You keep",
      value: money(m.keep, { cents: true }),
      delta: `${pct((1 - m.rate) * 100, { scaled: true })} of ticket`,
    },
    {
      label: "Food cost",
      value: m.cost === null ? DASH : `−${money(m.cost, { cents: true })}`,
      delta:
        m.cost === null
          ? "no line on this order is costed"
          : m.uncosted === 0
            ? "every line costed"
            : `${plural(m.uncosted, "line")} not costed`,
      deltaTone: m.uncosted > 0 || m.cost === null ? "is-down" : undefined,
    },
    {
      label: "Contribution",
      value: money(contribution, { cents: true }),
      // Rule 2 again, one level up: a comped order has no share to state.
      delta:
        contribution === null
          ? "no food cost to subtract"
          : m.keep === 0
            ? DASH
            : `${pct((contribution / m.keep) * 100, { scaled: true })} of what you keep`,
      deltaTone: contribution === null ? "is-flat" : undefined,
    },
  ]
}

/**
 * The lines, and a total row that is the SUM OF THE ROWS ABOVE IT.
 *
 * Rule 1, and the reason this function is handed `costs` rather than a number:
 * `OtterOrder.total` carries tax and can disagree with the lines by more than
 * rounding, and a total row that disagrees with the column a reader is looking
 * at destroys the only thing a table like this is for. `order` is here for the
 * meta alone — specifically to tell "this order has no lines" apart from "this
 * order's lines have not been drained from Otter yet".
 */
export function buildOrderItems(order: OrderDetail, costs: LineCost[]): OrderItems {
  const rows: OrderItemRow[] = costs.map((l) => ({
    key: l.key,
    name: l.name,
    modifier: l.modifier,
    qty: count(l.quantity),
    price: money(l.price, { cents: true }),
    keep: money(l.keep, { cents: true }),
    cost: l.cost === null ? "not costed" : money(l.cost, { cents: true }),
    margin: marginFigure(l.keep, l.cost),
    uncosted: l.cost === null,
  }))

  const qty = costs.reduce((t, l) => t + l.quantity, 0)
  const price = costs.reduce((t, l) => t + l.price, 0)
  const keep = costs.reduce((t, l) => t + l.keep, 0)
  const costed = costs.filter((l) => l.cost !== null)
  const cost = costed.length === 0 ? null : costed.reduce((t, l) => t + (l.cost ?? 0), 0)

  const items = costs.filter((l) => !l.modifier).length
  const modifiers = costs.length - items

  return {
    meta:
      costs.length === 0
        ? order.detailsFetchedAt === null
          ? "line detail not drained yet"
          : "no lines on this order"
        : [plural(items, "line"), ...(modifiers > 0 ? [plural(modifiers, "modifier")] : [])].join(" · "),
    rows,
    total: {
      key: "total",
      name: "Total",
      modifier: false,
      qty: count(qty),
      price: money(price, { cents: true }),
      keep: money(keep, { cents: true }),
      cost: cost === null ? "not costed" : money(cost, { cents: true }),
      margin: marginFigure(keep, cost),
      uncosted: cost === null,
    },
  }
}

/**
 * The chain from ticket to contribution, drawn as arithmetic — and the prose
 * under it for the money that did not move.
 *
 * **Rule 3: tax is stated and is not subtracted.** The prototype's own comment
 * at line 6600 records this exact bug being repaired: tax was drawn as a
 * `<span class="op">` subtraction and then not applied, so the net printed
 * underneath it was the ticket less commission alone. Every row here IS summed
 * into the figure below it, which is also what `MathLines` documents about
 * itself — so the tax figure lives in `note` and nowhere else.
 *
 * THE TIP IS THE SAME DECISION and the prototype does NOT make it. Its panel
 * carries a `+ tip passed through` row, which is inert only because its
 * fixture's tip is `$0.00`; on a real order that row would be an operation
 * drawn and then not applied, because `o.net` is `ticket × (1 − rate)` with no
 * tip in it. Rather than port a bug that has not fired yet, the tip is stated
 * beside the tax.
 */
export function buildOrderKeep(order: OrderDetail, costs: LineCost[]): OrderKeep {
  const m = orderMoney(order, costs)
  const label = PLATFORM_LABEL[order.platform] ?? order.platform
  const house = channelOf(order.platform)?.id === "house"

  const rows: MathRow[] = [
    {
      key: "ticket",
      label: house ? "Ticket, as you charged it" : `Ticket, as charged on ${label}`,
      value: money(m.ticket, { cents: true }),
    },
  ]
  if (m.commission > 0) {
    rows.push({
      key: "commission",
      label: `− commission ${pct(m.rate * 100, { scaled: true })}`,
      op: true,
      value: `−${money(m.commission, { cents: true })}`,
    })
  }
  rows.push({
    key: "net",
    label: "Net to you",
    strong: true,
    rule: true,
    value: money(m.keep, { cents: true }),
  })
  if (m.cost !== null) {
    rows.push({
      key: "food",
      label: "− food cost",
      op: true,
      noBorder: true,
      value: `−${money(m.cost, { cents: true })}`,
    })
    rows.push({
      key: "contribution",
      label: "Contribution",
      strong: true,
      noBorder: true,
      value: money(m.keep - m.cost, { cents: true }),
    })
  }

  const sentences: string[] = []
  if (order.tax > 0) {
    sentences.push(
      `${money(order.tax, { cents: true })} of sales tax was collected and remitted by ` +
        `${house ? "the register" : label}. It is not in any figure above, because it was ` +
        "never yours.",
    )
  }
  if (order.tip > 0) {
    sentences.push(
      `${money(order.tip, { cents: true })} of tip was collected on this order. It is not in ` +
        "any figure above either, for the same reason.",
    )
  }
  if (m.cost === null) {
    sentences.push(
      "No line on this order has a recipe behind it, so there is no food cost to subtract and " +
        "no contribution to state.",
    )
  } else if (m.uncosted > 0) {
    sentences.push(
      `${plural(m.uncosted, "line")} on this order ${m.uncosted === 1 ? "has" : "have"} no ` +
        "recipe behind it, so this contribution is generous by however much that food costs.",
    )
  }

  return { rows, note: sentences.join(" ") }
}

/**
 * `sec('Timeline', 'from the POS', kv(…))` — prototype line 6608, with the
 * rows this schema can actually fill.
 *
 * The prototype prints Placed / Accepted / Ready / Collected / Synced. Otter
 * gives us ONE timestamp on the order (`referenceTimeLocal`) plus two of our
 * own, and two STATUSES with no times against them. Inventing an "Accepted
 * 9:32:41pm" would be drawing a timeline out of nothing, so the section states
 * what it has and the missing steps are simply absent.
 */
export function buildOrderTimeline(order: OrderDetail): KvRow[] {
  return [
    { label: "Placed", value: clockStamp(order.referenceTimeLocal) },
    { label: "Status", value: order.orderStatus ?? DASH },
    { label: "Acceptance", value: order.acceptanceStatus ?? DASH },
    {
      label: "Lines drained",
      value: order.detailsFetchedAt === null ? "not yet" : instantStamp(order.detailsFetchedAt),
      tone: order.detailsFetchedAt === null ? "warn" : undefined,
    },
    { label: "Synced to us", value: instantStamp(order.syncedAt) },
  ]
}

/**
 * `sec('Platform', …, kv(…))` — prototype line 6610.
 *
 * The prototype's payout id and payout date are NOT here: `payout`,
 * `payout_id` and `payout_date` live on Otter's `customer_orders` dataset and
 * this schema persists none of them on `OtterOrder`. Neither is the payment
 * method — `multi_value_pos_payment_method` is a daily-summary dimension, not
 * an order field. Four rows that are true beat six with two invented.
 */
export function buildOrderPlatform(order: OrderDetail): KvRow[] {
  return [
    { label: "Channel", value: PLATFORM_LABEL[order.platform] ?? order.platform },
    { label: "External id", value: order.externalDisplayId ?? DASH },
    { label: "Otter id", value: order.otterOrderId },
    { label: "Fulfilment", value: order.fulfillmentMode ?? DASH },
    { label: "Store", value: order.storeName },
    { label: "Customer", value: order.customerName ?? DASH },
  ]
}

/**
 * One queue item per DISTINCT unmapped sku, and an EMPTY section when there
 * are none.
 *
 * Rule 4. `empty` rather than `ready([])`: `Section` renders an empty section
 * as an empty section, and a "Needs you" heading over a zero-length list is a
 * page asking a reader to look at nothing. `no_match` is the reason because
 * the queue is a filter over this order's lines that caught nothing — there is
 * a way out of it (map the sku, or open another order), which `pre_open` does
 * not have.
 *
 * `carriedBySku` is how many of this account's order lines over the lookback
 * carried that sku — the prototype's "sells 188 times a period". A sku with no
 * count on file leads with an em dash rather than a `0`, because zero would
 * say the item never sells, which is the opposite of why it is on this list.
 * No `act` is wired: `QueueItem`'s `act`/`onAct` pair is inseparable by
 * construction and a function cannot cross the RSC boundary, so the page that
 * knows where "map the modifier" goes attaches it.
 */
export function buildNeedsYou(
  lines: OrderLine[],
  costs: LineCost[],
  carriedBySku: Map<string, number>,
): SectionData<QueueItem[]> {
  const skuByKey = new Map(lines.map((l) => [l.key, l]))
  const seen = new Map<string, { name: string; modifier: boolean; reason: string }>()

  for (const c of costs) {
    if (c.cost !== null) continue
    const line = skuByKey.get(c.key)
    if (!line) continue
    if (seen.has(line.skuId)) continue
    seen.set(line.skuId, {
      name: c.name,
      modifier: c.modifier,
      reason:
        c.uncostedReason === "partial"
          ? "its recipe does not fully price — at least one ingredient has no cost on file"
          : "it has no recipe behind it",
    })
  }

  if (seen.size === 0) return empty<QueueItem[]>("no_match")

  const items: QueueItem[] = [...seen].map(([skuId, l]) => {
    const carried = carriedBySku.get(skuId) ?? null
    return {
      key: skuId,
      tone: "warn" as const,
      lead: count(carried),
      unit: "orders",
      title: `${l.modifier ? "A modifier" : "An item"} is not costed: ${l.name}`,
      body:
        `${l.name} is on this order and ${l.reason}, so every order carrying it ` +
        `overstates what you keep. ` +
        (carried === null
          ? "It has not been counted over the last period."
          : `It sold ${count(carried)} time${carried === 1 ? "" : "s"} in the last ${CARRIED_LOOKBACK_DAYS} days.`),
    }
  })
  return ready(items)
}

/* ── The entry points ─────────────────────────────────────────────────── */

export async function getOrdersSections(input: OrdersSectionsInput): Promise<OrdersSections> {
  const { range, storeId } = input
  const platform = input.platform ?? null
  const search = input.search ?? ""
  const comparisonId: ComparisonId = input.comparisonId ?? "none"
  const cmpRange = comparisonId === "none" ? null : comparisonRange(range, comparisonId)

  const filters = {
    storeId,
    platform,
    search,
    startDate: isoDay(range.start),
    endDate: isoDay(range.end),
    limit: input.limit,
    cursor: input.cursor ?? null,
  }

  const [listSd, cmpSd, hourlySd] = await Promise.all([
    classify(() => getOrdersList(filters), { retryAction: "retryOrders" }),

    // The comparison is its own load and its own failure: a strip that lost
    // its figures because the PRIOR period would not load would be a worse
    // page than one whose deltas simply read "no comparison set".
    classify<OrderListResponse | null>(
      () =>
        cmpRange
          ? getOrdersList({
              ...filters,
              startDate: isoDay(cmpRange.start),
              endDate: isoDay(cmpRange.end),
              cursor: null,
              // One row is enough: every figure the comparison feeds comes off
              // `totals` and `totalCount`, which cover the whole matched range.
              limit: 1,
            })
          : Promise.resolve(null),
      { retryAction: "retryComparison" },
    ),

    classify(
      () =>
        getHourlyPatternsForRange(
          { kind: "custom", startDate: isoDay(range.start), endDate: isoDay(range.end) },
          storeId ?? undefined,
        ),
      { retryAction: "retryHourly" },
    ),
  ])

  const cmpList = dataOf(cmpSd)
  // `comparisonContext` types its scope as a `Statement`, which is not what
  // this page compares. Its label, short form and DIVISOR are the decisions
  // worth reusing — they are the ones two pages must not answer differently —
  // so the context is built with a null scope and only `on` is restated here.
  const cmp: ComparisonContext = {
    ...comparisonContext(comparisonId, null),
    on: comparisonId !== "none" && cmpList !== null,
  }

  return {
    strip: mapReady(listSd, (res) => buildOrdersStrip(res, cmpList, cmp)),
    list: mapReady(listSd, (res) => buildOrdersList(res, { search, platform })),
    byHour: mapReady(hourlySd, (h) =>
      buildOrdersByHour(h?.hourly ?? [], h?.hourlyComparison ?? null, range),
    ),
  }
}

/** Everything the order page's seven sections are built from, loaded once. */
interface LoadedOrder {
  order: OrderDetail
  lines: OrderLine[]
  costs: LineCost[]
  carriedBySku: Map<string, number>
}

export async function getOrderSections(input: OrderSectionsInput): Promise<OrderSections> {
  const { orderId, accountId } = input
  const today = input.today ?? new Date()

  const loaded: SectionData<LoadedOrder | null> = await classify(async () => {
    const order = await getOrderDetail(orderId)
    if (!order) return null

    const lines = flattenOrderLines(order)
    // `OrderDetail` carries the store's NAME and not its id, and
    // `OtterItemMapping` is keyed on `(storeId, otterItemName)` — a name lookup
    // would match the wrong store the moment two stores share a name. One
    // narrow read for the id rather than widening the action's return.
    const owner = await prisma.otterOrder.findUnique({
      where: { id: orderId },
      select: { storeId: true },
    })
    const storeId = owner?.storeId ?? null

    const itemLines = lines.filter((l) => !l.modifier)
    const subLines = lines.filter((l) => l.modifier)

    const [itemMappings, subMappings, costByRecipe] = await Promise.all([
      storeId === null
        ? Promise.resolve([] as ItemMappingRow[])
        : // BOTH halves of the nullable-sku fallback are asked for in ONE
          // query: rows whose sku matches, and rows whose NAME matches. Which
          // of the two wins is `buildRecipeBySku`'s decision, not the query's.
          prisma.otterItemMapping.findMany({
            where: {
              storeId,
              OR: [
                { skuId: { in: itemLines.map((l) => l.skuId) } },
                { otterItemName: { in: itemLines.map((l) => l.name) } },
              ],
            },
            select: { skuId: true, otterItemName: true, recipeId: true },
          }),
      storeId === null
        ? Promise.resolve([] as SubItemMappingRow[])
        : prisma.otterSubItemMapping.findMany({
            where: { storeId, skuId: { in: subLines.map((l) => l.skuId) } },
            select: { skuId: true, recipeId: true },
          }),
      batchRecipeCosts(accountId),
    ])

    const costs = resolveLineCosts({
      lines,
      recipeBySku: buildRecipeBySku(lines, itemMappings, subMappings),
      costByRecipe,
      commissionRate: commissionRateOf(order, lines),
    })

    const carriedBySku = await countCarried(
      costs.filter((c) => c.cost === null).map((c) => c.key),
      lines,
      { accountId, today },
    )

    return { order, lines, costs, carriedBySku }
  }, { retryAction: "retryOrder", isEmpty: (v) => v === null })

  /*
   * One load, seven sections. `classify`'s `isEmpty` has already turned a
   * missing order into `empty`, so `mapReadyTo` only ever sees a real one —
   * but the union still carries the `null`, and narrowing it here rather than
   * asserting it away is what keeps that guarantee checkable.
   */
  const on = <T,>(f: (v: LoadedOrder) => T): SectionData<T> =>
    mapReadyTo(loaded, (v) => (v === null ? empty<T>("no_match") : ready(f(v))))

  return {
    head: on(({ order }) => buildOrderHead(order)),
    strip: on(({ order, costs }) => buildOrderStrip(order, costs)),
    items: on(({ order, costs }) => buildOrderItems(order, costs)),
    keep: on(({ order, costs }) => buildOrderKeep(order, costs)),
    timeline: on(({ order }) => buildOrderTimeline(order)),
    platform: on(({ order }) => buildOrderPlatform(order)),
    // The one section that decides its own emptiness — rule 4 — so it is
    // flattened rather than mapped: an order that loaded with nothing to fix
    // is an EMPTY "Needs you", not a failed one.
    needsYou: (() => {
      const v = dataOf(loaded)
      if (v === null) return empty<QueueItem[]>("no_match")
      return buildNeedsYou(v.lines, v.costs, v.carriedBySku)
    })(),
  }
}

/**
 * How many of this account's order lines over the lookback carried each
 * unmapped sku — the prototype's "sells 188 times a period", measured.
 *
 * Items and sub-items are counted in their own tables because they ARE
 * different tables; a sku absent from the result simply has no count, and
 * `buildNeedsYou` prints an em dash for it rather than a zero.
 */
async function countCarried(
  uncostedKeys: string[],
  lines: OrderLine[],
  ctx: { accountId: string; today: Date },
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (uncostedKeys.length === 0) return out

  const byKey = new Map(lines.map((l) => [l.key, l]))
  const wanted = uncostedKeys.map((k) => byKey.get(k)).filter((l): l is OrderLine => l != null)
  const itemSkus = [...new Set(wanted.filter((l) => !l.modifier).map((l) => l.skuId))]
  const subSkus = [...new Set(wanted.filter((l) => l.modifier).map((l) => l.skuId))]

  const since = new Date(ctx.today)
  since.setUTCDate(since.getUTCDate() - CARRIED_LOOKBACK_DAYS)

  /*
   * ANNOTATED, and that is load-bearing rather than decorative.
   *
   * `groupBy`'s `args` parameter is a `Subset<T, …>` generic, and TypeScript
   * does NOT excess-property-check an object literal passed into one: this
   * file shipped `orderItem: scope` written as `item: scope` — a relation name
   * that does not exist on `OtterOrderSubItem` — and `npx tsc --noEmit` was
   * clean on it. Verified by substituting `thisKeyDoesNotExist` and getting
   * the same clean run. A `WhereInput` annotation on a plain `const` restores
   * the check, because a variable declaration IS excess-property-checked.
   */
  const scope: Prisma.OtterOrderWhereInput = {
    store: { accountId: ctx.accountId },
    referenceTimeLocal: { gte: since },
  }
  const itemWhere: Prisma.OtterOrderItemWhereInput = {
    skuId: { in: itemSkus },
    order: scope,
  }
  const subWhere: Prisma.OtterOrderSubItemWhereInput = {
    skuId: { in: subSkus },
    orderItem: { order: scope },
  }

  const [items, subs] = await Promise.all([
    itemSkus.length === 0
      ? Promise.resolve([])
      : prisma.otterOrderItem.groupBy({
          by: ["skuId"],
          where: itemWhere,
          _count: { _all: true },
        }),
    subSkus.length === 0
      ? Promise.resolve([])
      : prisma.otterOrderSubItem.groupBy({
          by: ["skuId"],
          where: subWhere,
          _count: { _all: true },
        }),
  ])

  for (const r of [...items, ...subs]) out.set(r.skuId, r._count._all)
  return out
}
