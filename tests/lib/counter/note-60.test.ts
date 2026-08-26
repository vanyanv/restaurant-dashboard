/**
 * Note 60, as a test.
 *
 * > "Prime cost read 56.2% on the Overview and 57.9% on the P&L for the same
 * > range, because one counted hourly wages and the other counted hourly plus
 * > salaried. Both cells were labelled Labor and both figures were called
 * > Prime cost."
 *
 * This is the regression check for that, and it is deliberately a check on the
 * two ADAPTERS rather than on `primeCost()`: `tests/lib/counter/prime-cost.ts`
 * already pins the formula, and note 60 was never a formula that computed the
 * wrong answer. It was two pages asking two questions and printing both under
 * one name. So both adapters are handed the SAME rollup here, and every
 * figure the two pages print in common has to come back identical — to the
 * digit, as a string, because a string is what the reader sees.
 *
 * It fails if anyone adds a second sum of food and labour to either adapter,
 * and it fails if either page starts reading a percentage at the other's
 * scale — `Statement.cogsPct` is a fraction, `PrimeCost.cogsPct` is points,
 * and the two are a factor of a hundred apart.
 *
 * Planned in the withdrawn `docs/superpowers/plans/2026-08-25-counter-pnl.md`
 * (Task 5) against an `OverviewSections.prime` section that was never built —
 * the Overview ships prime cost as a strip CELL instead. Written here for the
 * first time in Task 3 of the fidelity plan, against what both pages actually
 * publish.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn() }))
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))
vi.mock("@/app/actions/invoice-actions", () => ({ getInvoiceSummary: vi.fn() }))
vi.mock("@/app/actions/splh-actions", () => ({ getSplhSeries: vi.fn() }))
vi.mock("@/app/actions/alerts/inbox-actions", () => ({ getAlertInbox: vi.fn() }))
vi.mock("@/app/actions/forecasts/revenue-forecast-actions", () => ({
  getRevenueForecast: vi.fn(),
}))
vi.mock("@/app/actions/ratings/ratings-actions", () => ({ getRatingsSummary: vi.fn() }))
vi.mock("@/lib/counter/channel-mix", () => ({ loadChannelMix: vi.fn() }))
vi.mock("@/lib/counter/targets", () => ({ loadStripTargets: vi.fn() }))

import { getStores } from "@/app/actions/store/crud-actions"
import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getSplhSeries } from "@/app/actions/splh-actions"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getRatingsSummary } from "@/app/actions/ratings/ratings-actions"
import { loadChannelMix } from "@/lib/counter/channel-mix"
import { loadStripTargets } from "@/lib/counter/targets"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { getOverviewSections, type StripCell } from "@/lib/counter/adapters/overview"
import { getPnlSections } from "@/lib/counter/adapters/pnl"

/* ── One set of figures, handed to both pages ─────────────────────────── */

const range = { start: new Date(2026, 7, 17), end: new Date(2026, 7, 23) }
const today = new Date(2026, 7, 25)
const accountId = "acct_1"

/**
 * The note's own numbers. Food is 31.4% of sales and the WHOLE wage bill is
 * 24.8%, so prime cost is 56.2% — and a reading that took only the hourly
 * three quarters of that labour would print 50.0%, which is the shape of the
 * disagreement this test exists to prevent.
 */
const GROSS = 152_400
const COGS = 47_853.6
const LABOR = 37_795.2

const KPIS = {
  grossSales: GROSS,
  netAfterCommissions: GROSS - 18_288,
  fixedCosts: LABOR + 5_600 + 1_400,
  bottomLine: GROSS - 18_288 - COGS - LABOR - 5_600 - 1_400,
  marginPct: (GROSS - 18_288 - COGS - LABOR - 5_600 - 1_400) / GROSS,
  cogsValue: COGS,
  cogsPct: COGS / GROSS,
  laborValue: LABOR,
  laborPct: LABOR / GROSS,
  rentValue: 5_600,
  rentPct: 5_600 / GROSS,
}

const ROWS = [
  { code: "TOTAL_SALES", label: "Total Sales", values: [GROSS], percents: [1] },
  { code: "6100", label: "Cost of Goods Sold", values: [-COGS], percents: [-COGS / GROSS] },
  { code: "6200", label: "Labor", values: [-LABOR], percents: [-LABOR / GROSS] },
]

const ROLLUP = {
  storeCount: 1,
  combined: KPIS,
  perStore: [
    {
      storeId: "holly",
      storeName: "Hollywood",
      ...KPIS,
      channelMix: [],
      fixedCostsConfigured: true,
      rows: ROWS,
    },
  ],
  consolidatedRows: ROWS,
  periods: [
    { label: "Week", startDate: range.start, endDate: range.end, days: 7, isPartial: false },
  ],
}

const STORE_FILE = {
  id: "holly",
  name: "Hollywood",
  lifecycleStage: "ready",
  openedAt: new Date(2024, 0, 1),
  fixedMonthlyRent: 24_000,
  fixedMonthlyLabor: 40_000,
  targetCogsPct: 29,
  isActive: true,
}

const TARGETS = {
  orders: null,
  ticket: null,
  foodCost: { kind: "target", value: 29, better: "low" },
  labor: null,
  prime: null,
  marketplaceFees: null,
}

const CHANNELS = [{ channel: "house", net: GROSS, orders: 6_000, commission: 0, ticket: 25.4 }]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getStores).mockResolvedValue([STORE_FILE] as never)
  vi.mocked(getAllStoresPnL).mockResolvedValue(ROLLUP as never)
  vi.mocked(loadChannelMix).mockResolvedValue(CHANNELS as never)
  vi.mocked(loadStripTargets).mockResolvedValue(TARGETS as never)
  // The Overview's other sections are not what this test is about; they only
  // have to load without throwing.
  vi.mocked(getInvoiceSummary).mockResolvedValue({
    totalSpend: 0, invoiceCount: 0, avgInvoiceTotal: 0,
    pendingReviewCount: 0, pendingReviewTotal: 0, vendorCount: 0,
    spendByVendor: [], spendByCategory: [],
  } as never)
  vi.mocked(getSplhSeries).mockResolvedValue([] as never)
  vi.mocked(getAlertInbox).mockResolvedValue({
    ok: true,
    data: { alerts: [], counts: { open: 0, critical: 0, watch: 0, info: 0 }, stores: [] },
  } as never)
  vi.mocked(getRevenueForecast).mockResolvedValue({
    ok: true,
    data: { storeId: null, storeName: "All", generatedAt: new Date(), recentMape: null, days: [], openedAt: null },
  } as never)
  vi.mocked(getRatingsSummary).mockResolvedValue(null as never)
})

function must<T>(sd: SectionData<T>, what: string): T {
  if (!hasData(sd)) throw new Error(`${what} is ${sd.status}, not ready`)
  return sd.data
}

const find = (cells: StripCell[], label: string) => {
  const cell = cells.find((c) => c.label === label)
  if (!cell) throw new Error(`no "${label}" cell`)
  return cell
}

async function bothPages() {
  const overview = await getOverviewSections({ range, storeId: null, accountId })
  const pnl = await getPnlSections({ range, storeId: null, accountId, today })
  return {
    overview: must(overview.strip, "overview strip"),
    pnl: must(pnl.headline, "pnl headline").cells,
    weeks: must(pnl.weeks, "pnl weeks").rows,
    statement: must(pnl.statement, "pnl statement").lines,
  }
}

/* ── The assertion ────────────────────────────────────────────────────── */

describe("note 60 — one prime cost, on every page that prints one", () => {
  it("prints the same prime cost on the Overview and the P&L for the same range", async () => {
    const { overview, pnl } = await bothPages()
    const a = find(overview, "Prime cost")
    const b = find(pnl, "Prime cost")

    expect(b.value).toBe(a.value)
    // And it is the real figure, not two matching em-dashes.
    expect(a.value).toBe("56.2%")
    // Same ceiling, from the one module that owns it.
    expect(b.reference?.target).toBe(a.reference?.target)
    expect(b.caption).toBe(a.caption)
  })

  it("prints the same food cost and the same labour on both pages", async () => {
    const { overview, pnl } = await bothPages()
    // The two halves prime cost is made of. Note 60 was a disagreement about
    // the labour half; a disagreement about the food half would read the same
    // way to an owner.
    expect(find(pnl, "Food").value).toBe(find(overview, "Food cost").value)
    expect(find(pnl, "Labor").value).toBe(find(overview, "Labor").value)
    expect(find(pnl, "Food").value).toBe("31.4%")
    expect(find(pnl, "Labor").value).toBe("24.8%")
  })

  it("prints the same figure again in the P&L's own statement line and week rows", async () => {
    // The P&L prints prime cost three times on one page. Note 60 within a page
    // is the same defect as note 60 across two.
    const { overview, weeks, statement } = await bothPages()
    const headline = find(overview, "Prime cost").value
    expect(statement.find((l) => l.key === "prime")?.share).toBe(headline)
    for (const w of weeks) {
      expect(`${w.primePct?.toFixed(1)}%`).toBe(headline)
    }
  })

  it("prints the same gross sales, which is the denominator under all of it", async () => {
    const { overview, pnl } = await bothPages()
    // A prime cost that agrees over two different denominators agrees by luck.
    expect(find(pnl, "Gross sales").value).toBe("$152,400")
    const sales = await getOverviewSections({ range, storeId: null, accountId })
    expect(must(sales.sales, "overview sales").netSales).toBe(GROSS)
    expect(find(overview, "Food cost").reference?.v).toBeCloseTo(31.4, 1)
  })
})
