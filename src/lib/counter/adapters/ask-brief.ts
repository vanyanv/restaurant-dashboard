import { prisma } from "@/lib/prisma"
import { cached } from "@/lib/cache/cached"
import { businessCalendarDate, businessQueryDate } from "@/lib/counter/business-date"
import { getShellStatus } from "@/lib/counter/adapters/shell-status"
import { loadPrices } from "@/lib/counter/adapters/prices"
import { classify } from "@/lib/counter/adapters/types"
import { money, unitCost } from "@/lib/counter/format"
import { shortDate } from "@/lib/counter/date-range"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * THE MORNING BRIEF — what an empty Ask opens on.
 *
 * "Ask about Hollywood." over six department cards is a menu, and a menu asks
 * before it gives. The owner has opened this product twice; the first screen
 * has to pay before a question is typed. So an empty Ask now opens on the
 * three things that moved since the last visit, each with its figure and each
 * already phrased as the question the owner would ask next:
 *
 *   Saturday sales   $4,120   −12% vs prior Sat     → Why was Saturday down?
 *   Ground beef      $4.62/lb +$0.42 on Aug 21     → Which recipes does that hit?
 *   Invoices         3 in review                    → Which invoices do not reconcile?
 *
 * Every figure comes from a loader another page already trusts — the same
 * rule as every other figure in `src/lib/counter/`: a number shown on two
 * pages comes from one function. Sales is the `OtterDailySummary` roll-up the
 * chat's `compareSales` reads; the price move is `loadPrices`, which owns the
 * Prices page's movers and its spike guard; invoices in review is the count
 * the Invoices page's `headlineOf` starts from. Nothing here recomputes.
 *
 * `accountId` is the tenancy boundary (`auth-scope.ts`). Every query below
 * filters on it — stores through `store.accountId`, invoices directly, prices
 * inside `loadPrices`.
 *
 * Cached 300s per account and store. Dates cross Redis as ISO strings, never
 * `Date` — see the cache rollout note — so the brief carries `syncedAt` as a
 * string and the client formats it.
 */

export type AskSignalTone = "bad" | "good" | "signal"

export interface AskSignal {
  id: "sales" | "price" | "invoices"
  /** The mono caption over the figure — "Saturday sales". */
  label: string
  /** The figure itself — "$4,120". */
  value: string
  /** What made it a signal — "−12% vs prior Sat". Null when the figure stands alone. */
  delta: string | null
  tone: AskSignalTone
  /** The question the row asks when pressed, verbatim. */
  question: string
}

export interface AskBrief {
  /** Up to three, in the order the field asks its questions: sales, cost, stock. */
  signals: AskSignal[]
  /** The last successful Otter sync, ISO, or null when none is recorded. */
  syncedAt: string | null
}

export interface AskBriefInput {
  accountId: string
  /** One store, or null for every store the account has. */
  storeId: string | null
  today: Date
}

const TTL_SECONDS = 300
/** A day is a signal when it moved this far against the same weekday a week before. */
const SALES_SIGNAL_PCT = 0.08

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/** A local calendar date as the UTC-midnight instant `@db.Date` columns hold. */
function queryDate(local: Date): Date {
  const y = local.getFullYear()
  const m = String(local.getMonth() + 1).padStart(2, "0")
  const d = String(local.getDate()).padStart(2, "0")
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`)
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

async function netSalesOn(storeIds: string[], day: Date): Promise<number | null> {
  const sums = await prisma.otterDailySummary.aggregate({
    where: { storeId: { in: storeIds }, date: queryDate(day) },
    _sum: { fpNetSales: true, tpNetSales: true },
    _count: { _all: true },
  })
  if (sums._count._all === 0) return null
  return (sums._sum.fpNetSales ?? 0) + (sums._sum.tpNetSales ?? 0)
}

async function salesSignal(storeIds: string[], today: Date): Promise<AskSignal | null> {
  const yesterday = addDays(today, -1)
  const [net, prior] = await Promise.all([
    netSalesOn(storeIds, yesterday),
    netSalesOn(storeIds, addDays(yesterday, -7)),
  ])
  if (net === null) return null
  const day = WEEKDAY[yesterday.getDay()]
  const short = WEEKDAY_SHORT[yesterday.getDay()]
  const change = prior !== null && prior > 0 ? net / prior - 1 : null
  const moved = change !== null && Math.abs(change) >= SALES_SIGNAL_PCT
  const sign = change !== null && change < 0 ? "−" : "+"
  return {
    id: "sales",
    label: `${day} sales`,
    value: money(net),
    delta:
      change === null
        ? null
        : `${sign}${Math.abs(Math.round(change * 100))}% vs prior ${short}`,
    tone: !moved ? "signal" : change! < 0 ? "bad" : "good",
    question: !moved
      ? `How did ${day} go?`
      : change! < 0
        ? `Why was ${day} down?`
        : `What drove ${day} up?`,
  }
}

async function priceSignal(accountId: string): Promise<AskSignal | null> {
  const { movers } = await loadPrices(accountId)
  // The newest genuine move — the spike guard has already thrown out the
  // pack-metadata mis-parses that read as a 10× price.
  const latest = movers
    .filter((m) => !m.spike && m.move !== 0)
    .sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime())[0]
  if (!latest) return null
  const diff = latest.latest - latest.median
  const up = diff > 0
  return {
    id: "price",
    label: latest.name,
    value: `${unitCost(latest.latest)}/${latest.unit}`,
    delta: `${up ? "+" : "−"}${unitCost(Math.abs(diff))} on ${shortDate(latest.latestAt)}`,
    tone: up ? "bad" : "good",
    question: up
      ? `Which recipes does the ${latest.name.toLowerCase()} price hit?`
      : `Is ${latest.name.toLowerCase()} cheaper for good?`,
  }
}

async function invoiceSignal(accountId: string, storeId: string | null): Promise<AskSignal | null> {
  const where = { accountId, status: "REVIEW" as const, ...(storeId ? { storeId } : {}) }
  const [n, sample] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      take: 3,
      select: { invoiceNumber: true },
    }),
  ])
  if (n === 0) return null
  return {
    id: "invoices",
    label: "Invoices",
    value: `${n} in review`,
    delta: sample.map((i) => i.invoiceNumber).join(" · ") || null,
    tone: "signal",
    question: "Which invoices do not reconcile?",
  }
}

export async function loadAskBrief(input: AskBriefInput): Promise<AskBrief> {
  const { accountId, storeId } = input
  const today = businessCalendarDate(input.today)
  const dayKey = businessQueryDate(input.today).toISOString().slice(0, 10)
  return cached<AskBrief>(
    `counter:ask-brief:${accountId}:${storeId ?? "all"}:${dayKey}`,
    TTL_SECONDS,
    ["invoices", "otter", `account:${accountId}`],
    async () => {
      const stores = await prisma.store.findMany({
        where: { accountId, ...(storeId ? { id: storeId } : {}) },
        select: { id: true },
      })
      const storeIds = stores.map((s) => s.id)
      const [sales, price, invoices, status] = await Promise.all([
        storeIds.length > 0 ? salesSignal(storeIds, today) : null,
        priceSignal(accountId),
        invoiceSignal(accountId, storeId),
        getShellStatus({ accountId, storeIds }),
      ])
      return {
        signals: [sales, price, invoices].filter((s): s is AskSignal => s !== null),
        syncedAt: status.sync?.at ? status.sync.at.toISOString() : null,
      }
    },
  )
}

/**
 * The brief as a streamed section, for the two Ask pages. Not awaited by the
 * page (`no-awaited-sections-in-page`); `classify` turns a throw into a
 * failed section with a retry, and an account with nothing to report into
 * an empty one the page renders as the six starters alone.
 */
export function getAskBriefSectionPromise(input: AskBriefInput): Promise<SectionData<AskBrief>> {
  // Never `isEmpty`: a brief with nothing in it is still the page's opening —
  // the greeting, "nothing moved", the starters — so it renders ready.
  return classify(() => loadAskBrief(input), { retryAction: "Reload" })
}

const TZ = "America/Los_Angeles"
const hourIn = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ })
const weekdayIn = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: TZ })

/**
 * The two lines over the brief, decided on the SERVER in the store's own
 * clock so the server and the browser print the same words (the Ask page
 * has had one hydration mismatch over a clock already).
 *
 *   greeting  "Good morning, Chris."   — the hour in LA, the first name
 *   since     "Since Saturday"         — the previous business day
 */
export function briefHeadings(now: Date, name: string | null): { greeting: string; since: string } {
  const hour = Number(hourIn.format(now))
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"
  const first = name?.trim().split(/\s+/)[0] ?? ""
  const yesterday = new Date(now.getTime() - 86_400_000)
  return {
    greeting: first ? `Good ${part}, ${first}.` : `Good ${part}.`,
    since: `Since ${weekdayIn.format(yesterday)}`,
  }
}
