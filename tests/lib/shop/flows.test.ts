// Every Shop write, end to end on the dashboard's side: the server action's
// session and owner checks, the signed request the site will verify, and what
// the owner is told back. `fetch` is mocked at the network edge, so the URL,
// method, body and signature asserted here are exactly what leaves the app.

import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  authOptions: {},
  hasOwnerAccess: (role: string) => role === "OWNER" || role === "DEVELOPER",
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import {
  createShopProduct,
  markOrderPickedUp,
  markOrderReady,
  markOrderRefunded,
  saveShopProduct,
  saveShopSettings,
  setShopProductStatus,
  setShopProductStock,
  shipOrder,
} from "@/lib/counter/actions/shop"

const SECRET = "s".repeat(40)
const fetchMock = vi.fn()

type Sent = { url: string; method: string; body: unknown; ts: string; sig: string; raw: string }

function sent(i = 0): Sent {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit]
  const headers = init.headers as Record<string, string>
  const raw = (init.body as string | undefined) ?? ""
  return {
    url,
    method: init.method ?? "GET",
    raw,
    body: raw ? JSON.parse(raw) : undefined,
    ts: headers["x-shop-timestamp"],
    sig: headers["x-shop-signature"],
  }
}

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
}

function asOwner(accountId = "acct-shop", role = "OWNER") {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", accountId, role } } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  vi.stubEnv("SHOP_API_URL", "https://chrisneddys.com/")
  vi.stubEnv("SHOP_INTERNAL_API_SECRET", SECRET)
  vi.stubEnv("SHOP_ACCOUNT_ID", "acct-shop")
  asOwner()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("the signed request", () => {
  it("signs timestamp, method, path and exact body the way the site checks it", async () => {
    reply(200, { ok: true })
    await shipOrder({ orderId: "ord_1", carrier: "USPS", trackingNumber: "9400 1000 0000 0000 0000 00" })
    const s = sent()
    expect(s.url).toBe("https://chrisneddys.com/api/internal/shop/orders/ord_1/ship/")
    expect(s.method).toBe("POST")
    // Written out independently of the client, from the site's internalApi.ts contract.
    const expected = createHmac("sha256", SECRET)
      .update(`${s.ts}.POST./api/internal/shop/orders/ord_1/ship/.${s.raw}`)
      .digest("hex")
    expect(s.sig).toBe(expected)
    expect(Math.abs(Date.now() - Number(s.ts))).toBeLessThan(5_000)
  })
})

describe("paths the site's trailing-slash rule accepts as they are", () => {
  it("slashes a plain path, not one ending like a file (an email key)", async () => {
    const { shop } = await import("@/lib/shop/client")
    reply(200, { ok: true, customer: {} })
    reply(200, { ok: true, rows: [], nextCursor: null })
    await shop.customer("acct-shop", "ana@contract.test")
    await shop.orders("acct-shop", "open")
    expect(sent(0).url).toBe("https://chrisneddys.com/api/internal/shop/customers/ana%40contract.test")
    expect(sent(1).url).toBe("https://chrisneddys.com/api/internal/shop/orders/?filter=open")
    // A redirect would be checked against a path that wasn't signed.
    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe("error")
  })
})

describe("orders", () => {
  it("ship: sends carrier and the tracking number without spaces, then refreshes Shop", async () => {
    reply(200, { ok: true })
    const r = await shipOrder({ orderId: "ord_1", carrier: "USPS", trackingNumber: " 9400 1000 0000 0000 0000 00 " })
    expect(r).toEqual({ ok: true, message: "Shipped. The customer has the tracking email." })
    expect(sent().body).toEqual({ carrier: "USPS", trackingNumber: "9400100000000000000000" })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/shop", "layout")
  })

  it("ship: refuses an empty or too-short tracking number before calling the site", async () => {
    expect(await shipOrder({ orderId: "ord_1", carrier: "USPS", trackingNumber: "  " })).toMatchObject({ ok: false })
    expect(await shipOrder({ orderId: "ord_1", carrier: "", trackingNumber: "1Z999AA10123456784" })).toEqual({ ok: false, error: "Pick a carrier" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ship: shows the site's own sentence when it refuses the move", async () => {
    reply(400, { ok: false, error: 'Can\'t do this from status "fulfilled".' })
    const r = await shipOrder({ orderId: "ord_1", carrier: "UPS", trackingNumber: "1Z999AA10123456784" })
    expect(r).toEqual({ ok: false, error: 'Can\'t do this from status "fulfilled".' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("ready for pickup, then picked up", async () => {
    reply(200, { ok: true })
    expect(await markOrderReady({ orderId: "ord_2" })).toMatchObject({ ok: true })
    reply(200, { ok: true })
    expect(await markOrderPickedUp({ orderId: "ord_2" })).toMatchObject({ ok: true })
    expect(sent(0).url).toMatch(/\/orders\/ord_2\/ready\/$/)
    expect(sent(1).url).toMatch(/\/orders\/ord_2\/picked-up\/$/)
    expect(sent(0).body).toEqual({})
  })

  it("refund: passes the reason and whether to put an edition number back", async () => {
    reply(200, { ok: true })
    expect(await markOrderRefunded({ orderId: "ord_3", reason: "  Wrong size ", release: true })).toMatchObject({ ok: true })
    expect(sent().url).toMatch(/\/orders\/ord_3\/refund\/$/)
    expect(sent().body).toEqual({ reason: "Wrong size", release: true })
  })

  it("refund: an empty reason is left out", async () => {
    reply(200, { ok: true })
    await markOrderRefunded({ orderId: "ord_3", reason: "" })
    expect(sent().body).toEqual({})
  })

  it("a dot-segment id is refused before signing", async () => {
    expect(await markOrderReady({ orderId: ".." })).toEqual({ ok: false, error: "Not found." })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an order id with slashes cannot reach another route", async () => {
    reply(404, { ok: false, error: "Order not found." })
    const r = await markOrderReady({ orderId: "../products/p1/status" })
    expect(sent().url).toBe("https://chrisneddys.com/api/internal/shop/orders/..%2Fproducts%2Fp1%2Fstatus/ready/")
    expect(r).toEqual({ ok: false, error: "Order not found." })
  })
})

describe("products", () => {
  it("create a draft", async () => {
    reply(200, { ok: true, id: "p9", slug: "new-hat" })
    expect(await createShopProduct({ name: " New Hat " })).toEqual({ ok: true, message: "Draft created.", id: "p9" })
    expect(sent().body).toEqual({ name: "New Hat" })
  })

  it("status: live, back to draft, archive", async () => {
    for (const status of ["published", "draft", "archived"] as const) reply(200, { ok: true })
    expect((await setShopProductStatus({ productId: "p1", status: "published" })).ok).toBe(true)
    await setShopProductStatus({ productId: "p1", status: "draft" })
    await setShopProductStatus({ productId: "p1", status: "archived" })
    expect(fetchMock.mock.calls.map((_, i) => sent(i).body)).toEqual([{ status: "published" }, { status: "draft" }, { status: "archived" }])
    expect(await setShopProductStatus({ productId: "p1", status: "deleted" })).toMatchObject({ ok: false })
  })

  it("status: a publish the site refuses says why", async () => {
    reply(400, { ok: false, error: "Add a photo before publishing." })
    expect(await setShopProductStatus({ productId: "p1", status: "published" })).toEqual({ ok: false, error: "Add a photo before publishing." })
  })

  it("stock: whole numbers only, 0 allowed", async () => {
    reply(200, { ok: true })
    expect(await setShopProductStock({ productId: "p1", count: 0 })).toMatchObject({ ok: true })
    expect(sent().body).toEqual({ count: 0 })
    expect(await setShopProductStock({ productId: "p1", count: -1 })).toEqual({ ok: false, error: "Stock can't be negative" })
    expect(await setShopProductStock({ productId: "p1", count: 1.5 })).toEqual({ ok: false, error: "Stock is a whole number" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("edit: sends only the changed fields, each tagged with the product id", async () => {
    reply(200, { ok: true, applied: 2 })
    await saveShopProduct({ productId: "p1", displayName1: " Dad Hat ", priceCents: 3400 })
    expect(sent().body).toEqual({
      changes: [
        { id: "p1", field: "displayName1", value: "Dad Hat" },
        { id: "p1", field: "priceCents", value: 3400 },
      ],
    })
  })

  it("edit: nothing changed sends nothing", async () => {
    expect(await saveShopProduct({ productId: "p1" })).toEqual({ ok: true, message: "Nothing changed." })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("settings", () => {
  it("pause with a note, pickup and shipping", async () => {
    reply(200, { ok: true, settings: {} })
    const r = await saveShopSettings({
      shopPaused: true,
      pauseNote: "Back Thursday",
      pickupEnabled: true,
      pickupAddress: "5539 W. Sunset Blvd",
      shippingFlatCents: 600,
      shippingFreeOverCents: null,
      shipsWithin: "",
      supportEmail: "hi@chrisneddys.com",
    })
    expect(r).toEqual({ ok: true, message: "Settings saved." })
    expect(sent().url).toMatch(/\/settings\/$/)
    expect(sent().body).toEqual({
      shopPaused: true,
      pauseNote: "Back Thursday",
      pickupEnabled: true,
      pickupAddress: "5539 W. Sunset Blvd",
      shippingFlatCents: 600,
      shippingFreeOverCents: null,
      shipsWithin: null,
      supportEmail: "hi@chrisneddys.com",
    })
  })

  it("refuses pickup without an address and a bad email", async () => {
    expect(await saveShopSettings({ pickupEnabled: true, pickupAddress: "  " })).toEqual({ ok: false, error: "Pickup needs an address" })
    expect(await saveShopSettings({ supportEmail: "nope" })).toEqual({ ok: false, error: "Enter a valid email address" })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("who may", () => {
  it("nobody signed in", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await markOrderReady({ orderId: "o" })).toEqual({ ok: false, error: "Unauthorized" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a manager is not an owner", async () => {
    asOwner("acct-shop", "MANAGER")
    expect(await markOrderReady({ orderId: "o" })).toEqual({ ok: false, error: "Forbidden" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an owner of another account never reaches the site", async () => {
    asOwner("acct-demo")
    expect(await markOrderReady({ orderId: "o" })).toEqual({ ok: false, error: "The shop isn't connected to this account" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a short secret counts as not connected", async () => {
    vi.stubEnv("SHOP_INTERNAL_API_SECRET", "short")
    expect((await markOrderReady({ orderId: "o" })).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a key mismatch says which setting to check", async () => {
    reply(401, { ok: false, error: "Unauthorized" })
    expect(await markOrderReady({ orderId: "o" })).toEqual({
      ok: false,
      error: "chrisneddys.com refused the dashboard's key. Check SHOP_INTERNAL_API_SECRET on both apps",
    })
  })

  it("the site being down says so", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"))
    expect(await markOrderReady({ orderId: "o" })).toEqual({ ok: false, error: "chrisneddys.com did not answer" })
  })
})
