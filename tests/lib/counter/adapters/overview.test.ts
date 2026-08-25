import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/splh-actions", () => ({ getSplhSeries: vi.fn() }))
vi.mock("@/lib/cogs", () => ({ getCogsKpis: vi.fn(), getCogsStoreOverview: vi.fn() }))
vi.mock("@/app/actions/invoice-actions", () => ({ getInvoiceSummary: vi.fn() }))

import { getSplhSeries } from "@/app/actions/splh-actions"
import { getCogsStoreOverview } from "@/lib/cogs"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getOverviewSections } from "@/lib/counter/adapters/overview"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

// getOverviewSections needs an accountId for the all-stores COGS rollup
// (getCogsStoreOverview(accountId, ...) — it has no session of its own to
// read one from; see the adapter's module comment). The brief's signature
// omitted it — fixed here rather than bent to fit.
const accountId = "acct_1"

describe("getOverviewSections", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns every section the page composes, named", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    for (const key of ["lead", "ledger", "invoices", "needsYou", "modelCall"]) {
      expect(s[key as keyof typeof s]).toBeDefined()
    }
  })

  it("classifies a thrown loader as failed without taking the page down", async () => {
    vi.mocked(getSplhSeries).mockRejectedValue(new Error("Otter sync timed out"))
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    expect(s.lead.status).toBe("failed")
    // Every other section still resolved.
    expect(s.ledger.status).not.toBe("failed")
  })

  it("reports owed sections without querying for them", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null, accountId })
    // The design calls for these and no server code computes them yet.
    expect(s.needsYou.status).toBe("not_computed")
    expect(s.modelCall.status).toBe("not_computed")
  })

  // The brief's version of this test asserted on getSplhSeries's first call
  // argument's `.endDate` — but getSplhSeries(granularity) takes no date
  // bounds at all (it derives its own trailing window; confirmed against
  // src/app/actions/splh-actions.ts and its only other caller,
  // src/app/dashboard/components/sections/splh-section.tsx, which calls it
  // as getSplhSeries("day")). That assertion could never pass against a
  // correct adapter. getCogsStoreOverview does take real Date bounds, so the
  // same inclusive-bound guarantee is checked there instead.
  it("passes INCLUSIVE query bounds, not Counter's midnight end", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
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

  it("never throws, however badly the loaders behave", async () => {
    vi.mocked(getSplhSeries).mockRejectedValue(new Error("a"))
    vi.mocked(getCogsStoreOverview).mockRejectedValue(new Error("b"))
    vi.mocked(getInvoiceSummary).mockRejectedValue(new Error("c"))
    await expect(
      getOverviewSections({ range, storeId: null, accountId }),
    ).resolves.toBeDefined()
  })
})
