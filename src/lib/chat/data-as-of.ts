import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import type { ChatToolName } from "./tools"

/**
 * WHEN THE NUMBERS IN AN ANSWER WERE LAST REFRESHED.
 *
 * ## Why
 *
 * "No answer says when its data is from" is one of the four pieces of debt the
 * Ask proposal names, and it is the one that quietly costs the most: Otter
 * backfills closed windows, so a dollar figure moves within hours of being
 * read. An answer that carries the tool names it read, and not the moment
 * those tables were last written, cannot be checked and cannot be cached —
 * the answer cache keys on exactly this.
 *
 * ## What it measures
 *
 * The freshness of the DATA, not of the request. `MAX(syncedAt)` on the table
 * behind the tool, which moves when the sync writes and stands still when it
 * does not — so a stalled cron shows as an old `asOf` rather than a fresh one.
 * That is the same reading `src/lib/monitoring/staleness.ts` takes for the
 * staleness cron; this is the per-tool half of it, and the two must not
 * disagree about what a table's freshness column is.
 *
 * A tool with no entry in `TOOL_AS_OF` reports no `asOf`, and that is honest
 * rather than missing: `listStores` and `describeSchema` read structure, and
 * `simulatePriceChange` computes rather than reads. The proposal's rule for
 * the cache follows from it — a tool without an `asOf` is excluded from
 * caching until it has one.
 */

export type AsOfSource =
  | "otterDaily"
  | "otterHourly"
  | "otterOrders"
  | "invoices"
  | "cogs"
  | "forecasts"
  | "forecastEval"
  | "labor"
  | "ratings"
  | "alerts"
  | "storeSettings"

/**
 * Table and freshness column per source. Module constants, never request
 * input — which is what makes the `Prisma.raw` interpolation below safe, the
 * same argument the staleness cron makes for the same query shape.
 */
type SourceTable = { table: string; column: string }

const SOURCE_TABLES: Record<AsOfSource, SourceTable | readonly SourceTable[]> = {
  otterDaily: { table: "OtterDailySummary", column: "syncedAt" },
  otterHourly: { table: "OtterHourlySummary", column: "updatedAt" },
  otterOrders: { table: "OtterOrder", column: "syncedAt" },
  invoices: { table: "Invoice", column: "updatedAt" },
  cogs: { table: "DailyCogsItem", column: "computedAt" },
  forecasts: { table: "ForecastDailyRevenue", column: "generatedAt" },
  // The backtest is written by its own pass, not by the forecast write, so a
  // pipeline that still emits predictions while evaluation has stopped shows
  // as a stale accuracy stamp rather than a fresh one.
  forecastEval: { table: "MlForecastEvaluation", column: "computedAt" },
  labor: { table: "HarriDailyLabor", column: "syncedAt" },
  ratings: { table: "OtterRating", column: "syncedAt" },
  // `detectedAt`, not `occurredAt`: the question is when the inbox was last
  // written, and an alert about last Tuesday can be raised tonight.
  alerts: { table: "Alert", column: "detectedAt" },
  // What the owner typed into store settings: the `Store` row (rent, labor,
  // towels, cleaning, commission rates, payroll tax, COGS target) and its
  // fixed-expense lines. Edited by hand, so the newest `updatedAt` across the
  // two is the stamp. Both tables hold a handful of rows per account. A
  // deleted expense line touches its store's row (`fixed-expense-actions`),
  // so a delete moves this stamp too.
  storeSettings: [
    { table: "Store", column: "updatedAt" },
    { table: "StoreFixedExpense", column: "updatedAt" },
  ],
}

/**
 * Which table's freshness a tool's answer actually depends on.
 *
 * Read as: "if this number were wrong because data was stale, which sync
 * would be the reason?" `getCogsByItem` reads the COGS sweep's output, so it
 * is `cogs` and not `otterDaily`, even though the sweep is downstream of
 * Otter — naming the nearest table is what makes the stamp checkable.
 *
 * Absent on purpose: `listStores`, `describeSchema`, `fileReturn` (structure
 * and presentation, no figures), `simulatePriceChange` and
 * `getMenuItemElasticity` (a model over data already stamped by its inputs),
 * and the menu/recipe/ingredient catalogue tools, which are edited by hand
 * rather than synced and so have no refresh moment to report.
 */
export const TOOL_AS_OF: Partial<Record<ChatToolName, AsOfSource | readonly AsOfSource[]>> = {
  // Sales — the daily rollup, except the hour-of-day view.
  getDailySales: "otterDaily",
  compareSales: "otterDaily",
  getPlatformBreakdown: "otterDaily",
  getStoreBreakdown: "otterDaily",
  // Fees come from the order rows priced at the store's rates, the same
  // commission function the P&L uses.
  getChannelMix: ["otterDaily", "otterOrders", "storeSettings"],
  getHourlyTrend: "otterHourly",
  // Order-level drilldown reads the order rows themselves.
  getOrderById: "otterOrders",
  listOrdersByDay: "otterOrders",
  getOrderItemFrequency: "otterOrders",
  getRefunds: "otterOrders",
  // Invoices and anything priced off them.
  searchInvoices: "invoices",
  sumInvoiceLines: "invoices",
  getTopInvoices: "invoices",
  getInvoiceSpend: "invoices",
  getInvoiceById: "invoices",
  getIngredientPrices: "invoices",
  getIngredientPrice: "invoices",
  getIngredientPriceHistory: "invoices",
  compareVendorPrices: "invoices",
  // The COGS sweep's own output.
  getCogsByItem: "cogs",
  getMenuMargin: "cogs",
  // P&L stands on the daily rollup, the COGS sweep, Harri labour and the
  // store settings (fixed costs, expense lines, commission rates). Any one of
  // them moving changes the statement, so the key carries all four — with
  // the rollup alone, a COGS recompute, a Harri sync or a rent edit kept
  // serving the statement from before it.
  getPnlSummary: ["otterDaily", "cogs", "labor", "storeSettings"],
  searchPnlHistory: "otterDaily",
  // Store settings only: rent, fixed lines, rates, COGS target.
  getOperationalCosts: "storeSettings",
  getTopMenuItems: "otterDaily",
  // Labour. `getLaborActuals` is deliberately absent: its labour % and SPLH
  // divide Harri by Otter sales, so either sync can change the answer and a
  // single stamp would keep serving a figure taken before Otter landed.
  getLaborStaffingForecast: "labor",
  // Everything generated by the ML pipeline.
  getRevenueForecast: "forecasts",
  getMenuItemForecast: "forecasts",
  getFoodCostForecast: "forecasts",
  getCashPositionForecast: "forecasts",
  getLostSales: "forecasts",
  getPromoRoi: "forecasts",
  getLaunchTrajectory: "forecasts",
  getMenuEngineering: "forecasts",
  getVendorReliability: "forecasts",
  getWasteRootCauses: "forecasts",
  getForecastQuality: "forecastEval",
  // Added 2026-09-19 with the tools themselves. A tool with no entry here
  // reports no stamp, and `everyToolStamped` then refuses to cache ANY answer
  // that read it -- so an unstamped new tool silently costs a model call on
  // every repeat of every question it touches.
  getRatings: "ratings",
  getAlerts: "alerts",
}

/**
 * The sync job whose last SUCCESS run is the stamp for a source, read from
 * `JobRun` (index `[jobName, startedAt]`) instead of `MAX(col)` over the data
 * table, which has no index on the freshness column (85 ms live) and stays
 * put after a delete-only change.
 *
 * Only sources written by nothing but a job are listed. Absent on purpose:
 * - `invoices`: people edit, approve and move invoices in the app, which
 *   bumps `updatedAt` with no job run; a job stamp would let the answer cache
 *   keep serving figures from before the edit.
 * - `cogs`: `pnl-actions` recomputes `DailyCogsItem` on demand outside the
 *   cron, for the same reason.
 * - `forecasts`, `forecastEval`, `alerts`: no job of their own.
 * These keep the table read below.
 *
 * `ratings` ride on the metrics sync (`otter-metrics-sync.ts` writes them).
 * `otterOrders` is also written by the weekly drain.
 */
const SOURCE_JOBS: Partial<Record<AsOfSource, readonly string[]>> = {
  otterDaily: ["otter.metrics.sync"],
  otterHourly: ["otter.hourly.sync"],
  otterOrders: ["otter.orders.sync", "otter.orders.drain"],
  labor: ["harri-labor-sync"],
  ratings: ["otter.metrics.sync"],
}

/** Newest SUCCESS completion across a source's jobs, or null if none exists. */
async function readFromJobRuns(jobs: readonly string[]): Promise<Date | null> {
  const runs = await Promise.all(
    jobs.map((jobName) =>
      prisma.jobRun.findFirst({
        where: { jobName, status: "SUCCESS", completedAt: { not: null } },
        orderBy: { startedAt: "desc" },
        select: { completedAt: true },
      }),
    ),
  )
  return runs.reduce<Date | null>(
    (acc, r) => (r?.completedAt && (!acc || r.completedAt > acc) ? r.completedAt : acc),
    null,
  )
}

/**
 * One read per source, memoised for the life of a turn and a little beyond.
 *
 * The syncs run every four hours at best, so a reading minutes old is the
 * same reading. The TTL exists to keep several tools in one turn — and the
 * turns behind one reader — off the same seven queries.
 */
const TTL_MS = 5 * 60_000
const cache = new Map<AsOfSource, { at: number; value: Date | null }>()
const inflight = new Map<AsOfSource, Promise<Date | null>>()

/** `MAX(col)` over one table, or the newest across several (`GREATEST` ignores nulls). */
function maxSql(tables: readonly SourceTable[]): Prisma.Sql {
  const one = ({ table, column }: SourceTable) =>
    Prisma.sql`SELECT MAX(${Prisma.raw(`"${column}"`)}) AS max FROM ${Prisma.raw(`"${table}"`)}`
  if (tables.length === 1) return one(tables[0])
  return Prisma.sql`SELECT GREATEST(${Prisma.join(
    tables.map((t) => Prisma.sql`(${one(t)})`),
  )}) AS max`
}

/** A tool's sources as a list. */
function sourcesOf(toolName: string): readonly AsOfSource[] {
  const s = TOOL_AS_OF[toolName as ChatToolName]
  if (!s) return []
  return typeof s === "string" ? [s] : s
}

async function readSource(source: AsOfSource): Promise<Date | null> {
  const hit = cache.get(source)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value

  const existing = inflight.get(source)
  if (existing) return existing

  const def = SOURCE_TABLES[source]
  const tables: readonly SourceTable[] = Array.isArray(def) ? def : [def as SourceTable]
  const jobs = SOURCE_JOBS[source]
  const p = (async () => {
    try {
      // A fresh database, or a retention sweep that emptied `JobRun`, has no
      // SUCCESS run: fall through to the table so the stamp is what it was.
      const fromJobs = jobs ? await readFromJobRuns(jobs) : null
      if (fromJobs) {
        cache.set(source, { at: Date.now(), value: fromJobs })
        return fromJobs
      }
      const rows = await prisma.$queryRaw<{ max: Date | null }[]>(maxSql(tables))
      const value = rows[0]?.max ?? null
      cache.set(source, { at: Date.now(), value })
      return value
    } catch (err) {
      // A missing stamp is a smaller problem than a failed answer, so this
      // never throws into the turn.
      logger.warn(`[chat] asOf read failed for ${source}`, err)
      return null
    } finally {
      inflight.delete(source)
    }
  })()
  inflight.set(source, p)
  return p
}

/**
 * The NEWEST stamp across a set of tools — the answer cache's key material.
 *
 * Newest rather than oldest on purpose: the question the key has to answer is
 * "has anything these tools read been rewritten since?", and any one table
 * moving is enough to invalidate. An oldest-wins key would hold a stale answer
 * for as long as the least-synced table stood still.
 */
export async function maxAsOfForTools(toolNames: readonly string[]): Promise<string | null> {
  const sources = new Set<AsOfSource>()
  for (const n of toolNames) for (const s of sourcesOf(n)) sources.add(s)
  if (sources.size === 0) return null
  const reads = await Promise.all([...sources].map(readSource))
  const newest = reads.reduce<Date | null>(
    (acc, d) => (d && (!acc || d > acc) ? d : acc),
    null,
  )
  return newest ? newest.toISOString() : null
}

/**
 * Whether every tool in a set reports a stamp.
 *
 * The proposal's caching rule, enforced: a tool without an `asOf` has no
 * moment that could invalidate it, so an answer that read one cannot be
 * safely cached at any TTL. Used at store time against the tools the turn
 * ACTUALLY read, not the ones it was offered.
 */
export function everyToolStamped(toolNames: readonly string[]): boolean {
  return toolNames.every(
    (n) => READS_NO_FIGURES.has(n as ChatToolName) || Boolean(TOOL_AS_OF[n as ChatToolName]),
  )
}

/**
 * Tools that read no data at all, so they cannot go stale and must not block
 * an answer from being stored.
 *
 * `fileReturn` is the one that matters: it is how the model FILES the answer
 * (verdict, figures, follow-ups), and it is called on nearly every good turn.
 * Left out of `TOOL_AS_OF` on purpose (above) and checked here as if it were
 * stamped, because before this the two rules met head-on — every answer that
 * filed a return "read an unstamped tool", the write guard in the chat route
 * refused it, and the answer cache held zero entries after a day of turns.
 * The same question, asked again, ran the model every time.
 *
 * `listStores` and `describeSchema` stay out: a store can be added, and an
 * answer that read the store list has a fact that can change without a sync.
 */
const READS_NO_FIGURES: ReadonlySet<ChatToolName> = new Set<ChatToolName>(["fileReturn"])

/**
 * The freshness stamp for one tool, shown to the owner beside its figures, or
 * null when it reports none.
 *
 * Unlike the cache key, this is the OLDEST of the tool's synced sources: a P&L
 * built from Otter (today) and labor (two days old) is only as fresh as its
 * labor. `storeSettings` is left out of the reading when the tool has a synced
 * source too, because a rent edit is not when the figures were last synced; a
 * tool that reads settings alone reports the settings stamp.
 */
export async function asOfForTool(toolName: string): Promise<string | null> {
  const all = sourcesOf(toolName)
  if (all.length === 0) return null
  const synced = all.filter((s) => s !== "storeSettings")
  const sources = synced.length > 0 ? synced : all
  const reads = await Promise.all(sources.map(readSource))
  const known = reads.filter((d): d is Date => d != null)
  if (known.length === 0) return null
  const oldest = known.reduce((acc, d) => (d < acc ? d : acc))
  return oldest.toISOString()
}
