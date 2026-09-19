// monitoring adapters — the account boundary the seven tabs never had.
//
// `monitoring-people`, `-ingredients`, `-ml` and `-tabs` read tenant business
// data with no `where` at all: every account's users and page views, every
// account's stores and orders, every account's ingredient decisions, invoice
// lines, training runs and forecasts. The page carries a "Developer only"
// sub, but `Role` holds only OWNER and DEVELOPER and every access helper
// accepts both, so nothing above the queries narrowed them either.
//
// These assert the boundary where it belongs — in the query — for both kinds
// of call: the Prisma ones by their `where`, the raw-SQL ones by whether the
// account id reached the statement's parameters. Infra tables (`JobRun`,
// `ErrorEvent`, `CacheStat`, `AiUsageEvent`, `ExternalSignalSyncRun`,
// `OperatorGateDailyVerdict`) are global on purpose and are not asserted here.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    store: { findMany: vi.fn() },
    ingredientMatchDecision: { findMany: vi.fn(), count: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    mlTrainingRun: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getPeopleSections, getActivitySections } from "@/lib/counter/adapters/monitoring-people"
import { getAuditSections } from "@/lib/counter/adapters/monitoring-ingredients"
import { getMlSections } from "@/lib/counter/adapters/monitoring-ml"
import { getCostsSections } from "@/lib/counter/adapters/monitoring-tabs"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const OURS = "acct_ours"
const OUR_STORES = [{ id: "store_a" }, { id: "store_b" }]

/**
 * Every raw statement the call issued, as one string per call, paired with the
 * parameters it interpolated. `prisma.$queryRaw` is tagged-template style, so
 * the strings arrive as the first argument and the values as the rest.
 */
function rawCalls(): Array<{ sql: string; params: unknown[] }> {
  return asMock(prisma.$queryRaw).mock.calls.map((args: unknown[]) => {
    const [strings, ...params] = args
    const sql = Array.isArray(strings) ? strings.join("?") : String(strings)
    return { sql, params }
  })
}

/** The raw statements that name a table, so a query can be found by subject. */
function statementsMentioning(table: string) {
  return rawCalls().filter((c) => c.sql.includes(`"${table}"`))
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$queryRaw).mockResolvedValue([])
  asMock(prisma.store.findMany).mockResolvedValue(OUR_STORES)
  asMock(prisma.ingredientMatchDecision.findMany).mockResolvedValue([])
  asMock(prisma.ingredientMatchDecision.count).mockResolvedValue(0)
  asMock(prisma.invoiceLineItem.findMany).mockResolvedValue([])
  asMock(prisma.mlTrainingRun.findMany).mockResolvedValue([])
  asMock(prisma.mlTrainingRun.findFirst).mockResolvedValue(null)
})

describe("monitoring · people tab", () => {
  it("scopes the roster and every page-view query to the account", async () => {
    await getPeopleSections({ accountId: OURS })

    const tenant = [
      ...statementsMentioning("User"),
      ...statementsMentioning("PageView"),
    ]
    expect(tenant.length).toBeGreaterThan(0)
    for (const call of tenant) {
      expect(call.params).toContain(OURS)
    }
  })

  it("does not read a user the account does not own", async () => {
    await getPeopleSections({ accountId: OURS })

    const roster = statementsMentioning("User")[0]
    expect(roster.sql).toMatch(/"accountId"\s*=/)
  })
})

describe("monitoring · activity tab", () => {
  it("lists only this account's stores", async () => {
    await getActivitySections({ accountId: OURS })

    const stores = statementsMentioning("Store")
    expect(stores.length).toBeGreaterThan(0)
    for (const call of stores) {
      expect(call.params).toContain(OURS)
    }
  })

  it("leaves the infrastructure feed global", async () => {
    await getActivitySections({ accountId: OURS })

    // JobRun and ExternalSignalSyncRun describe the deployment, not a tenant.
    // Narrowing them would hide a failing cron from the only page that shows
    // crons at all.
    const infra = [
      ...statementsMentioning("JobRun"),
      ...statementsMentioning("ExternalSignalSyncRun"),
    ]
    expect(infra.length).toBeGreaterThan(0)
    for (const call of infra) {
      expect(call.params).not.toContain(OURS)
    }
  })
})

describe("monitoring · ingredient audit tab", () => {
  it("scopes both match-decision reads", async () => {
    await getAuditSections({ accountId: OURS })

    expect(asMock(prisma.ingredientMatchDecision.findMany).mock.calls[0][0].where)
      .toMatchObject({ accountId: OURS })
    expect(asMock(prisma.ingredientMatchDecision.count).mock.calls[0][0].where)
      .toMatchObject({ accountId: OURS })
  })

  it("reaches InvoiceLineItem's account through its invoice", async () => {
    await getAuditSections({ accountId: OURS })

    // InvoiceLineItem has no accountId column; the boundary is the invoice's.
    expect(asMock(prisma.invoiceLineItem.findMany).mock.calls[0][0].where)
      .toMatchObject({ invoice: { accountId: OURS } })
  })

  it("carries the boundary into each per-canonical subquery", async () => {
    await getAuditSections({ accountId: OURS })

    // Scoping only the outer row is not enough. Every subquery correlates on
    // canonicalIngredientId, and nothing in the schema keeps a link inside
    // one account — so a foreign row attached to our canonical would be
    // counted in our SKUs, recipes, spellings, lines and spend.
    const catalogue = statementsMentioning("CanonicalIngredient")[0].sql
    expect(catalogue).toMatch(/"IngredientSkuMatch"[\s\S]*?m\."accountId" = c\."accountId"/)
    expect(catalogue).toMatch(/"RecipeIngredient"[\s\S]*?rc\."accountId" = c\."accountId"/)
    // Both InvoiceLineItem subqueries reach the account through the invoice.
    const throughInvoice = catalogue.match(/i\."accountId" = c\."accountId"/g) ?? []
    expect(throughInvoice.length).toBe(3)
  })

  it("scopes the canonical catalogue and the source breakdown", async () => {
    await getAuditSections({ accountId: OURS })

    const tenant = [
      ...statementsMentioning("CanonicalIngredient"),
      ...statementsMentioning("InvoiceLineItem"),
    ]
    expect(tenant.length).toBeGreaterThan(0)
    for (const call of tenant) {
      expect(call.params).toContain(OURS)
    }
  })
})

describe("monitoring · ml tab", () => {
  it("filters training runs by the account's stores, not by nothing", async () => {
    await getMlSections({ accountId: OURS })

    // MlTrainingRun.scope holds a store id — that is the only boundary it has.
    for (const call of asMock(prisma.mlTrainingRun.findMany).mock.calls) {
      expect(call[0].where).toMatchObject({ scope: { in: ["store_a", "store_b"] } })
    }
    for (const call of asMock(prisma.mlTrainingRun.findFirst).mock.calls) {
      expect(call[0].where).toMatchObject({ scope: { in: ["store_a", "store_b"] } })
    }
  })

  it("scopes evaluations, forecasts and sales to the account's stores", async () => {
    await getMlSections({ accountId: OURS })

    const tenant = [
      ...statementsMentioning("MlForecastEvaluation"),
      ...statementsMentioning("ForecastDailyRevenue"),
      ...statementsMentioning("OtterDailySummary"),
    ]
    expect(tenant.length).toBeGreaterThan(0)
    for (const call of tenant) {
      expect(call.params).toContainEqual(["store_a", "store_b"])
    }
  })

  it("sums the newest forecast per store before comparing to sales", async () => {
    await getMlSections({ accountId: OURS })

    // The actuals CTE sums every store by date. Picking one forecast row per
    // date across all of them charted one store's forecast against the whole
    // account's sales — wrong the moment a second store goes ready.
    const chart = statementsMentioning("ForecastDailyRevenue").find((c) =>
      c.sql.includes("OtterDailySummary"),
    )
    expect(chart).toBeDefined()
    expect(chart!.sql).toMatch(/DISTINCT ON \(\s*"storeId",\s*"forecastDate"\s*\)/)
    expect(chart!.sql).toMatch(/SUM\("predictedRevenue"\)/)
  })

  it("leaves the operator-gate verdicts global", async () => {
    await getMlSections({ accountId: OURS })

    // OperatorGateDailyVerdict records the ML deployment's own health.
    const gates = statementsMentioning("OperatorGateDailyVerdict")
    expect(gates.length).toBeGreaterThan(0)
    for (const call of gates) {
      expect(call.params).not.toContain(OURS)
    }
  })
})

describe("monitoring · costs tab", () => {
  it("scopes the failed-turn list to the account", async () => {
    await getCostsSections({ accountId: OURS })

    const turns = statementsMentioning("ChatTurn")
    expect(turns.length).toBeGreaterThan(0)
    for (const call of turns) {
      expect(call.params).toContain(OURS)
    }
  })

  it("leaves AI spend global, since it is billed to the deployment", async () => {
    await getCostsSections({ accountId: OURS })

    const spend = statementsMentioning("AiUsageEvent").filter(
      (c) => !c.sql.includes('"ChatTurn"'),
    )
    expect(spend.length).toBeGreaterThan(0)
    for (const call of spend) {
      expect(call.params).not.toContain(OURS)
    }
  })
})
