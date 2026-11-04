/*
 * Contract tests for the five lookups added 2026-11-04 (crew & schedule,
 * count & waste, weather & events, the merch shop, store settings). Loaders
 * and Prisma are mocked: what is under test is that the account reaches every
 * query, that no personal field beyond a short name leaves a tool, and that a
 * missing reading comes back as missing rather than as zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))
vi.mock("@/lib/counter/adapters/count", () => ({
  getCountReportSectionPromises: vi.fn(),
  getCountWasteSectionPromises: vi.fn(),
}))
vi.mock("@/lib/counter/commission", () => ({ loadObservedRates: vi.fn() }))
vi.mock("@/lib/shop/client", () => ({
  shopEnabledFor: vi.fn(),
  shop: { summary: vi.fn(), orders: vi.fn(), products: vi.fn() },
}))

import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import { getCountReportSectionPromises, getCountWasteSectionPromises } from "@/lib/counter/adapters/count"
import { loadObservedRates } from "@/lib/counter/commission"
import { shop, shopEnabledFor } from "@/lib/shop/client"
import { getCrewAndSchedule } from "@/lib/chat/tools/crew"
import { getCountAndWaste } from "@/lib/chat/tools/count-waste"
import { getWeatherAndEvents, weatherLabel } from "@/lib/chat/tools/weather-events"
import { getShopOrders } from "@/lib/chat/tools/shop"
import { getStoreSettings } from "@/lib/chat/tools/store-settings"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

function prismaMock() {
  return {
    store: { findMany: vi.fn().mockResolvedValue([{ id: "s1", name: "Hollywood" }]) },
    crewMember: { findMany: vi.fn().mockResolvedValue([]) },
    harriEmployee: { findMany: vi.fn().mockResolvedValue([]) },
    harriShift: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    storeWeatherSignal: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    storeEventSignal: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    storeEventDetailSignal: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

let prisma: ReturnType<typeof prismaMock>
let ctx: ChatToolContext

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertOwnerOwnsStores).mockImplementation(async (_a, ids) => ids ?? ["s1"])
  prisma = prismaMock()
  ctx = { ownerId: "u1", accountId: "acct-A", prisma: prisma as never }
})

describe("getCrewAndSchedule", () => {
  it("scopes by account, returns short names only, and splits open slots out", async () => {
    prisma.crewMember.findMany.mockResolvedValue([
      { storeId: "s1", firstName: "Maicol", lastName: "Reyes", active: true, source: "HARRI", email: "x@y.z", pin: "1234" },
    ])
    prisma.harriEmployee.findMany.mockResolvedValue([{ storeId: "s1", userId: 7, firstName: "Ana", lastName: "Lopez" }])
    prisma.harriShift.findMany.mockResolvedValue([
      { storeId: "s1", date: d("2026-11-05"), startTime: new Date("2026-11-05T17:00:00Z"), endTime: new Date("2026-11-06T01:00:00Z"), minutes: 480, userId: 7, isVirtual: false, positionName: "Cook", positionCode: "CK" },
      { storeId: "s1", date: d("2026-11-05"), startTime: new Date("2026-11-06T01:00:00Z"), endTime: new Date("2026-11-06T05:00:00Z"), minutes: 240, userId: null, isVirtual: true, positionName: null, positionCode: "CSH" },
    ])
    prisma.harriShift.groupBy.mockResolvedValue([{ storeId: "s1", _max: { date: d("2026-11-05") } }])

    const out = await getCrewAndSchedule.execute({ dateRange: { from: "2026-11-05", to: "2026-11-06" } }, ctx)

    expect(prisma.harriShift.findMany.mock.calls[0][0].where.store).toEqual({ accountId: "acct-A" })
    expect(prisma.crewMember.findMany.mock.calls[0][0].where.store).toEqual({ accountId: "acct-A" })
    const s = out.stores[0]
    expect(s.crew).toEqual([{ name: "Maicol R.", active: true, source: "HARRI" }])
    expect(JSON.stringify(out)).not.toMatch(/x@y\.z|1234/)
    expect(s.scheduleSyncedThrough).toBe("2026-11-05")
    expect(s.days[0]).toMatchObject({ date: "2026-11-05", scheduledHours: 8 })
    expect(s.days[0].shifts).toEqual([{ name: "Ana L.", position: "Cook", start: "9:00 AM", end: "5:00 PM", hours: 8 }])
    expect(s.days[0].openSlots).toEqual([{ position: "CSH", start: "5:00 PM", end: "9:00 PM", hours: 4 }])
    // Past the synced schedule: unknown, not nobody.
    expect(s.days[1]).toEqual({ date: "2026-11-06", scheduledHours: null, shifts: [], openSlots: [] })
  })

  it("refuses more than 14 days", async () => {
    await expect(getCrewAndSchedule.execute({ dateRange: { from: "2026-11-01", to: "2026-11-20" } }, ctx)).rejects.toThrow(/14 days/)
  })
})

describe("getCountAndWaste", () => {
  it("passes the account to the page's loaders and has no report before two counts", async () => {
    vi.mocked(getCountReportSectionPromises).mockReturnValue({
      report: Promise.resolve({
        status: "ready",
        data: { counts: [{ id: "c1", label: "Mon Nov 2" }], current: { id: "c1", label: "Mon Nov 2" }, previous: null, rows: [], orders: [] },
      }),
    } as never)
    vi.mocked(getCountWasteSectionPromises).mockReturnValue({
      waste: Promise.resolve({
        status: "ready",
        data: { weekDollars: 12.345, recent: [{ id: "w1", name: "Buns", amount: "6 ea", reason: "Dropped", when: "Mon 3:00 PM", dollars: 2.1, note: null }] },
      }),
    } as never)

    const out = await getCountAndWaste.execute({}, ctx)

    expect(vi.mocked(getCountReportSectionPromises).mock.calls[0][0]).toEqual({ accountId: "acct-A", storeId: "s1" })
    expect(prisma.store.findMany.mock.calls[0][0].where.accountId).toBe("acct-A")
    expect(out.stores[0].report).toBeNull()
    expect(out.stores[0].completedCounts).toBe(1)
    expect(out.stores[0].wasteLastWeek?.dollars).toBe(12.35)
    expect(out.stores[0].wasteLastWeek?.unpricedEntries).toBe(0)
  })
})

describe("getWeatherAndEvents", () => {
  it("summarises opening hours in °F and leaves a day without readings as null", async () => {
    prisma.storeWeatherSignal.findMany.mockResolvedValue([
      { storeId: "s1", date: d("2026-11-07"), hour: 3, temperatureC: 5, precipitationMm: 0, precipitationProbabilityPct: 10, windSpeedKph: 5, weatherCode: 0 },
      { storeId: "s1", date: d("2026-11-07"), hour: 14, temperatureC: 25, precipitationMm: 2.54, precipitationProbabilityPct: 60, windSpeedKph: 16.09, weatherCode: 61 },
      { storeId: "s1", date: d("2026-11-07"), hour: 20, temperatureC: 15, precipitationMm: 0, precipitationProbabilityPct: 20, windSpeedKph: 8, weatherCode: 2 },
    ])

    const out = await getWeatherAndEvents.execute({ dateRange: { from: "2026-11-07", to: "2026-11-08" } }, ctx)

    expect(prisma.storeWeatherSignal.findMany.mock.calls[0][0].where.store).toEqual({ accountId: "acct-A" })
    const [sat, sun] = out.stores[0].days
    expect(sat.weather).toEqual({ highF: 77, lowF: 59, rainInches: 0.1, maxRainChancePct: 60, label: "Rain", windMphMax: 10 })
    expect(sat.events).toBeNull()
    expect(sun.weather).toBeNull()
  })

  it("names WMO codes", () => {
    expect([weatherLabel(0), weatherLabel(3), weatherLabel(95), weatherLabel(null)]).toEqual(["Clear", "Overcast", "Thunderstorm", null])
  })
})

describe("getShopOrders", () => {
  it("never calls the site for an account that does not own the shop", async () => {
    vi.mocked(shopEnabledFor).mockReturnValue(false)
    const out = await getShopOrders.execute({ orders: "open" }, ctx)
    expect(out.connected).toBe(false)
    expect(shop.summary).not.toHaveBeenCalled()
  })

  it("returns dollars and a first name, never the email", async () => {
    vi.mocked(shopEnabledFor).mockReturnValue(true)
    vi.mocked(shop.summary).mockResolvedValue({
      counts: { toShip: 1, lateToShip: 0, toBag: 0, readyForPickup: 0, shippedLast7: 2, pickedUpLast7: 0 },
      sales: { paidCents: 12345, refundedCents: 0, orders: 3, days: [] },
      lowStock: [],
      settings: { shopPaused: false },
    } as never)
    vi.mocked(shop.orders).mockResolvedValue({
      rows: [{ id: "o1", number: "CN-1001", status: "paid", fulfilment: "ship", createdAt: "2026-11-03T10:00:00Z", customerName: "Dana Smith", customerEmail: "dana@example.com", itemsSummary: "1 × Tee", totalCents: 3500 }],
    } as never)
    vi.mocked(shop.products).mockResolvedValue([] as never)

    const out = await getShopOrders.execute({ orders: "open" }, ctx)

    expect(vi.mocked(shop.orders).mock.calls[0]).toEqual(["acct-A", "open"])
    expect(out.connected && out.sales.paid).toBe(123.45)
    expect(out.connected && out.orders[0]).toEqual({ number: "CN-1001", status: "paid", fulfilment: "ship", placed: "2026-11-03", customer: "Dana", items: "1 × Tee", total: 35 })
    expect(JSON.stringify(out)).not.toMatch(/dana@example\.com|Smith/)
  })
})

describe("getStoreSettings", () => {
  it("reads the account's stores and prints rates as percents", async () => {
    prisma.store.findMany.mockResolvedValue([
      {
        id: "s1", name: "Hollywood", lifecycleStage: "ready",
        uberCommissionRate: 0.21, doordashCommissionRate: 0.25, uberPickupCommissionRate: null,
        doordashPickupCommissionRate: 0.06, grubhubCommissionRate: 0.25, employerPayrollTaxRate: 0.0765,
        fixedMonthlyRent: 9000, fixedMonthlyLabor: null, fixedMonthlyTowels: 120, fixedMonthlyCleaning: null,
        targetCogsPct: 30, checkPauses: [],
        fixedExpenses: [{ label: "Insurance", amount: 1200, frequency: "YEARLY" }],
      },
    ])
    vi.mocked(loadObservedRates).mockResolvedValue([
      { platform: "doordash", mode: "delivery", rate: 0.2534, orders: 410, fee: 1, ticket: 4 },
    ])

    const out = await getStoreSettings.execute({}, ctx)

    expect(prisma.store.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["s1"] }, accountId: "acct-A" })
    expect(vi.mocked(loadObservedRates).mock.calls[0][0]).toMatchObject({ accountId: "acct-A", storeId: "s1" })
    expect(out.stores[0]).toMatchObject({
      stage: "Open",
      commissionPct: { doordashDelivery: 25, doordashPickup: 6, uberDelivery: 21, uberPickup: null, grubhub: 25 },
      observedCommission: [{ platform: "doordash", mode: "delivery", ratePct: 25.3, orders: 410 }],
      employerPayrollTaxPct: 7.65,
      monthlyFixed: { rent: 9000, salariedLabor: null, towels: 120, cleaning: null },
      otherFixedExpenses: [{ label: "Insurance", amount: 1200, frequency: "yearly", monthly: 100 }],
      checksPausedSince: null,
    })
  })
})
