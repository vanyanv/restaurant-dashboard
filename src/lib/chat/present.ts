import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { shortLabels } from "@/lib/counter/short-labels"
import { weekDayLabel } from "@/lib/counter/week-window"
import { platformLabel } from "@/lib/counter/channels"
import { money, count as countOf, pct } from "@/lib/counter/format"

/**
 * THE PICTURE A TOOL ALREADY HAS, BUILT FROM THE ROWS IT RETURNED.
 *
 * ## Why the model never types a series
 *
 * An answer can carry three scalars (`fileReturn.figures`) and nothing else,
 * so "how did sales move last week?" arrives as a sentence and a number on a
 * page whose own charts are two clicks away. The obvious fix — let the model
 * write out the series — is the wrong one twice over: it pays output tokens
 * per datum, and it lets a language model retype figures that were already
 * correct. A retyped number is a new number.
 *
 * So the payload is built HERE, on the server, from the same rows the tool is
 * about to return. The model chooses WHICH picture to show (`fileReturn.show`)
 * and never what is in it.
 *
 * ## Why it is a registry and not 58 edits
 *
 * One `presentFor(tool, args, result)` keyed by tool name, for the same reason
 * `data-as-of.ts` puts the freshness stamp in one place: a rule spread across
 * 22 tool files is a rule with 22 chances to be applied differently. Tools
 * keep returning exactly what they returned; the route attaches the picture on
 * the way out.
 *
 * ## What the model does NOT see
 *
 * The payload is a UI object — labels, colours, geometry — and worth nothing
 * to a model that already has the rows. `toModelOutput` in the route strips it
 * both from the turn it was built in and from every replay of that turn, which
 * is the proposal's own condition for adding it at all.
 *
 * ## Formatting lives here, not on the client
 *
 * Table cells arrive pre-written by `format.ts` — the same `money`, `count`
 * and `pct` every Counter page uses, so a figure inside an answer reads
 * exactly as it reads on the page the question was asked from. Charts cannot:
 * geometry needs the numbers. They carry a format NAME instead, resolved
 * client-side to the same three functions.
 */

/**
 * How a chart's readings are written.
 *
 * `"pct"` means a FRACTION — 0.31, not 31 — because that is what the
 * forecast tables store and what `pct()` expects unscaled. A tool that
 * returns an already-multiplied percent (`getCogsByItem.marginPct`) formats
 * its own cells here rather than shipping a second convention.
 */
export type PresentFormat = "money" | "count" | "pct"

export interface PresentChart {
  kind: "chart"
  /** What the picture is, in three or four words. Set as the section head. */
  title: string
  spec: ChartSpec
  fmt: PresentFormat
}

export interface PresentColumn {
  key: string
  label: string
  /** Right-aligned and tabular, the way `Table` writes a money column. */
  numeric?: boolean
}

export interface PresentTable {
  kind: "table"
  title: string
  columns: PresentColumn[]
  /** Cells are already formatted; the client sets them, it does not write them. */
  rows: Array<{ key: string; cells: Record<string, string> }>
  /**
   * How many rows the cap dropped.
   *
   * Carried rather than discarded so the client can say "12 of 47" — a table
   * silently truncated to its first page is a table that answers a "which is
   * biggest" question correctly and a "how many" question wrongly.
   */
  more: number
}

export type Presentation = PresentChart | PresentTable

/**
 * Caps, and why each is what it is.
 *
 * A line chart draws three axis ticks whatever it holds (`axisTicks`), so its
 * limit is about payload size rather than legibility — 92 days is a quarter.
 * A BAR chart prints every label, so it is capped at what fits the axis. The
 * table's cap is a screenful; anything longer is a page, not an answer.
 */
const MAX_LINE_POINTS = 92
const MAX_BARS = 14
const MAX_TABLE_ROWS = 12
/** `shortLabels`' budget for a bar axis — 9px mono, no room to spare. */
const AXIS_BUDGET = 10

/** The measure. `var(--ink-3)` is the reference/comparison, per the adapters. */
const INK = "var(--ink)"

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/** `"2026-08-29"` → `"Sat 29"`, and anything else through unchanged. */
function dayAxis(iso: string): string {
  return weekDayLabel(iso)
}

/**
 * `"2026-06"` → `"Jun"`, and `"Jun 2026"` when the range crosses a year.
 *
 * The month keys arrive from `getInvoiceSpend` as `YYYY-MM` and were going
 * onto the axis raw. Nine characters of digits in 9px mono is not a label.
 */
function monthAxis(keys: string[]): string[] {
  const years = new Set(keys.map((k) => k.slice(0, 4)))
  return keys.map((k) => {
    const m = /^(\d{4})-(\d{2})$/.exec(k)
    if (!m) return k
    const name = MONTHS[Number(m[2]) - 1] ?? k
    return years.size > 1 ? `${name} ${m[1].slice(2)}` : name
  })
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** `14` → `"2p"`, the way the hourly charts on the pages write an hour. */
function hourAxis(h: number): string {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** A bar chart over named categories — the shape half these tools return. */
function barsOf(
  title: string,
  names: string[],
  values: number[],
  fmt: PresentFormat,
): PresentChart | null {
  if (names.length < 2) return null
  const cut = names.slice(0, MAX_BARS)
  return {
    kind: "chart",
    title,
    fmt,
    spec: {
      type: "bars",
      labels: shortLabels(cut, AXIS_BUDGET),
      fullLabels: cut,
      series: [{ name: title, color: INK, data: values.slice(0, MAX_BARS) }],
      zero: true,
    },
  }
}

/** A line over an ordered window, optionally with a p10–p90 band. */
function lineOf(
  title: string,
  labels: string[],
  values: (number | null)[],
  fmt: PresentFormat,
  band?: { lo: (number | null)[]; hi: (number | null)[] },
): PresentChart | null {
  if (labels.length < 2) return null
  const n = Math.min(labels.length, MAX_LINE_POINTS)
  const spec: ChartSpec = {
    type: "line",
    labels: labels.slice(0, n),
    series: [{ name: title, color: INK, data: values.slice(0, n), fill: true, w: 1.9 }],
    zero: fmt !== "pct",
  }
  if (band) {
    spec.band = { lo: band.lo.slice(0, n), hi: band.hi.slice(0, n) }
    spec.bandLabel = "p10 – p90"
  }
  return { kind: "chart", title, fmt, spec }
}

function tableOf(
  title: string,
  columns: PresentColumn[],
  source: readonly unknown[],
  cellsFor: (row: Record<string, unknown>) => Record<string, string> | null,
): PresentTable | null {
  const rows: PresentTable["rows"] = []
  for (const raw of source) {
    if (!isRecord(raw)) continue
    const cells = cellsFor(raw)
    if (!cells) continue
    rows.push({ key: String(rows.length), cells })
    if (rows.length === MAX_TABLE_ROWS) break
  }
  if (rows.length < 2) return null
  return { kind: "table", title, columns, rows, more: Math.max(0, source.length - rows.length) }
}

/** Every tool result that is an array arrives here as one. */
function asRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return []
  return result.filter(isRecord)
}

type Builder = (args: unknown, result: unknown) => Presentation | null

/**
 * The tools that can draw something.
 *
 * A tuple rather than `Object.keys(BUILDERS)` because `fileReturn.show` is a
 * `z.enum` over it: the model picks from a closed list, so a hallucinated name
 * is rejected by the schema instead of silently drawing nothing. `satisfies`
 * below keeps the two in step — a builder added without a name here, or a name
 * without a builder, is a compile error.
 */
export const SHOWABLE_TOOLS = [
  "getDailySales",
  "getHourlyTrend",
  "getPlatformBreakdown",
  "getStoreBreakdown",
  "getTopMenuItems",
  "getCogsByItem",
  "getTopInvoices",
  "getInvoiceSpend",
  "getPnlSummary",
  "getRevenueForecast",
  "getFoodCostForecast",
  /*
   * Added 2026-09-19. Every one of these already returned a table's worth of
   * rows and could show none of it, so the answer was a sentence and up to
   * three scalars over a result the reader had asked to SEE. `getRatings` is
   * the clearest case: a 1-5 distribution is a bar chart or it is nothing,
   * and "4.6 average" hides whether that is everyone agreeing or half the
   * guests at five and a tenth at one.
   */
  "getMenuEngineering",
  "getIngredientPriceHistory",
  "getMenuItemElasticity",
  "getChannelMix",
  "getInventoryStatus",
  "getLostSales",
  "getWasteRootCauses",
  "rankRecipes",
  "getRatings",
  "getAlerts",
  "getForecastQuality",
] as const

export type ShowableTool = (typeof SHOWABLE_TOOLS)[number]

/**
 * One builder per tool that has a picture worth drawing.
 *
 * Absent on purpose, and not an oversight: `compareSales` is two totals and a
 * delta, which is exactly `fileReturn.figures` and would be a chart of two
 * bars; `listStores` and `describeSchema` return structure; `getInvoiceById`
 * and `getMenuItemDetails` are one record, which the verdict already carries.
 * A picture is added when it says something the three figures cannot.
 */
const BUILDERS = {
  getDailySales(args, result) {
    const rows = asRows(result)
    if (rows.length === 0) return null
    const groupBy = isRecord(args) ? text(args.groupBy) || "day" : "day"
    if (groupBy === "day") {
      return lineOf(
        "Net sales",
        rows.map((r) => dayAxis(text(r.date))),
        rows.map((r) => num(r.net)),
        "money",
      )
    }
    if (groupBy === "platform") {
      return barsOf(
        "Net sales by platform",
        // `platformLabel`, not `titleCase`: the slug is `css-pos`, and the
        // name for it is "In-house" on the Orders page, not "Css-Pos".
        rows.map((r) => platformLabel(text(r.platform))),
        rows.map((r) => num(r.net)),
        "money",
      )
    }
    return barsOf(
      "Net sales by payment",
      // CARD / CASH, which is already how a reader would write it.
      rows.map((r) => {
        const v = text(r.paymentMethod)
        return v ? v.charAt(0) + v.slice(1).toLowerCase() : v
      }),
      rows.map((r) => num(r.net)),
      "money",
    )
  },

  getHourlyTrend(_args, result) {
    const rows = asRows(result)
    if (rows.length === 0) return null
    return {
      kind: "chart",
      title: "Net sales by hour",
      fmt: "money",
      spec: {
        type: "bars",
        // Every hour the range traded, not a 24-slot grid: an hour with no
        // rows is an hour the kitchen was shut, and a zero bar there claims
        // it was open and sold nothing.
        labels: rows.map((r) => hourAxis(num(r.hour))),
        series: [{ name: "Net sales", color: INK, data: rows.map((r) => num(r.netSales)) }],
        zero: true,
      },
    }
  },

  getPlatformBreakdown(_args, result) {
    const rows = asRows(result)
    return barsOf(
      "Net sales by platform",
      rows.map((r) => platformLabel(text(r.platform))),
      rows.map((r) => num(r.net)),
      "money",
    )
  },

  getStoreBreakdown(_args, result) {
    const rows = asRows(result)
    return barsOf(
      "Net sales by store",
      rows.map((r) => text(r.storeName)),
      rows.map((r) => num(r.net)),
      "money",
    )
  },

  getTopMenuItems(_args, result) {
    const rows = asRows(result)
    return tableOf(
      "Top items",
      [
        { key: "item", label: "Item" },
        { key: "qty", label: "Sold", numeric: true },
        { key: "revenue", label: "Revenue", numeric: true },
      ],
      rows,
      (r) => ({
        item: text(r.itemName),
        qty: countOf(num(r.qty)),
        revenue: money(num(r.revenue)),
      }),
    )
  },

  getCogsByItem(_args, result) {
    const rows = asRows(result)
    return tableOf(
      "Cost by item",
      [
        { key: "item", label: "Item" },
        { key: "revenue", label: "Revenue", numeric: true },
        { key: "cogs", label: "COGS", numeric: true },
        { key: "margin", label: "Margin", numeric: true },
      ],
      rows,
      (r) => ({
        item: text(r.menuItem),
        revenue: money(num(r.revenue)),
        cogs: money(num(r.cogs)),
        // Already a percent, not a fraction — `pct` would multiply it again.
        margin: pct(numOrNull(r.marginPct), { scaled: true }),
      }),
    )
  },

  getTopInvoices(_args, result) {
    const rows = asRows(result)
    return tableOf(
      "Largest invoices",
      [
        { key: "vendor", label: "Vendor" },
        { key: "date", label: "Date" },
        { key: "amount", label: "Amount", numeric: true },
      ],
      rows,
      (r) => ({
        vendor: text(r.vendor),
        date: text(r.date) || "—",
        amount: money(num(r.totalAmount)),
      }),
    )
  },

  getInvoiceSpend(_args, result) {
    if (!isRecord(result)) return null
    const byMonth = Array.isArray(result.byMonth) ? result.byMonth.filter(isRecord) : []
    // The trend when there is one; otherwise who the money went to.
    if (byMonth.length >= 2) {
      return barsOf(
        "Spend by month",
        monthAxis(byMonth.map((m) => text(m.month))),
        byMonth.map((m) => num(m.amount)),
        "money",
      )
    }
    const byVendor = Array.isArray(result.byVendor) ? result.byVendor.filter(isRecord) : []
    return barsOf(
      "Spend by vendor",
      byVendor.map((v) => text(v.vendor)),
      byVendor.map((v) => num(v.amount)),
      "money",
    )
  },

  getPnlSummary(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : []
    const periods = Array.isArray(result.periods) ? result.periods.filter(isRecord) : []
    if (rows.length === 0 || periods.length === 0) return null
    // The matrix as the P&L page draws it: line down the side, period across.
    const cols = periods.slice(0, 6)
    const columns: PresentColumn[] = [
      { key: "line", label: "Line" },
      ...cols.map((p, i) => ({ key: `p${i}`, label: text(p.label), numeric: true })),
    ]
    return tableOf("P&L", columns, rows, (r) => {
      const values = Array.isArray(r.values) ? r.values : []
      const cells: Record<string, string> = { line: text(r.label) }
      cols.forEach((_p, i) => {
        cells[`p${i}`] = money(num(values[i]))
      })
      return cells
    })
  },

  getRevenueForecast(_args, result) {
    const rows = asRows(result)
    if (rows.length === 0) return null
    /*
     * ONE store's line, not every store's stacked on one axis.
     *
     * The tool returns a row per (store, date), so a multi-store call would
     * otherwise draw two dates' worth of points at one label. The forecast
     * question is per-store; the first store in the result is the one the
     * caller asked about when there is only one, and the honest picture when
     * there is more than one is still a single readable line.
     */
    const first = text(rows[0].storeId)
    const mine = rows.filter((r) => text(r.storeId) === first)
    const lo = mine.map((r) => numOrNull(r.p10))
    const hi = mine.map((r) => numOrNull(r.p90))
    const hasBand = lo.some((v) => v !== null) && hi.some((v) => v !== null)
    return lineOf(
      "Forecast revenue",
      mine.map((r) => dayAxis(text(r.date))),
      mine.map((r) => num(r.predictedRevenue)),
      "money",
      hasBand ? { lo, hi } : undefined,
    )
  },

  getFoodCostForecast(_args, result) {
    if (!isRecord(result) || result.ok === false) return null
    const days = Array.isArray(result.days) ? result.days.filter(isRecord) : []
    if (days.length === 0) return null
    const lo = days.map((d) => numOrNull(d.pctP10))
    const hi = days.map((d) => numOrNull(d.pctP90))
    const hasBand = lo.some((v) => v !== null) && hi.some((v) => v !== null)
    return lineOf(
      "Forecast food cost",
      days.map((d) => dayAxis(text(d.date))),
      days.map((d) => numOrNull(d.foodCostPct)),
      "pct",
      hasBand ? { lo, hi } : undefined,
    )
  },
  getMenuEngineering(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : []
    // Biggest contributors first: the quadrant label is the finding, and the
    // dollars are what makes one row's label matter more than another's.
    const sorted = [...rows].sort(
      (a, b) => num(b.totalContribution) - num(a.totalContribution),
    )
    return tableOf(
      "Menu engineering",
      [
        { key: "item", label: "Item" },
        { key: "quadrant", label: "Quadrant" },
        { key: "qty", label: "Sold", numeric: true },
        { key: "contribution", label: "Contribution", numeric: true },
      ],
      sorted,
      (r) => ({
        item: text(r.itemName),
        quadrant: text(r.quadrant),
        qty: countOf(num(r.soldQty)),
        contribution: money(num(r.totalContribution)),
      }),
    )
  },

  getIngredientPriceHistory(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : []
    // `rows` is oldest first, which is already the axis order.
    return lineOf(
      `${text(result.name) || "Ingredient"} unit price`,
      rows.map((r) => dayAxis(text(r.invoiceDate))),
      rows.map((r) => numOrNull(r.unitPrice)),
      "money",
    )
  },

  getMenuItemElasticity(_args, result) {
    const rows = asRows(result)
    // Most price-sensitive first. `elasticity` is negative for a normal item,
    // so the most sensitive is the most negative.
    const sorted = [...rows].sort((a, b) => num(a.elasticity) - num(b.elasticity))
    return tableOf(
      "Price sensitivity",
      [
        { key: "item", label: "Item" },
        { key: "elasticity", label: "Elasticity", numeric: true },
        { key: "confidence", label: "Confidence" },
        { key: "sample", label: "Days", numeric: true },
      ],
      sorted,
      (r) => ({
        item: text(r.itemSkuId),
        elasticity: num(r.elasticity).toFixed(2),
        confidence: text(r.confidence),
        sample: countOf(num(r.sampleSize)),
      }),
    )
  },

  getChannelMix(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : []
    // The net RATE, not the gross: gross by platform is already
    // `getPlatformBreakdown`, and the rate is the thing this tool knows that
    // that one does not.
    return barsOf(
      "Net rate by channel",
      rows.map((r) => platformLabel(text(r.platform))),
      // A fraction, 0..1 — `pct` multiplies, so it must not arrive scaled.
      rows.map((r) => num(r.netRatePct)),
      "pct",
    )
  },

  getInventoryStatus(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.rows) ? result.rows.filter(isRecord) : []
    return tableOf(
      "Inventory",
      [
        { key: "ingredient", label: "Ingredient" },
        { key: "onHand", label: "On hand", numeric: true },
        { key: "cover", label: "Days cover", numeric: true },
        { key: "status", label: "Status" },
      ],
      rows,
      (r) => {
        const cover = numOrNull(r.daysOfCover)
        return {
          ingredient: text(r.ingredientName),
          onHand: `${num(r.onHand).toFixed(1)} ${text(r.recipeUnit)}`.trim(),
          // A null cover is "we cannot say", not zero days left.
          cover: cover === null ? "—" : cover.toFixed(1),
          status: text(r.status),
        }
      },
    )
  },

  getLostSales(_args, result) {
    if (!isRecord(result)) return null
    const events = Array.isArray(result.events) ? result.events.filter(isRecord) : []
    const sorted = [...events].sort(
      (a, b) => num(b.estimatedLostRevenue) - num(a.estimatedLostRevenue),
    )
    return tableOf(
      "Lost sales",
      [
        { key: "item", label: "Item" },
        { key: "gap", label: "Gap" },
        { key: "days", label: "Days", numeric: true },
        { key: "lost", label: "Est. lost", numeric: true },
      ],
      sorted,
      (r) => ({
        item: text(r.itemName),
        gap: `${dayAxis(text(r.gapStart))} – ${dayAxis(text(r.gapEnd))}`,
        days: countOf(num(r.gapDays)),
        lost: money(num(r.estimatedLostRevenue)),
      }),
    )
  },

  getWasteRootCauses(_args, result) {
    const rows = asRows(result)
    const sorted = [...rows].sort(
      (a, b) => num(b.annualizedDollarExposure) - num(a.annualizedDollarExposure),
    )
    return tableOf(
      "Waste exposure",
      [
        { key: "ingredient", label: "Ingredient" },
        { key: "label", label: "Pattern" },
        { key: "exposure", label: "Annualised", numeric: true },
      ],
      sorted,
      (r) => {
        const exposure = numOrNull(r.annualizedDollarExposure)
        return {
          ingredient: text(r.ingredientName),
          // The label is a PATTERN, never an accusation. It is printed as the
          // tool wrote it so the prose and the table cannot diverge on it.
          label: text(r.label),
          exposure: exposure === null ? "—" : money(exposure),
        }
      },
    )
  },

  rankRecipes(_args, result) {
    const rows = asRows(result)
    return tableOf(
      "Recipes",
      [
        { key: "item", label: "Item" },
        { key: "cost", label: "Cost", numeric: true },
        { key: "price", label: "Price", numeric: true },
        { key: "margin", label: "Margin", numeric: true },
      ],
      rows,
      (r) => ({
        item: text(r.itemName),
        cost: r.recipeCost === null ? "—" : money(num(r.recipeCost)),
        price: r.avgSellingPrice === null ? "—" : money(num(r.avgSellingPrice)),
        // Already multiplied by 100 in the tool.
        margin: pct(numOrNull(r.marginPct), { scaled: true }),
      }),
    )
  },

  getRatings(_args, result) {
    if (!isRecord(result)) return null
    if (result.view === "summary") {
      const summary = isRecord(result.summary) ? result.summary : null
      if (!summary) return null
      const dist = Array.isArray(summary.distribution) ? summary.distribution : []
      if (dist.length !== 5) return null
      /*
       * The DISTRIBUTION, not the mean. "4.6 stars" is one number and it
       * hides the only thing an owner can act on: whether that is everyone
       * agreeing, or most at five and a tail at one. The tail is the
       * complaint list.
       */
      return {
        kind: "chart",
        title: "Star ratings",
        fmt: "count",
        spec: {
          type: "bars",
          labels: ["1★", "2★", "3★", "4★", "5★"],
          series: [{ name: "Reviews", color: INK, data: dist.map(num) }],
          zero: true,
        },
      }
    }
    const reviews = Array.isArray(result.reviews) ? result.reviews.filter(isRecord) : []
    return tableOf(
      "Recent reviews",
      [
        { key: "date", label: "Date" },
        { key: "rating", label: "Stars", numeric: true },
        { key: "platform", label: "Platform" },
        { key: "review", label: "Review" },
      ],
      reviews,
      (r) => {
        const body = text(r.reviewText)
        return {
          date: dayAxis(text(r.reviewedAt)),
          rating: countOf(num(r.rating)),
          platform: platformLabel(text(r.platform)),
          // A rating with no words is a rating with no words; say so rather
          // than printing an empty cell that reads as a load failure.
          review: body ? (body.length > 140 ? `${body.slice(0, 139)}…` : body) : "(no text)",
        }
      },
    )
  },

  getAlerts(_args, result) {
    if (!isRecord(result)) return null
    const alerts = Array.isArray(result.alerts) ? result.alerts.filter(isRecord) : []
    return tableOf(
      "Alerts",
      [
        { key: "severity", label: "Severity" },
        { key: "title", label: "What" },
        { key: "store", label: "Store" },
        { key: "date", label: "Date" },
      ],
      alerts,
      (r) => ({
        severity: text(r.severity),
        title: text(r.title),
        store: text(r.storeName),
        date: dayAxis(text(r.occurredOn)),
      }),
    )
  },

  getForecastQuality(_args, result) {
    if (!isRecord(result)) return null
    const rows = Array.isArray(result.evaluations)
      ? result.evaluations.filter(isRecord)
      : []
    return tableOf(
      "Forecast accuracy",
      [
        { key: "store", label: "Store" },
        { key: "target", label: "Forecast" },
        { key: "wape", label: "WAPE", numeric: true },
        { key: "baseline", label: "Baseline", numeric: true },
        { key: "sample", label: "Days", numeric: true },
      ],
      rows,
      (r) => ({
        store: text(r.storeName),
        target: text(r.target),
        // WAPE is a fraction, so `pct` scales it. The baseline sits beside it
        // because the number alone means nothing: 12% is good against a 20%
        // baseline and embarrassing against an 8% one.
        wape: pct(numOrNull(r.wape)),
        baseline: pct(numOrNull(r.baselineWape)),
        sample: countOf(num(r.sampleSize)),
      }),
    )
  },
} satisfies Record<ShowableTool, Builder>

/**
 * The picture for one tool call, or null when it has none.
 *
 * Never throws into a turn: a builder that trips over an unexpected row shape
 * costs the answer its chart, not its answer. That is the same bargain
 * `asOfForTool` makes, and for the same reason — every one of these is a
 * decoration on a number that is already correct.
 */
export function presentFor(toolName: string, args: unknown, result: unknown): Presentation | null {
  const build = (BUILDERS as Record<string, Builder | undefined>)[toolName]
  if (!build) return null
  try {
    return build(args, result)
  } catch {
    return null
  }
}
