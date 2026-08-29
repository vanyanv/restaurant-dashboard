import { prisma } from "@/lib/prisma"
import { count, money, pct } from "@/lib/counter/format"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * Two of the monitoring tabs — `P.moncache` and `P.moncosts`
 * (`docs/counter/counter-prototype.html`).
 *
 * Both keep the prototype's central argument, because on this account both
 * arguments turn out to be right.
 *
 * ## Cache: rank by misses, not by rate
 *
 * `P.moncache`'s own note: *"A blended hit rate hides one cold prefix behind
 * six warm ones, so this page ranks by misses rather than by rate. The prefix
 * with the best rate can still be the one costing you the most."*
 *
 * Measured over 168 hours, that is exactly this account:
 *
 *   prefix    hits    misses   rate
 *   pnl       7,349      873   89.4%   <- best rate, most misses
 *   inv       1,098      269   80.3%
 *   mobile       30       38   44.1%   <- worst rate, fewest misses
 *   otter        52       28   65.0%
 *   dash         53       26   67.1%
 *
 * `mobile` has the worst rate and 38 misses. `pnl` has the BEST rate and 873 —
 * twenty-three times more work. Sorting by rate puts the cheapest problem
 * first and the expensive one last, so the table sorts by misses and prints
 * the rate beside it.
 *
 * ## Costs: a figure whose job is to make zero look wrong
 *
 * `P.moncosts` carries "Turns recording $0" because a chart that draws nothing
 * for a day with traffic reads as a quiet day rather than as a bug. **28 of
 * this account's 995 AI events recorded exactly $0**, clustered on four days,
 * so the cell has real work to do.
 */

/** The window both tabs report over. */
const CACHE_HOURS = 168
const COST_DAYS = 14
/** A prefix below this hit rate is cold, however few misses it has. */
const WARM_PCT = 90
/** Rows on a phone list. */
const PHONE_ROWS = 4

/* ── Cache ────────────────────────────────────────────────────────────── */

export interface CacheHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface CachePrefixes {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface CacheSections {
  headline: SectionData<CacheHeadline>
  prefixes: SectionData<CachePrefixes>
}

interface Prefix {
  prefix: string
  hits: number
  misses: number
  busts: number
  failures: number
}

interface CacheData {
  prefixes: Prefix[]
}

async function loadCache(): Promise<CacheData> {
  const rows = await prisma.$queryRaw<
    Array<{ prefix: string; hits: number; misses: number; busts: number; failures: number }>
  >`
    SELECT "keyPrefix" AS prefix, COALESCE(SUM(hits), 0)::int AS hits,
           COALESCE(SUM(misses), 0)::int AS misses, COALESCE(SUM(busts), 0)::int AS busts,
           COALESCE(SUM(failures), 0)::int AS failures
    FROM "CacheStat"
    WHERE "hourBucket" >= NOW() - MAKE_INTERVAL(hours => ${CACHE_HOURS})
    GROUP BY 1
    ORDER BY 3 DESC`
  return { prefixes: rows }
}

const rateOf = (p: Prefix): number | null =>
  p.hits + p.misses === 0 ? null : (p.hits / (p.hits + p.misses)) * 100

function cacheHeadlineOf(d: CacheData): CacheHeadline {
  const hits = d.prefixes.reduce((t, p) => t + p.hits, 0)
  const misses = d.prefixes.reduce((t, p) => t + p.misses, 0)
  const blended = hits + misses > 0 ? (hits / (hits + misses)) * 100 : null
  const worstByMiss = d.prefixes[0]
  const worstByRate = [...d.prefixes]
    .filter((p) => rateOf(p) !== null)
    .sort((a, b) => (rateOf(a) ?? 0) - (rateOf(b) ?? 0))[0]

  const blendedCell: FigureProps = {
    label: "Blended hit rate",
    value: blended === null ? "—" : pct(blended, { scaled: true }),
    delta: `${count(hits)} hits · ${count(misses)} misses over ${count(CACHE_HOURS)}h`,
    deltaTone: "is-flat",
  }
  const missCell: FigureProps = {
    label: "Most misses",
    value: worstByMiss ? worstByMiss.prefix : "—",
    delta: worstByMiss ? `${count(worstByMiss.misses)} misses` : "no traffic",
    deltaTone: "is-down",
  }

  return {
    cells: [
      blendedCell,
      {
        label: "Prefixes",
        value: count(d.prefixes.length),
        delta: `${count(d.prefixes.filter((p) => (rateOf(p) ?? 100) < WARM_PCT).length)} below ${count(WARM_PCT)}%`,
        deltaTone: "is-flat",
      },
      missCell,
      {
        label: "Worst rate",
        value: worstByRate ? worstByRate.prefix : "—",
        // The whole point of the page in one delta: the worst rate and the
        // most misses are different prefixes, and only one of them is work.
        delta: worstByRate
          ? `${pct(rateOf(worstByRate) ?? 0, { scaled: true })} · but only ${count(worstByRate.misses)} misses`
          : "no traffic",
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [blendedCell, missCell],
  }
}

function cachePrefixesOf(d: CacheData): CachePrefixes {
  const worstByMiss = d.prefixes[0]
  const worstByRate = [...d.prefixes]
    .filter((p) => rateOf(p) !== null)
    .sort((a, b) => (rateOf(a) ?? 0) - (rateOf(b) ?? 0))[0]
  const disagree =
    worstByMiss && worstByRate && worstByMiss.prefix !== worstByRate.prefix
  const warm = d.prefixes.filter((p) => (rateOf(p) ?? 0) >= WARM_PCT).length

  return {
    rows: d.prefixes.map((p) => {
      const rate = rateOf(p)
      return {
        key: p.prefix,
        cells: {
          prefix: p.prefix,
          hits: count(p.hits),
          misses: { v: count(p.misses), cls: "hot" },
          // The rate carries its own judgement. A separate State column read
          // "Cold" on all five rows — nothing on this account clears 90% — and
          // a classification that classifies everything the same way is a
          // column that says one thing five times.
          rate:
            rate === null
              ? "—"
              : rate >= WARM_PCT
                ? pct(rate, { scaled: true })
                : { v: pct(rate, { scaled: true }), cls: "hot" },
          failures: p.failures === 0 ? "—" : { v: count(p.failures), cls: "hot" },
        },
      }
    }),
    phoneRows: d.prefixes.slice(0, PHONE_ROWS).map((p) => ({
      key: p.prefix,
      title: p.prefix,
      detail: `${count(p.hits)} hits · ${count(p.misses)} misses`,
      value: rateOf(p) === null ? "—" : pct(rateOf(p) ?? 0, { scaled: true }),
      note: (rateOf(p) ?? 100) >= WARM_PCT ? "warm" : "cold",
      noteTone: (rateOf(p) ?? 100) >= WARM_PCT ? "up" : "down",
    })),
    meta: `${count(d.prefixes.length)} prefixes · ${count(CACHE_HOURS)} hours`,
    note: (warm === 0
      ? `No prefix clears ${count(WARM_PCT)}%, so every rate below is marked. `
      : "") +
      (disagree
      ? `Sorted by MISSES, not by rate. ${worstByRate.prefix} has the worst rate at ` +
        `${pct(rateOf(worstByRate) ?? 0, { scaled: true })} and ${count(worstByRate.misses)} misses; ` +
        `${worstByMiss.prefix} has the best-looking rate on this page at ` +
        `${pct(rateOf(worstByMiss) ?? 0, { scaled: true })} and ${count(worstByMiss.misses)} — ` +
        `${(worstByMiss.misses / Math.max(1, worstByRate.misses)).toFixed(0)} times more work. ` +
        `A rate-sorted table would put the cheap problem first.`
      : `Sorted by misses. The prefix with the worst rate is also the one with the most misses, ` +
        `so both orderings agree here — they usually do not.`),
  }
}

export function getCacheSectionPromises(): StreamedSections<CacheSections> {
  const dataP = classify(() => loadCache(), {
    retryAction: "retryCache",
    isEmpty: (d) => d.prefixes.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: CacheData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryCache")
  return { headline: s(cacheHeadlineOf), prefixes: s(cachePrefixesOf) }
}

export async function getCacheSections(): Promise<CacheSections> {
  return awaitSections(getCacheSectionPromises())
}

/* ── Costs ────────────────────────────────────────────────────────────── */

export interface CostsHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface CostsSpend {
  chart: ChartSpec
  meta: string
  note: string
}

export interface CostsFeatures {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface CostsSections {
  headline: SectionData<CostsHeadline>
  spend: SectionData<CostsSpend>
  features: SectionData<CostsFeatures>
}

interface CostsData {
  days: Array<{ day: string; calls: number; cost: number; zero: number }>
  features: Array<{
    feature: string
    provider: string
    model: string
    calls: number
    cost: number
    zero: number
  }>
  totalEvents: number
  zeroEvents: number
  cost30d: number
}

async function loadCosts(): Promise<CostsData> {
  const [days, features, totals] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; calls: number; cost: number; zero: number }>>`
      SELECT DATE("occurredAt") AS day, COUNT(*)::int AS calls,
             COALESCE(SUM("estimatedCostUsd"), 0)::float AS cost,
             COUNT(*) FILTER (WHERE "estimatedCostUsd" = 0 OR "estimatedCostUsd" IS NULL)::int AS zero
      FROM "AiUsageEvent"
      WHERE "occurredAt" >= NOW() - MAKE_INTERVAL(days => ${COST_DAYS})
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<
      Array<{
        feature: string
        provider: string
        model: string
        calls: number
        cost: number
        zero: number
      }>
    >`
      SELECT feature, provider, model, COUNT(*)::int AS calls,
             COALESCE(SUM("estimatedCostUsd"), 0)::float AS cost,
             COUNT(*) FILTER (WHERE "estimatedCostUsd" = 0 OR "estimatedCostUsd" IS NULL)::int AS zero
      FROM "AiUsageEvent"
      WHERE "occurredAt" >= NOW() - INTERVAL '7 days'
      GROUP BY 1, 2, 3 ORDER BY 5 DESC`,
    prisma.$queryRaw<Array<{ total: number; zero: number; cost30: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "estimatedCostUsd" = 0 OR "estimatedCostUsd" IS NULL)::int AS zero,
             COALESCE(SUM("estimatedCostUsd") FILTER (
               WHERE "occurredAt" >= NOW() - INTERVAL '30 days'), 0)::float AS cost30
      FROM "AiUsageEvent"`,
  ])

  return {
    days: days.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      calls: d.calls,
      cost: d.cost,
      zero: d.zero,
    })),
    features,
    totalEvents: totals[0]?.total ?? 0,
    zeroEvents: totals[0]?.zero ?? 0,
    cost30d: totals[0]?.cost30 ?? 0,
  }
}

/**
 * Money at this page's magnitude.
 *
 * The whole month is $0.31 and a mean call is $0.0017, so `money(_, {cents})`
 * prints `$0.00` for figures that are not zero — a cost column reading $0.00
 * beside a share reading 1.7% contradicts itself on the same row. Anything
 * under a cent gets four decimals; above that, cents are enough.
 */
const micro = (v: number): string =>
  Math.abs(v) > 0 && Math.abs(v) < 0.01 ? `$${v.toFixed(4)}` : money(v, { cents: true })

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/**
 * The strip, with the cell whose job is to make zero look wrong.
 *
 * `P.moncosts`' note: a cost chart that draws nothing for a day with traffic
 * reads as a quiet day. **28 of this account's 995 AI events recorded exactly
 * $0**, so the cell has real work — and it counts EVENTS rather than days,
 * because a day with three calls and one zero is still a day with a bug in it.
 */
function costsHeadlineOf(d: CostsData): CostsHeadline {
  const windowCost = d.days.reduce((t, x) => t + x.cost, 0)
  const windowCalls = d.days.reduce((t, x) => t + x.calls, 0)
  const windowZero = d.days.reduce((t, x) => t + x.zero, 0)
  const zeroDays = d.days.filter((x) => x.zero > 0)

  const spendCell: FigureProps = {
    label: "AI spend",
    value: money(windowCost, { cents: true }),
    delta: `${count(windowCalls)} calls over ${count(COST_DAYS)} days`,
    deltaTone: "is-flat",
  }
  const zeroCell: FigureProps = {
    label: "Calls recording $0",
    value: count(windowZero),
    delta:
      windowZero === 0
        ? "every call priced"
        : `on ${count(zeroDays.length)} ${zeroDays.length === 1 ? "day" : "days"} — ${zeroDays.map((x) => D(x.day)).slice(0, 3).join(", ")}`,
    deltaTone: windowZero > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      spendCell,
      {
        label: "Cost per call",
        value: windowCalls > 0 ? micro(windowCost / windowCalls) : "—",
        delta: "mean over the window",
        deltaTone: "is-flat",
      },
      {
        label: "30 days",
        value: money(d.cost30d, { cents: true }),
        delta: `${count(d.totalEvents)} calls all time`,
        deltaTone: "is-flat",
      },
      zeroCell,
    ],
    phoneCells: [spendCell, zeroCell],
  }
}

function costsSpendOf(d: CostsData): CostsSpend {
  const zeroDays = d.days.filter((x) => x.zero > 0)

  return {
    chart: {
      type: "bars",
      h: 150,
      zero: true,
      labels: d.days.map((x) => D(x.day)),
      series: [
        {
          name: "AI spend",
          color: "var(--ink)",
          data: d.days.map((x) => x.cost),
        },
      ],
      alt: "AI spend by day",
    },
    meta: `${count(d.days.length)} days with a call`,
    note:
      zeroDays.length === 0
        ? `Every call in the window recorded a cost.`
        : `${zeroDays.map((x) => D(x.day)).join(", ")} carried calls that recorded $0 — ` +
          `${count(zeroDays.reduce((t, x) => t + x.zero, 0))} of them. A bar that is short ` +
          `because nothing ran and a bar that is short because the cost was not written look ` +
          `identical here, which is why the strip counts them rather than leaving it to the eye.`,
  }
}

function costsFeaturesOf(d: CostsData): CostsFeatures {
  const total = d.features.reduce((t, f) => t + f.cost, 0)

  return {
    rows: d.features.map((f) => ({
      key: `${f.feature}:${f.model}`,
      cells: {
        feature: f.feature,
        model: f.model,
        calls: count(f.calls),
        cost: micro(f.cost),
        share: total > 0 ? pct((f.cost / total) * 100, { scaled: true }) : "—",
        zero: f.zero === 0 ? "—" : { v: count(f.zero), cls: "hot" },
      },
    })),
    phoneRows: d.features.slice(0, PHONE_ROWS).map((f) => ({
      key: `${f.feature}:${f.model}`,
      title: f.feature,
      detail: `${f.model} · ${count(f.calls)} calls`,
      value: micro(f.cost),
    })),
    meta: `${count(d.features.length)} features · 7 days`,
    note:
      d.features.length === 0
        ? `No AI call in the last seven days.`
        : `${d.features[0].feature} is the largest at ${micro(d.features[0].cost)}. ` +
          `Every model here is OpenAI, which is the standing choice for this product — a second ` +
          `provider would show up in this table before it showed up anywhere else.`,
  }
}

export function getCostsSectionPromises(): StreamedSections<CostsSections> {
  const dataP = classify(() => loadCosts(), {
    retryAction: "retryCosts",
    isEmpty: (d) => d.days.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: CostsData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryCosts")
  return {
    headline: s(costsHeadlineOf),
    spend: s(costsSpendOf),
    features: s(costsFeaturesOf),
  }
}

export async function getCostsSections(): Promise<CostsSections> {
  return awaitSections(getCostsSectionPromises())
}
