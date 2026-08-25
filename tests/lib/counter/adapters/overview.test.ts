import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/cogs", () => ({ getCogsKpis: vi.fn(), getCogsStoreOverview: vi.fn() }))
vi.mock("@/app/actions/invoice-actions", () => ({ getInvoiceSummary: vi.fn() }))
vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn() }))

import { getCogsKpis, getCogsStoreOverview } from "@/lib/cogs"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getStores } from "@/app/actions/store/crud-actions"
import { getOverviewSections, getOverviewStores } from "@/lib/counter/adapters/overview"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

// getOverviewSections needs an accountId for the all-stores COGS rollup
// (getCogsStoreOverview(accountId, ...) — it has no session of its own to
// read one from; see the adapter's module comment). The brief's signature
// omitted it — fixed here rather than bent to fit.
const accountId = "acct_1"

describe("getOverviewSections", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns every section the page composes, named", async () => {
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    for (const key of ["sales", "splh", "ledger", "invoices", "needsYou", "modelCall"]) {
      expect(s[key as keyof typeof s]).toBeDefined()
    }
  })

  it("classifies a thrown loader as failed without taking the page down", async () => {
    vi.mocked(getCogsStoreOverview).mockRejectedValue(new Error("Otter sync timed out"))
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    // sales and ledger are two views of the SAME query — both fail together.
    expect(s.ledger.status).toBe("failed")
    expect(s.sales.status).toBe("failed")
    // Every other section still resolved.
    expect(s.invoices.status).not.toBe("failed")
    // splh is unconditionally owed — never even attempts a query, so a COGS
    // failure cannot touch it.
    expect(s.splh.status).toBe("not_computed")
  })

  it("reports owed sections without querying for them", async () => {
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    // The design calls for these and no server code computes them yet.
    expect(s.needsYou.status).toBe("not_computed")
    expect(s.modelCall.status).toBe("not_computed")
    // R1 (Plan 7): SPLH cannot be scoped to Counter's selected range — see
    // the adapter's own doc comment on OverviewSections.splh. Naming the
    // owed work honestly beats showing a number that answers a different
    // question under the same label.
    expect(s.splh.status).toBe("not_computed")
    if (s.splh.status === "not_computed") {
      expect(s.splh.owed).toBe("sales per labour hour scoped to the selected range")
    }
  })

  it("derives net sales from the ledger query rather than fetching it separately", async () => {
    vi.mocked(getCogsStoreOverview).mockResolvedValue([
      { storeId: "a", storeName: "A", cogsPct: 30, cogsDollars: 900, foodCogsDollars: 800,
        packagingCogsDollars: 100, revenueDollars: 3000, costedRevenueDollars: 3000,
        targetCogsPct: null, deltaVsTargetPp: null, warningCount: 0, lifecycleStage: "ready" },
      { storeId: "b", storeName: "B", cogsPct: 25, cogsDollars: 1000, foodCogsDollars: 900,
        packagingCogsDollars: 100, revenueDollars: 4468, costedRevenueDollars: 4468,
        targetCogsPct: null, deltaVsTargetPp: null, warningCount: 0, lifecycleStage: "ready" },
    ] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    expect(s.sales.status).toBe("ready")
    if (s.sales.status === "ready") expect(s.sales.data.netSales).toBe(7468)
    // getCogsStoreOverview called exactly once — not once for "sales" and
    // again for "ledger".
    expect(getCogsStoreOverview).toHaveBeenCalledTimes(1)
  })

  it("passes INCLUSIVE query bounds, not Counter's midnight end", async () => {
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    await getOverviewSections({ range, storeId: null, accountId })
    const [, , passedEnd] = vi.mocked(getCogsStoreOverview).mock.calls[0] as [
      string, Date, Date,
    ]
    // Counter's end is 00:00 on the 24th. An inclusive query needs the whole
    // day, or every range silently loses its last day.
    expect(passedEnd.getHours()).toBeGreaterThan(0)
  })

  it("resolves the selected store's name from the caller's already-loaded store list", async () => {
    vi.mocked(getCogsKpis).mockResolvedValue({
      cogsPct: 20, cogsDollars: 500, foodCogsDollars: 450, packagingCogsDollars: 50,
      revenueDollars: 2500, costedRevenueDollars: 2500, deltaVsPriorPp: null,
      deltaVsTargetPp: null, targetCogsPct: null,
    } as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({
      range, storeId: "hollywood", accountId,
      stores: [{ id: "hollywood", name: "Hollywood", stage: "trading" }],
    })
    expect(s.ledger.status).toBe("ready")
    if (s.ledger.status === "ready") expect(s.ledger.data[0].store).toBe("Hollywood")
  })

  it("never throws, however badly the loaders behave", async () => {
    vi.mocked(getCogsStoreOverview).mockRejectedValue(new Error("b"))
    vi.mocked(getInvoiceSummary).mockRejectedValue(new Error("c"))
    await expect(
      getOverviewSections({ range, storeId: null, accountId }),
    ).resolves.toBeDefined()
  })
})

describe("getOverviewStores", () => {
  beforeEach(() => vi.resetAllMocks())

  it("maps the account's stores for the StoreSwitcher, translating 'ready' to 'trading'", async () => {
    vi.mocked(getStores).mockResolvedValue([
      { id: "a", name: "Hollywood", lifecycleStage: "ready" },
      { id: "b", name: "Glendale", lifecycleStage: "pre_open" },
    ] as never)
    const stores = await getOverviewStores()
    expect(stores).toEqual([
      { id: "a", name: "Hollywood", stage: "trading" },
      { id: "b", name: "Glendale", stage: "pre_open" },
    ])
  })

  it("fails closed to an empty list, same as getStores itself", async () => {
    vi.mocked(getStores).mockResolvedValue([] as never)
    await expect(getOverviewStores()).resolves.toEqual([])
  })
})
