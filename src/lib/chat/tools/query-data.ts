import { z } from "zod"
import { Prisma } from "@/generated/prisma/client"
import { dateRangeSchema, parseDateRange, resolveStoreIds, ymd } from "./_shared"
import type { ChatTool } from "./types"

/**
 * THE LOOK-IT-UP-ANYWAY TOOL.
 *
 * For the long tail of questions no dedicated lookup answers — "how many
 * orders asked for no onions last month", "which vendor sent the most
 * invoices in October", "list every 1-star review that mentions fries" — the
 * model can count, list and group rows from a fixed set of datasets.
 *
 * It does NOT write SQL. The model picks a dataset, columns, filters, groups
 * and aggregates from allowlists defined in this file, and the query is built
 * here from those names and bound parameters. So, by construction:
 *
 * - **Tenancy.** Every dataset carries its own account filter, always ANDed
 *   in with `ctx.accountId`. There is no way to name another account.
 * - **No personal data.** Only the columns listed below exist. Customer
 *   names, emails, phones, addresses, PINs, photos, invoice PDFs and raw
 *   extraction text are not in any dataset. Crew appear as first name and
 *   last initial, as on the Checks page.
 * - **Read-only.** The statement runs in a READ ONLY transaction with a 5 s
 *   statement timeout, on top of being a SELECT built from allowlists.
 * - **Small.** At most 200 rows come back; big datasets need a date range of
 *   at most 93 days.
 * - **Numbers match the pages.** A SUM or AVG over a money column is refused:
 *   sales, food cost, labour, commission and P&L totals carry rules (tax,
 *   discounts, missing days, commission rates) that only the dedicated
 *   lookups apply, so a raw sum here would print a second, different figure.
 *   Counting rows, listing real row values and MIN/MAX are allowed.
 */

type ColType = "text" | "number" | "date" | "bool"

interface Column {
  sql: string
  type: ColType
  about: string
  /** A dollar column: no SUM or AVG over it (see the module note). */
  money?: boolean
}

interface Dataset {
  about: string
  from: string
  /** The account filter, compared with a bound `accountId`. */
  account: string
  /** Store id expression for `storeIds`, when the dataset has stores. */
  store?: string
  /** Day expression for `dateRange`. */
  date?: string
  /** True for datasets too large to read without a date range. */
  needsRange?: boolean
  columns: Record<string, Column>
  /** Default columns for a plain listing. */
  list: string[]
}

const shortName = (first: string, last: string) =>
  `CASE WHEN coalesce(${last}, '') = '' THEN ${first} ELSE ${first} || ' ' || upper(left(${last}, 1)) || '.' END`

const dayCols = (expr: string): Record<string, Column> => ({
  day: { sql: `to_char(${expr}, 'YYYY-MM-DD')`, type: "date", about: "calendar day" },
  week: { sql: `to_char(date_trunc('week', ${expr}), 'YYYY-MM-DD')`, type: "date", about: "Monday of the week" },
  month: { sql: `to_char(${expr}, 'YYYY-MM')`, type: "text", about: "YYYY-MM" },
  weekday: { sql: `trim(to_char(${expr}, 'Day'))`, type: "text", about: "Monday … Sunday" },
})

const STORE: Column = { sql: `s."name"`, type: "text", about: "store name" }

export const DATASETS = {
  orders: {
    about: "One row per delivery/online/in-store order from Otter.",
    from: `"OtterOrder" o JOIN "Store" s ON s."id" = o."storeId"`,
    account: `s."accountId"`,
    store: `o."storeId"`,
    date: `o."referenceTimeLocal"::date`,
    needsRange: true,
    columns: {
      store: STORE,
      ...dayCols(`o."referenceTimeLocal"`),
      hour: { sql: `extract(hour from o."referenceTimeLocal")::int`, type: "number", about: "hour of day, local" },
      orderNumber: { sql: `o."externalDisplayId"`, type: "text", about: "platform order number" },
      platform: { sql: `o."platform"`, type: "text", about: "doordash, ubereats, grubhub, website…" },
      fulfillment: { sql: `o."fulfillmentMode"`, type: "text", about: "delivery or pickup" },
      status: { sql: `o."orderStatus"`, type: "text", about: "order status" },
      subtotal: { sql: `o."subtotal"`, type: "number", money: true, about: "$" },
      discount: { sql: `o."discount"`, type: "number", money: true, about: "$" },
      tip: { sql: `o."tip"`, type: "number", money: true, about: "$" },
      total: { sql: `o."total"`, type: "number", money: true, about: "$" },
    },
    list: ["store", "day", "hour", "orderNumber", "platform", "fulfillment", "total"],
  },
  order_items: {
    about: "One row per item on an order.",
    from: `"OtterOrderItem" i JOIN "OtterOrder" o ON o."id" = i."orderId" JOIN "Store" s ON s."id" = o."storeId"`,
    account: `s."accountId"`,
    store: `o."storeId"`,
    date: `o."referenceTimeLocal"::date`,
    needsRange: true,
    columns: {
      store: STORE,
      ...dayCols(`o."referenceTimeLocal"`),
      hour: { sql: `extract(hour from o."referenceTimeLocal")::int`, type: "number", about: "hour of day, local" },
      orderNumber: { sql: `o."externalDisplayId"`, type: "text", about: "platform order number" },
      platform: { sql: `o."platform"`, type: "text", about: "platform" },
      item: { sql: `i."name"`, type: "text", about: "menu item as ordered" },
      quantity: { sql: `i."quantity"`, type: "number", about: "count" },
      price: { sql: `i."price"`, type: "number", money: true, about: "$ line price" },
    },
    list: ["store", "day", "orderNumber", "platform", "item", "quantity", "price"],
  },
  order_modifiers: {
    about: "One row per modifier on an ordered item (\"No onions\", \"Add cheese\", sauce choices).",
    from: `"OtterOrderSubItem" m JOIN "OtterOrderItem" i ON i."id" = m."orderItemId" JOIN "OtterOrder" o ON o."id" = i."orderId" JOIN "Store" s ON s."id" = o."storeId"`,
    account: `s."accountId"`,
    store: `o."storeId"`,
    date: `o."referenceTimeLocal"::date`,
    needsRange: true,
    columns: {
      store: STORE,
      ...dayCols(`o."referenceTimeLocal"`),
      platform: { sql: `o."platform"`, type: "text", about: "platform" },
      item: { sql: `i."name"`, type: "text", about: "the item it modifies" },
      modifier: { sql: `m."name"`, type: "text", about: "the modifier" },
      group: { sql: `m."subHeader"`, type: "text", about: "modifier group heading" },
      quantity: { sql: `m."quantity"`, type: "number", about: "count" },
      price: { sql: `m."price"`, type: "number", money: true, about: "$ charged for it" },
    },
    list: ["store", "day", "item", "modifier", "quantity", "price"],
  },
  menu_item_sales: {
    about: "Items sold per store per day from Otter's menu report, first- and third-party combined.",
    from: `"OtterMenuItem" mi JOIN "Store" s ON s."id" = mi."storeId"`,
    account: `s."accountId"`,
    store: `mi."storeId"`,
    date: `mi."date"`,
    needsRange: true,
    columns: {
      store: STORE,
      ...dayCols(`mi."date"`),
      category: { sql: `mi."category"`, type: "text", about: "menu category" },
      item: { sql: `mi."itemName"`, type: "text", about: "menu item" },
      isModifier: { sql: `mi."isModifier"`, type: "bool", about: "true for modifiers" },
      quantitySold: { sql: `(mi."fpQuantitySold" + mi."tpQuantitySold")`, type: "number", about: "units sold" },
      sales: { sql: `(mi."fpTotalSales" + mi."tpTotalSales")`, type: "number", money: true, about: "$ item sales" },
    },
    list: ["store", "day", "category", "item", "quantitySold"],
  },
  invoices: {
    about: "One row per supplier invoice.",
    from: `"Invoice" v LEFT JOIN "Store" s ON s."id" = v."storeId"`,
    account: `v."accountId"`,
    store: `v."storeId"`,
    date: `v."invoiceDate"::date`,
    columns: {
      store: STORE,
      ...dayCols(`v."invoiceDate"`),
      vendor: { sql: `v."vendorName"`, type: "text", about: "vendor" },
      invoiceNumber: { sql: `v."invoiceNumber"`, type: "text", about: "invoice number" },
      dueDate: { sql: `to_char(v."dueDate", 'YYYY-MM-DD')`, type: "date", about: "due date" },
      total: { sql: `v."totalAmount"`, type: "number", money: true, about: "$ invoice total" },
      status: { sql: `v."status"::text`, type: "text", about: "invoice status" },
      isReturn: { sql: `v."isReturn"`, type: "bool", about: "credit / return" },
    },
    list: ["store", "day", "vendor", "invoiceNumber", "total", "status"],
  },
  invoice_lines: {
    about: "One row per line on a supplier invoice.",
    from: `"InvoiceLineItem" l JOIN "Invoice" v ON v."id" = l."invoiceId" LEFT JOIN "Store" s ON s."id" = v."storeId" LEFT JOIN "CanonicalIngredient" ci ON ci."id" = l."canonicalIngredientId"`,
    account: `v."accountId"`,
    store: `v."storeId"`,
    date: `v."invoiceDate"::date`,
    columns: {
      store: STORE,
      ...dayCols(`v."invoiceDate"`),
      vendor: { sql: `v."vendorName"`, type: "text", about: "vendor" },
      invoiceNumber: { sql: `v."invoiceNumber"`, type: "text", about: "invoice number" },
      product: { sql: `l."productName"`, type: "text", about: "product as printed" },
      category: { sql: `l."category"`, type: "text", about: "line category" },
      ingredient: { sql: `ci."name"`, type: "text", about: "linked ingredient, null if unlinked" },
      quantity: { sql: `l."quantity"`, type: "number", about: "quantity" },
      unit: { sql: `l."unit"`, type: "text", about: "unit" },
      unitPrice: { sql: `l."unitPrice"`, type: "number", money: true, about: "$ per unit" },
      lineTotal: { sql: `l."extendedPrice"`, type: "number", money: true, about: "$ line total" },
    },
    list: ["store", "day", "vendor", "product", "quantity", "unit", "unitPrice", "lineTotal"],
  },
  ratings: {
    about: "Guest ratings and review text from the delivery platforms.",
    from: `"OtterRating" r JOIN "Store" s ON s."id" = r."storeId"`,
    account: `s."accountId"`,
    store: `r."storeId"`,
    date: `r."reviewedAt"::date`,
    columns: {
      store: STORE,
      ...dayCols(`r."reviewedAt"`),
      platform: { sql: `r."platform"`, type: "text", about: "platform" },
      stars: { sql: `r."rating"`, type: "number", about: "1 to 5" },
      review: { sql: `r."reviewText"`, type: "text", about: "what the guest wrote" },
      items: { sql: `r."orderItemNames"`, type: "text", about: "items on the order" },
    },
    list: ["store", "day", "platform", "stars", "review", "items"],
  },
  alerts: {
    about: "The alert inbox: anomalies, price jumps, labour variance and more.",
    from: `"Alert" a JOIN "Store" s ON s."id" = a."storeId"`,
    account: `s."accountId"`,
    store: `a."storeId"`,
    date: `a."occurredOn"::date`,
    columns: {
      store: STORE,
      ...dayCols(`a."occurredOn"`),
      source: { sql: `a."source"::text`, type: "text", about: "detector" },
      severity: { sql: `a."severity"::text`, type: "text", about: "severity" },
      status: { sql: `a."status"::text`, type: "text", about: "open, acknowledged…" },
      title: { sql: `a."title"`, type: "text", about: "headline" },
      detail: { sql: `a."body"`, type: "text", about: "detail" },
    },
    list: ["store", "day", "severity", "status", "title"],
  },
  timekeeping: {
    about: "Harri clock-in/out alerts: early in, late out, missed breaks and punches.",
    from: `"HarriTimekeepingAlert" t JOIN "Store" s ON s."id" = t."storeId" LEFT JOIN "HarriEmployee" e ON e."storeId" = t."storeId" AND e."userId" = t."userId"`,
    account: `s."accountId"`,
    store: `t."storeId"`,
    date: `t."date"`,
    columns: {
      store: STORE,
      ...dayCols(`t."date"`),
      person: { sql: shortName(`e."firstName"`, `e."lastName"`), type: "text", about: "first name, last initial" },
      position: { sql: `coalesce(t."positionName", t."positionCode")`, type: "text", about: "position" },
      alert: { sql: `t."alertCode"`, type: "text", about: "Harri alert code" },
      minutesOff: { sql: `round(coalesce(t."timeDiffSec", 0) / 60.0)::int`, type: "number", about: "minutes early or late" },
    },
    list: ["store", "day", "person", "position", "alert", "minutesOff"],
  },
  check_submissions: {
    about: "Store cleaning checks as submitted by the crew.",
    from: `"CheckSubmission" c JOIN "Store" s ON s."id" = c."storeId"`,
    account: `s."accountId"`,
    store: `c."storeId"`,
    date: `c."businessDate"`,
    columns: {
      store: STORE,
      ...dayCols(`c."businessDate"`),
      check: { sql: `c."kind"::text`, type: "text", about: "MORNING, TRANSITION, EVENING" },
      crew: { sql: shortName(`split_part(c."crewName", ' ', 1)`, `nullif(split_part(c."crewName", ' ', 2), '')`), type: "text", about: "who submitted" },
      lateMinutes: { sql: `c."lateMinutes"`, type: "number", about: "minutes past due, 0 if on time" },
      flagged: { sql: `c."flaggedCount"`, type: "number", about: "items flagged" },
    },
    list: ["store", "day", "check", "crew", "lateMinutes", "flagged"],
  },
  waste_log: {
    about: "Waste, theft, returns and other stock written off, as logged on the phone.",
    from: `"InventoryAdjustment" ad JOIN "Store" s ON s."id" = ad."storeId" JOIN "CanonicalIngredient" ci ON ci."id" = ad."canonicalIngredientId"`,
    account: `s."accountId"`,
    store: `ad."storeId"`,
    date: `ad."occurredAt"::date`,
    columns: {
      store: STORE,
      ...dayCols(`ad."occurredAt"`),
      ingredient: { sql: `ci."name"`, type: "text", about: "ingredient" },
      quantity: { sql: `ad."qty"`, type: "number", about: "in the recipe unit" },
      unit: { sql: `ci."recipeUnit"`, type: "text", about: "recipe unit" },
      reason: { sql: `ad."reason"::text`, type: "text", about: "why" },
      note: { sql: `ad."note"`, type: "text", about: "note" },
    },
    list: ["store", "day", "ingredient", "quantity", "unit", "reason"],
  },
} satisfies Record<string, Dataset>

export type DatasetName = keyof typeof DATASETS
const DATASET_NAMES = Object.keys(DATASETS) as [DatasetName, ...DatasetName[]]

const MAX_ROWS = 200
const MAX_RANGE_DAYS = 93

const scalar = z.union([z.string(), z.number(), z.boolean()])
const params = z
  .object({
    dataset: z.enum(DATASET_NAMES).describe("Which dataset. describeSchema with domain 'explore' lists each one's columns."),
    columns: z.array(z.string()).max(12).optional().describe("Columns to list. Ignored when aggregates are given (use groupBy)."),
    groupBy: z.array(z.string()).max(4).optional().describe("Columns to group by, e.g. ['item'] or ['store','week']."),
    aggregates: z
      .array(
        z
          .object({
            fn: z.enum(["count", "countDistinct", "sum", "avg", "min", "max"]),
            column: z.string().optional().describe("Omit for count of rows."),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    filters: z
      .array(
        z
          .object({
            column: z.string(),
            op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "isNull", "notNull"]),
            value: z.union([scalar, z.array(scalar).max(50)]).optional(),
          })
          .strict(),
      )
      .max(8)
      .optional()
      .describe("'contains' is case-insensitive text match."),
    storeIds: z.array(z.string().min(1)).optional().describe("Store ids from listStores. Omit for every store."),
    dateRange: dateRangeSchema.optional().describe("Inclusive YYYY-MM-DD. Required for orders, order_items, order_modifiers and menu_item_sales; at most 93 days."),
    orderBy: z
      .array(z.object({ column: z.string(), dir: z.enum(["asc", "desc"]).optional() }).strict())
      .max(3)
      .optional()
      .describe("A column, or an aggregate alias such as count, sum_quantity, max_total."),
    limit: z.number().int().min(1).max(MAX_ROWS).optional().describe("Rows to return, default 50, at most 200."),
  })
  .strict()

export type QueryDataResult = {
  dataset: DatasetName
  rows: Array<Record<string, string | number | boolean | null>>
  /** True when more rows matched than were returned. */
  truncated: boolean
  note: string
}

function col(ds: Dataset, name: string): Column {
  const c = ds.columns[name]
  if (!c) throw new Error(`unknown column "${name}" for this dataset; columns: ${Object.keys(ds.columns).join(", ")}`)
  return c
}

const aliasOf = (fn: string, column?: string) => (column ? `${fn}_${column}` : fn)

function filterSql(ds: Dataset, f: z.infer<typeof params>["filters"] extends (infer T)[] | undefined ? T : never): Prisma.Sql {
  const c = col(ds, f.column)
  const expr = Prisma.raw(c.sql)
  const need = () => {
    if (f.value === undefined || Array.isArray(f.value)) throw new Error(`filter on ${f.column} with ${f.op} needs one value`)
    return f.value
  }
  switch (f.op) {
    case "isNull":
      return Prisma.sql`${expr} IS NULL`
    case "notNull":
      return Prisma.sql`${expr} IS NOT NULL`
    case "contains":
      return Prisma.sql`strpos(lower(${expr}::text), lower(${String(need())})) > 0`
    case "in": {
      const vals = Array.isArray(f.value) ? f.value : f.value === undefined ? [] : [f.value]
      if (vals.length === 0) throw new Error(`filter on ${f.column} with in needs values`)
      return Prisma.sql`${expr} IN (${Prisma.join(vals)})`
    }
    default: {
      const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.op]
      return Prisma.sql`${expr} ${Prisma.raw(op)} ${need()}`
    }
  }
}

/** Build the statement. Exported for tests: every identifier in it comes from `DATASETS`. */
export function buildQuery(
  args: z.infer<typeof params>,
  scope: { accountId: string; storeIds: string[] | null; from: Date | null; to: Date | null },
): Prisma.Sql {
  const ds: Dataset = DATASETS[args.dataset]
  const aggs = args.aggregates ?? []
  const groups = args.groupBy ?? []

  const select: Prisma.Sql[] = []
  const aliases = new Set<string>()
  if (aggs.length > 0) {
    for (const g of groups) {
      select.push(Prisma.sql`${Prisma.raw(col(ds, g).sql)} AS ${Prisma.raw(`"${g}"`)}`)
      aliases.add(g)
    }
    for (const a of aggs) {
      const alias = aliasOf(a.fn, a.column)
      aliases.add(alias)
      if (!a.column) {
        if (a.fn !== "count") throw new Error(`${a.fn} needs a column`)
        select.push(Prisma.sql`count(*)::int AS ${Prisma.raw(`"${alias}"`)}`)
        continue
      }
      const c = col(ds, a.column)
      if (c.money && (a.fn === "sum" || a.fn === "avg")) {
        throw new Error(
          `refused: ${a.fn} of ${a.column} is a money total. Use the dedicated lookup (getDailySales, getPlatformBreakdown, getInvoiceSpend, sumInvoiceLines, getPnlSummary, getLaborActuals) so the figure matches the dashboard.`,
        )
      }
      if ((a.fn === "sum" || a.fn === "avg") && c.type !== "number") throw new Error(`${a.fn} needs a number column`)
      const e = Prisma.raw(c.sql)
      const sql =
        a.fn === "count" ? Prisma.sql`count(${e})::int`
        : a.fn === "countDistinct" ? Prisma.sql`count(DISTINCT ${e})::int`
        : a.fn === "sum" ? Prisma.sql`sum(${e})::float8`
        : a.fn === "avg" ? Prisma.sql`avg(${e})::float8`
        : a.fn === "min" ? Prisma.sql`min(${e})`
        : Prisma.sql`max(${e})`
      select.push(Prisma.sql`${sql} AS ${Prisma.raw(`"${alias}"`)}`)
    }
  } else {
    const names = args.columns && args.columns.length > 0 ? args.columns : ds.list
    for (const n of names) {
      select.push(Prisma.sql`${Prisma.raw(col(ds, n).sql)} AS ${Prisma.raw(`"${n}"`)}`)
      aliases.add(n)
    }
  }

  const where: Prisma.Sql[] = [Prisma.sql`${Prisma.raw(ds.account)} = ${scope.accountId}`]
  if (scope.storeIds && ds.store) where.push(Prisma.sql`${Prisma.raw(ds.store)} IN (${Prisma.join(scope.storeIds)})`)
  if (scope.from && scope.to && ds.date) {
    where.push(Prisma.sql`${Prisma.raw(ds.date)} BETWEEN ${scope.from}::date AND ${scope.to}::date`)
  }
  for (const f of args.filters ?? []) where.push(filterSql(ds, f))

  const order: Prisma.Sql[] = []
  for (const o of args.orderBy ?? []) {
    if (!aliases.has(o.column)) throw new Error(`orderBy "${o.column}" must be one of the selected columns or aggregates: ${[...aliases].join(", ")}`)
    order.push(Prisma.sql`${Prisma.raw(`"${o.column}"`)} ${Prisma.raw(o.dir === "asc" ? "ASC" : "DESC")} NULLS LAST`)
  }

  const limit = Math.min(args.limit ?? 50, MAX_ROWS) + 1
  return Prisma.sql`SELECT ${Prisma.join(select)} FROM ${Prisma.raw(ds.from)} WHERE ${Prisma.join(where, " AND ")}${
    aggs.length > 0 && groups.length > 0 ? Prisma.sql` GROUP BY ${Prisma.join(groups.map((g) => Prisma.raw(col(ds, g).sql)))}` : Prisma.empty
  }${order.length > 0 ? Prisma.sql` ORDER BY ${Prisma.join(order)}` : Prisma.empty} LIMIT ${limit}`
}

function plain(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "bigint") return Number(v)
  if (v instanceof Date) return ymd(v)
  if (typeof v === "number") return Math.round(v * 100) / 100
  if (typeof v === "string" || typeof v === "boolean") return v
  if (typeof v === "object" && "toNumber" in (v as object)) return Number((v as { toNumber: () => number }).toNumber())
  return String(v)
}

/** The dataset catalogue describeSchema prints for domain "explore". */
export function datasetCatalog(): Array<{ dataset: string; about: string; columns: string; needsDateRange: boolean }> {
  return (Object.entries(DATASETS) as Array<[string, Dataset]>).map(([name, ds]) => ({
    dataset: name,
    about: ds.about,
    columns: Object.entries(ds.columns)
      .map(([c, def]) => `${c}${def.money ? " ($)" : ""}`)
      .join(", "),
    needsDateRange: Boolean(ds.needsRange),
  }))
}

export const queryData: ChatTool<typeof params, QueryDataResult> = {
  name: "queryData",
  description:
    "Fallback for questions no other lookup answers: count, list or group raw rows from a fixed dataset (orders, order_items, order_modifiers, menu_item_sales, invoices, invoice_lines, ratings, alerts, timekeeping, check_submissions, waste_log). Call describeSchema with domain 'explore' first for the columns. Good for 'how many orders asked for no onions', 'which vendor sent the most invoices', 'list the 1-star reviews that mention fries'. Refuses sum/avg of dollar columns: sales, food cost, labour, commission and P&L totals must come from their own lookups. Never the first choice when a dedicated lookup exists.",
  parameters: params,
  async execute(args, ctx) {
    const ds: Dataset = DATASETS[args.dataset]
    const storeIds = args.storeIds ? await resolveStoreIds(ctx, args.storeIds) : null
    let from: Date | null = null
    let to: Date | null = null
    if (args.dateRange) {
      ;({ from, to } = parseDateRange(args.dateRange))
      if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS - 1) {
        throw new Error(`dateRange is limited to ${MAX_RANGE_DAYS} days`)
      }
    } else if (ds.needsRange) {
      throw new Error(`${args.dataset} needs a dateRange (at most ${MAX_RANGE_DAYS} days)`)
    }

    const sql = buildQuery(args, { accountId: ctx.accountId, storeIds, from, to })
    const raw = await ctx.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 5000")
      return tx.$queryRaw<Array<Record<string, unknown>>>(sql)
    })

    const limit = Math.min(args.limit ?? 50, MAX_ROWS)
    return {
      dataset: args.dataset,
      rows: raw.slice(0, limit).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]))),
      truncated: raw.length > limit,
      note:
        "Raw rows, not a dashboard figure. Quote counts and listed values as found; say the answer came from a raw lookup. " +
        "Dollar values are row values (an order's total, a line's price), never a reconciled sales or cost figure.",
    }
  },
}
