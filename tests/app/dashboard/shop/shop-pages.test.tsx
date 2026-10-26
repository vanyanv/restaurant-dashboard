// @vitest-environment jsdom
// The five Shop tabs render what the adapter hands them, and each next step
// is a button that calls the right action with the right order.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/shop",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
vi.mock("@/lib/counter/actions/shop", () => {
  const ok = () => vi.fn(async () => ({ ok: true, message: "Done." }))
  return {
    shipOrder: ok(),
    markOrderReady: ok(),
    markOrderPickedUp: ok(),
    markOrderRefunded: ok(),
    createShopProduct: ok(),
    setShopProductStatus: ok(),
    setShopProductStock: ok(),
    saveShopProduct: ok(),
    saveShopSettings: ok(),
  }
})

import * as actions from "@/lib/counter/actions/shop"
import { ready } from "@/lib/counter/section-data"
import { orderLine, orderView, stockView, type TodayData } from "@/lib/counter/adapters/shop"
import { ShopTodayClient } from "@/app/dashboard/(counter)/shop/shop-today-client"
import { ShopOrdersClient } from "@/app/dashboard/(counter)/shop/orders/shop-orders-client"
import { ShopProductsClient } from "@/app/dashboard/(counter)/shop/products/shop-products-client"
import { ShopCustomersClient } from "@/app/dashboard/(counter)/shop/customers/shop-customers-client"
import { ShopSettingsClient } from "@/app/dashboard/(counter)/shop/settings/shop-settings-client"

const now = new Date("2026-10-26T20:00:00.000Z")
const base = {
  number: "CNE-1040",
  status: "paid" as const,
  fulfilment: "ship" as const,
  createdAt: "2026-10-26T18:00:00.000Z",
  customerName: "Ana L.",
  customerEmail: "ana@example.com",
  itemsSummary: "Dad Hat ×1",
  totalCents: 3800,
}
const toShip = orderLine({ ...base, id: "o-ship" }, now)
const toBag = orderLine({ ...base, id: "o-bag", number: "CNE-1041", fulfilment: "pickup", customerName: "Jon P." }, now)
const atCounter = orderLine({ ...base, id: "o-ctr", number: "CNE-1042", fulfilment: "pickup", status: "ready_for_pickup", customerName: "Maya R." }, now)

const today: TodayData = {
  counts: { toShip: 1, lateToShip: 0, toBag: 1, readyForPickup: 1, doneLast7: 3 },
  late: [],
  toShip: [toShip],
  pickup: [toBag, atCounter],
  sales7: { total: "$114.00", orders: 3, refunded: "$0.00", days: Array.from({ length: 7 }, (_, i) => ({ label: `Oct ${20 + i}`, cents: i * 100, amount: "$1.00" })) },
  lowStock: [{ productId: "p1", name: "Logo Tee", left: "2 left", out: false }],
  paused: { note: "Back Thursday" },
  pickupAddress: "5539 W. Sunset Blvd",
}

beforeEach(() => vi.clearAllMocks())

describe("Today", () => {
  it("shows the counts, the paused banner and each queue's next step", async () => {
    render(<ShopTodayClient sections={{ today: ready(today) }} />)
    expect(screen.getByText("The shop is paused.")).toBeTruthy()
    expect(screen.getByText("Back Thursday")).toBeTruthy()
    expect(screen.getByText("Logo Tee")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Ship it" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Bagged, ready for pickup" }))
    await waitFor(() => expect(actions.markOrderReady).toHaveBeenCalledWith({ orderId: "o-bag" }))
    fireEvent.click(screen.getByRole("button", { name: "Picked up" }))
    await waitFor(() => expect(actions.markOrderPickedUp).toHaveBeenCalledWith({ orderId: "o-ctr" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("Ship it opens the tracking form and sends carrier and number", async () => {
    render(<ShopTodayClient sections={{ today: ready(today) }} />)
    fireEvent.click(screen.getByRole("button", { name: "Ship it" }))
    fireEvent.change(screen.getByLabelText("Tracking number"), { target: { value: "1z999aa10123456784" } })
    // The number's shape picks the carrier.
    expect((screen.getByLabelText("Carrier") as HTMLSelectElement).value).toBe("UPS")
    fireEvent.click(screen.getByRole("button", { name: "Mark shipped" }))
    await waitFor(() =>
      expect(actions.shipOrder).toHaveBeenCalledWith({ orderId: "o-ship", carrier: "UPS", trackingNumber: "1Z999AA10123456784" }),
    )
  })
})

describe("Orders", () => {
  const selected = orderView(
    {
      id: "o-ship",
      number: "CNE-1040",
      status: "fulfilled",
      fulfilment: "ship",
      email: "ana@example.com",
      name: "Ana L.",
      phone: null,
      shipTo: { name: "Ana L", line1: "1 Main St", line2: null, city: "Los Angeles", state: "CA", postalCode: "90028", country: "US" },
      items: [{ id: "i1", productName: "Foam Trucker", sku: "FT-1", unitPriceCents: 3800, quantity: 1, editionNumber: 12, editionSize: 50, variantLabel: "One size" }],
      subtotalCents: 3800,
      shippingCents: 600,
      taxCents: 0,
      totalCents: 4400,
      currency: "usd",
      carrier: "USPS",
      trackingNumber: "9400100000000000000000",
      stripePaymentIntentId: "pi_1",
      notes: null,
      createdAt: "2026-10-26T18:00:00.000Z",
      paidAt: "2026-10-26T18:01:00.000Z",
      fulfilledAt: "2026-10-26T19:00:00.000Z",
      refundedAt: null,
      updatedAt: "2026-10-26T19:00:00.000Z",
    },
    now,
  )

  it("lists orders and opens one with its address, edition and refund", async () => {
    render(<ShopOrdersClient sections={{ orders: ready({ filter: "all", rows: [toShip, toBag], nextCursor: null, cursor: null, selected }) }} />)
    expect(screen.getByText("Los Angeles, CA 90028")).toBeTruthy()
    expect(screen.getByText(/Number 12 of 50/)).toBeTruthy()
    expect(screen.getByText("$44.00")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Mark refunded…" }))
    fireEvent.change(screen.getByLabelText("Why (only you see this)"), { target: { value: "Damaged" } })
    fireEvent.click(screen.getByLabelText("Put the numbered piece back on sale"))
    fireEvent.click(screen.getByRole("button", { name: "Mark refunded" }))
    await waitFor(() => expect(actions.markOrderRefunded).toHaveBeenCalledWith({ orderId: "o-ship", reason: "Damaged", release: true }))
  })
})

describe("Products", () => {
  it("saves a stock count in the row and only the changed fields in the editor", async () => {
    render(
      <ShopProductsClient
        sections={{
          products: ready({
            archived: false,
            rows: [{ id: "p1", name: "Logo Tee", stage: "Live", price: "$32.00", thumb: null, stock: stockView({ mode: "quantity", quantity: 2 }) }],
            selected: {
              id: "p1",
              slug: "logo-tee",
              name: "Logo Tee",
              stage: "Live",
              moves: [{ to: "draft", label: "Take it off the shop", primary: false }],
              displayName1: "Logo",
              displayName2: "Tee",
              eyebrow: "",
              description: "Soft.",
              priceCents: 3200,
              perOrderLimit: 4,
              sku: null,
              stock: stockView({ mode: "quantity", quantity: 2 }),
              photos: [],
              publishedAt: null,
              storeUrl: null,
              editUrl: null,
            },
          }),
        }}
      />,
    )
    const stock = screen.getByLabelText("In stock")
    fireEvent.change(stock, { target: { value: "12" } })
    fireEvent.click(within(stock.closest("form")!).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.setShopProductStock).toHaveBeenCalledWith({ productId: "p1", count: 12 }))

    fireEvent.change(screen.getByLabelText("Price, $"), { target: { value: "34.50" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!)
    await waitFor(() =>
      expect(actions.saveShopProduct).toHaveBeenCalledWith({
        productId: "p1",
        displayName1: undefined,
        displayName2: undefined,
        eyebrow: undefined,
        description: undefined,
        priceCents: 3450,
        perOrderLimit: undefined,
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Take it off the shop" }))
    await waitFor(() => expect(actions.setShopProductStatus).toHaveBeenCalledWith({ productId: "p1", status: "draft" }))
  })
})

describe("Customers", () => {
  it("lists customers and shows one's orders", () => {
    render(
      <ShopCustomersClient
        sections={{
          customers: ready({
            query: "",
            rows: [{ key: "ana@example.com", name: "Ana L.", email: "ana@example.com", orders: 2, spent: "$76.00", last: "Oct 26", refunded: 0 }],
            selected: {
              key: "ana@example.com",
              name: "Ana L.",
              email: "ana@example.com",
              phone: null,
              city: "Los Angeles",
              orders: 2,
              spent: "$76.00",
              since: "Oct 1",
              refunded: 0,
              history: [{ id: "o-ship", number: "CNE-1040", glyph: "ok", state: "Shipped", items: "Dad Hat ×1", total: "$38.00", placed: "Oct 26" }],
              numbers: ["Foam Trucker #12"],
            },
          }),
        }}
      />,
    )
    expect(screen.getByText("Foam Trucker #12")).toBeTruthy()
    expect(screen.getByRole("link", { name: /#1040/ }).getAttribute("href")).toBe("/dashboard/shop/orders?filter=all&order=o-ship")
  })
})

describe("Settings", () => {
  it("pauses the shop with a note and saves shipping in cents", async () => {
    render(
      <ShopSettingsClient
        sections={{
          settings: ready({
            storeName: "Chris N Eddy's",
            supportEmail: "hi@chrisneddys.com",
            pickupEnabled: true,
            pickupAddress: "5539 W. Sunset Blvd",
            shippingFlatCents: 600,
            shippingFreeOverCents: null,
            shipsWithin: null,
            shopPaused: false,
            pauseNote: null,
            shipCountries: ["US"],
            adminUrl: null,
          }),
        }}
      />,
    )
    fireEvent.click(screen.getByLabelText(/Pause the shop/))
    fireEvent.change(screen.getByLabelText("Line customers see while paused"), { target: { value: "Back Thursday" } })
    fireEvent.change(screen.getByLabelText(/Free over/), { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await waitFor(() =>
      expect(actions.saveShopSettings).toHaveBeenCalledWith({
        shopPaused: true,
        pauseNote: "Back Thursday",
        pickupEnabled: true,
        pickupAddress: "5539 W. Sunset Blvd",
        shippingFlatCents: 600,
        shippingFreeOverCents: 10000,
        shipsWithin: null,
        supportEmail: "hi@chrisneddys.com",
      }),
    )
  })
})
