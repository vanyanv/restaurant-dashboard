// The Shop adapter: "not connected" for every account but the shop's, and the
// Today tab built from the site's summary plus its open orders.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getShopOrdersSectionPromises, getShopTodaySectionPromises } from "@/lib/counter/adapters/shop"

const fetchMock = vi.fn()
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const now = new Date("2026-10-26T20:00:00.000Z")
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()

const row = (over: Record<string, unknown>) => ({
  id: "o1",
  number: "CNE-1040",
  status: "paid",
  fulfilment: "ship",
  createdAt: ago(2),
  customerName: "Ana L.",
  customerEmail: "ana@example.com",
  itemsSummary: "Dad Hat ×1",
  totalCents: 3800,
  ...over,
})

const summary = {
  ok: true,
  generatedAt: now.toISOString(),
  counts: { toShip: 2, lateToShip: 1, toBag: 1, readyForPickup: 1, shippedLast7: 4, pickedUpLast7: 2 },
  sales: {
    days: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i - 3).padStart(2, "0")}`, paidCents: i === 29 ? 3800 : 0, refundedCents: 0, orders: i === 29 ? 1 : 0 })),
    paidCents: 3800,
    refundedCents: 0,
    orders: 1,
  },
  lowStock: [{ productId: "p1", name: "Logo Tee", slug: "logo-tee", remaining: 0, mode: "quantity" }],
  settings: { pickupEnabled: true, pickupAddress: "5539 W. Sunset Blvd", shopPaused: true, pauseNote: null },
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SHOP_API_URL", "https://chrisneddys.com")
  vi.stubEnv("SHOP_INTERNAL_API_SECRET", "s".repeat(40))
  vi.stubEnv("SHOP_ACCOUNT_ID", "acct-shop")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe("getShopTodaySectionPromises", () => {
  it("another account sees owed work and never calls the site", async () => {
    const s = await getShopTodaySectionPromises({ accountId: "acct-demo", now }).today
    expect(s.status).toBe("not_computed")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("splits open orders into late, to ship and pickup", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/summary")
        ? json(summary)
        : json({
            ok: true,
            nextCursor: null,
            rows: [
              row({ id: "late", createdAt: ago(50) }),
              row({ id: "fresh" }),
              row({ id: "bag", fulfilment: "pickup" }),
              row({ id: "counter", fulfilment: "pickup", status: "ready_for_pickup" }),
            ],
          }),
    )
    const s = await getShopTodaySectionPromises({ accountId: "acct-shop", now }).today
    if (s.status !== "ready") throw new Error(`section ${s.status}`)
    expect(s.data.late.map((o) => o.id)).toEqual(["late"])
    expect(s.data.toShip.map((o) => o.id)).toEqual(["late", "fresh"])
    expect(s.data.pickup.map((o) => [o.id, o.next])).toEqual([["bag", "ready"], ["counter", "picked_up"]])
    expect(s.data.counts.doneLast7).toBe(6)
    expect(s.data.sales7.days).toHaveLength(7)
    expect(s.data.sales7.total).toBe("$38.00")
    expect(s.data.lowStock).toEqual([{ productId: "p1", name: "Logo Tee", left: "Sold out", out: true }])
    expect(s.data.paused).toEqual({ note: null })
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/orders\/\?filter=open$/)
  })

  it("pages through every open order, so the oldest (late) ones are not cut off", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/summary")) return json(summary)
      return url.includes("cursor=")
        ? json({ ok: true, nextCursor: null, rows: [row({ id: "oldest", createdAt: ago(70) })] })
        : json({ ok: true, nextCursor: "c2", rows: [row({ id: "new" })] })
    })
    const s = await getShopTodaySectionPromises({ accountId: "acct-shop", now }).today
    if (s.status !== "ready") throw new Error(`section ${s.status}`)
    expect(s.data.late.map((o) => o.id)).toEqual(["oldest"])
  })

  it("the site failing is a failed section, not a crashed page", async () => {
    fetchMock.mockImplementation(async () => json({ ok: false, error: "Internal error" }, 500))
    const s = await getShopTodaySectionPromises({ accountId: "acct-shop", now }).today
    expect(s).toMatchObject({ status: "failed", error: "chrisneddys.com had a problem answering (500)" })
  })
})

describe("getShopOrdersSectionPromises", () => {
  it("an order id that no longer exists just opens nothing", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/orders/gone") ? json({ ok: false, error: "Order not found." }, 404) : json({ ok: true, rows: [row({})], nextCursor: null }),
    )
    const s = await getShopOrdersSectionPromises({ accountId: "acct-shop", orderId: "gone", filter: "nonsense", now }).orders
    if (s.status !== "ready") throw new Error(`section ${s.status}`)
    expect(s.data.filter).toBe("open")
    expect(s.data.selected).toBeNull()
    expect(s.data.rows).toHaveLength(1)
  })
})
