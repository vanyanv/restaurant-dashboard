import {
  shop,
  shopAssetUrl,
  shopEnabledFor,
  ShopRefused,
  type ShopCustomer,
  type ShopFulfilment,
  type ShopInventory,
  type ShopOrderDetail,
  type ShopOrderFilter,
  type ShopOrderRow,
  type ShopOrderStatus,
  type ShopProduct,
  type ShopProductRow,
  type ShopProductStatus,
  type ShopSettings,
  type ShopShipTo,
} from "@/lib/shop/client"
import {
  LOW_STOCK_AT,
  moneyLabel,
  orderFilterOf,
  orderState,
  productLabel,
  remainingOf,
  type ShopGlyph,
  type ShopNextStep,
} from "@/lib/shop/status"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Shop — the merch shop's desk (Today, Orders, Products, Customers,
 * Settings). Nothing here touches Prisma: the shop's data lives in the
 * chrisneddys.com database and is read through the site's signed private API
 * (`src/lib/shop/client.ts`). `accountId` is still the boundary: the client
 * refuses any account that is not `SHOP_ACCOUNT_ID` before it reaches the
 * network, and every section below says "not connected" for those accounts
 * rather than failing.
 *
 * What an order's status means (glyph, word, next step) comes from one
 * function, `orderState` in `src/lib/shop/status.ts`, on every tab.
 */

const NOT_CONNECTED = "The shop isn't connected to this dashboard yet"

const TZ = "America/Los_Angeles"
const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})
const shortDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" })

export function whenLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dateTime.format(d).replace(" AM", " am").replace(" PM", " pm")
}

function dayLabel(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : shortDay.format(d)
}

/** One section per tab, with the same "not connected" short-circuit everywhere. */
function shopSection<T>(
  accountId: string,
  retryAction: string,
  load: () => Promise<T>,
  opts: { isEmpty?: (v: T) => boolean } = {},
): Promise<SectionData<T>> {
  const enabled = shopEnabledFor(accountId)
  return guardSection(
    classify(load, {
      retryAction,
      owed: enabled ? undefined : NOT_CONNECTED,
      isEmpty: opts.isEmpty,
      emptyReason: "all_clear",
    }),
    retryAction,
  )
}

// ─── Orders, as every tab shows them ────────────────────────────────────────

export type OrderLine = {
  id: string
  number: string
  status: ShopOrderStatus
  fulfilment: ShopFulfilment
  glyph: ShopGlyph
  stateLabel: string
  next: ShopNextStep | null
  canRefund: boolean
  customer: string
  email: string | null
  items: string
  total: string
  placed: string | null
}

export function orderLine(o: ShopOrderRow, now: Date): OrderLine {
  const st = orderState(o, now)
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    fulfilment: o.fulfilment,
    glyph: st.glyph,
    stateLabel: st.label,
    next: st.next,
    canRefund: st.canRefund,
    customer: o.customerName || o.customerEmail || "No name",
    email: o.customerEmail,
    items: o.itemsSummary,
    total: moneyLabel(o.totalCents),
    placed: whenLabel(o.createdAt),
  }
}

export type OrderView = OrderLine & {
  phone: string | null
  shipTo: string[] | null
  lines: Array<{ id: string; name: string; detail: string; qty: number; price: string }>
  subtotal: string
  shipping: string
  tax: string
  carrier: string | null
  trackingNumber: string | null
  notes: string[]
  timeline: Array<{ label: string; at: string }>
  stripeUrl: string | null
}

function addressLines(a: ShopShipTo | null): string[] | null {
  if (!a) return null
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
  const lines = [a.name, a.line1, a.line2, cityLine, a.country && a.country !== "US" ? a.country : null]
  return lines.filter((l): l is string => Boolean(l && l.trim()))
}

export function orderView(o: ShopOrderDetail, now: Date): OrderView {
  const base = orderLine(
    {
      id: o.id,
      number: o.number,
      status: o.status,
      fulfilment: o.fulfilment,
      createdAt: o.paidAt ?? o.createdAt,
      customerName: o.name,
      customerEmail: o.email,
      itemsSummary: o.items.map((i) => `${i.productName}${i.editionNumber !== null ? ` #${i.editionNumber}` : ""} ×${i.quantity}`).join(", "),
      totalCents: o.totalCents,
    },
    now,
  )
  const timeline: OrderView["timeline"] = []
  const push = (label: string, iso: string | null) => {
    const at = whenLabel(iso)
    if (at) timeline.push({ label, at })
  }
  push("Placed", o.createdAt)
  push("Paid", o.paidAt)
  push(o.fulfilment === "ship" ? "Shipped" : "Handed over", o.fulfilledAt)
  if (o.status === "ready_for_pickup") push("Bagged, ready for pickup", o.updatedAt)
  if (o.status === "picked_up" && !o.fulfilledAt) push("Picked up", o.updatedAt)
  if (o.status === "cancelled") push("Cancelled", o.updatedAt)
  push("Refunded", o.refundedAt)

  return {
    ...base,
    placed: whenLabel(o.createdAt),
    phone: o.phone,
    shipTo: o.fulfilment === "ship" ? addressLines(o.shipTo) : null,
    lines: o.items.map((i) => ({
      id: i.id,
      name: i.productName,
      detail: [
        i.variantLabel && i.variantLabel !== "One size" ? i.variantLabel : null,
        i.editionNumber !== null ? `Number ${i.editionNumber}${i.editionSize ? ` of ${i.editionSize}` : ""}` : null,
        i.sku,
      ]
        .filter(Boolean)
        .join(" · "),
      qty: i.quantity,
      price: moneyLabel(i.unitPriceCents * i.quantity),
    })),
    subtotal: moneyLabel(o.subtotalCents),
    shipping: o.fulfilment === "pickup" ? "Pickup" : moneyLabel(o.shippingCents),
    tax: moneyLabel(o.taxCents),
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
    notes: (o.notes ?? "").split("\n").map((n) => n.trim()).filter(Boolean),
    timeline,
    stripeUrl: o.stripePaymentIntentId ? `https://dashboard.stripe.com/payments/${encodeURIComponent(o.stripePaymentIntentId)}` : null,
  }
}

/** A detail fetch that turns "that id doesn't exist" into nothing selected, not a failed page. */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (err) {
    if (err instanceof ShopRefused) return null
    throw err
  }
}

// ─── Today ──────────────────────────────────────────────────────────────────

export type TodayData = {
  counts: { toShip: number; lateToShip: number; toBag: number; readyForPickup: number; doneLast7: number }
  late: OrderLine[]
  toShip: OrderLine[]
  pickup: OrderLine[]
  sales7: { total: string; orders: number; refunded: string; days: Array<{ label: string; cents: number; amount: string }> }
  lowStock: Array<{ productId: string; name: string; left: string; out: boolean }>
  paused: { note: string | null } | null
  pickupAddress: string | null
}
export type TodaySections = { today: SectionData<TodayData> }

export function getShopTodaySectionPromises(opts: { accountId: string; now?: Date }): StreamedSections<TodaySections> {
  const now = opts.now ?? new Date()
  return {
    today: shopSection(opts.accountId, "shop.today", async () => {
      const [summary, open] = await Promise.all([
        shop.summary(opts.accountId),
        shop.orders(opts.accountId, "open"),
      ])
      const lines = open.rows.map((r) => orderLine(r, now))
      const days = summary.sales.days.slice(-7)
      return {
        counts: {
          toShip: summary.counts.toShip,
          lateToShip: summary.counts.lateToShip,
          toBag: summary.counts.toBag,
          readyForPickup: summary.counts.readyForPickup,
          doneLast7: summary.counts.shippedLast7 + summary.counts.pickedUpLast7,
        },
        late: lines.filter((l) => l.glyph === "late"),
        toShip: lines.filter((l) => l.fulfilment === "ship" && l.next === "ship"),
        pickup: lines.filter((l) => l.fulfilment === "pickup"),
        sales7: {
          total: moneyLabel(days.reduce((s, d) => s + d.paidCents, 0)),
          orders: days.reduce((s, d) => s + d.orders, 0),
          refunded: moneyLabel(days.reduce((s, d) => s + d.refundedCents, 0)),
          days: days.map((d) => ({
            label: dayLabel(`${d.date}T20:00:00.000Z`) ?? d.date,
            cents: d.paidCents,
            amount: moneyLabel(d.paidCents),
          })),
        },
        lowStock: summary.lowStock.map((p) => ({
          productId: p.productId,
          name: p.name,
          left: p.remaining === 0 ? "Sold out" : `${p.remaining} left`,
          out: p.remaining === 0,
        })),
        paused: summary.settings.shopPaused ? { note: summary.settings.pauseNote } : null,
        pickupAddress: summary.settings.pickupEnabled ? summary.settings.pickupAddress : null,
      }
    }),
  }
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export type OrdersData = {
  filter: ShopOrderFilter
  rows: OrderLine[]
  nextCursor: string | null
  cursor: string | null
  selected: OrderView | null
}
export type OrdersSections = { orders: SectionData<OrdersData> }

export function getShopOrdersSectionPromises(opts: {
  accountId: string
  filter?: string
  cursor?: string
  orderId?: string
  now?: Date
}): StreamedSections<OrdersSections> {
  const now = opts.now ?? new Date()
  const filter = orderFilterOf(opts.filter)
  return {
    orders: shopSection(opts.accountId, "shop.orders", async () => {
      const [list, detail] = await Promise.all([
        shop.orders(opts.accountId, filter, opts.cursor),
        opts.orderId ? orNull(shop.order(opts.accountId, opts.orderId)) : Promise.resolve(null),
      ])
      return {
        filter,
        rows: list.rows.map((r) => orderLine(r, now)),
        nextCursor: list.nextCursor,
        cursor: opts.cursor ?? null,
        selected: detail ? orderView(detail, now) : null,
      }
    }),
  }
}

// ─── Products ───────────────────────────────────────────────────────────────

export type StockView =
  | { mode: "untracked"; label: string }
  | { mode: "quantity"; count: number; label: string; low: boolean }
  | { mode: "edition"; label: string; low: boolean; size: number; sold: number; reserved: number; available: number; setAside: number }

export function stockView(inv: ShopInventory): StockView {
  const left = remainingOf(inv)
  const low = left !== null && left <= LOW_STOCK_AT
  if (inv.mode === "quantity") {
    return { mode: "quantity", count: inv.quantity, low, label: inv.quantity === 0 ? "Sold out" : `${inv.quantity} in stock` }
  }
  if (inv.mode === "edition") {
    return {
      mode: "edition",
      low,
      size: inv.editionSize,
      sold: inv.sold,
      reserved: inv.reserved,
      available: inv.available,
      setAside: inv.setAside,
      label: inv.available === 0 ? `Sold out · run of ${inv.editionSize}` : `${inv.available} of ${inv.editionSize} left`,
    }
  }
  return { mode: "untracked", label: "Not counted" }
}

export const STAGE_LABEL: Record<ShopProductStatus, string> = { draft: "Draft", published: "Live", archived: "Archived" }

/** The status changes an owner can make from where a product is now. */
export type ProductMove = { to: ShopProductStatus; label: string; primary: boolean }

function movesFrom(s: ShopProductStatus): ProductMove[] {
  const moves: ProductMove[] = []
  if (s !== "published") moves.push({ to: "published", label: "Put it live", primary: true })
  if (s === "published") moves.push({ to: "draft", label: "Take it off the shop", primary: false })
  if (s !== "archived") moves.push({ to: "archived", label: "Archive", primary: false })
  return moves
}

export type ProductLine = {
  id: string
  name: string
  stage: string
  price: string
  thumb: string | null
  stock: StockView
}

function productLine(p: ShopProductRow): ProductLine {
  return {
    id: p.id,
    name: productLabel(p) || "Unnamed draft",
    stage: STAGE_LABEL[p.status],
    price: moneyLabel(p.priceCents),
    thumb: shopAssetUrl(p.thumbUrl),
    stock: stockView(p.inventory),
  }
}

export type ProductEdit = {
  id: string
  slug: string
  name: string
  stage: string
  moves: ProductMove[]
  displayName1: string
  displayName2: string
  eyebrow: string
  description: string
  priceCents: number
  perOrderLimit: number
  sku: string | null
  stock: StockView
  photos: Array<{ id: string; url: string; alt: string }>
  publishedAt: string | null
  storeUrl: string | null
  editUrl: string | null
}

function productEdit(p: ShopProduct): ProductEdit {
  return {
    id: p.id,
    slug: p.slug,
    name: productLabel(p) || "Unnamed draft",
    stage: STAGE_LABEL[p.status],
    moves: movesFrom(p.status),
    displayName1: p.displayName1,
    displayName2: p.displayName2,
    eyebrow: p.eyebrow,
    description: p.description,
    priceCents: p.priceCents,
    perOrderLimit: p.perOrderLimit,
    sku: p.sku,
    stock: stockView(p.inventory),
    photos: p.views
      .map((v) => ({ id: v.id, url: shopAssetUrl(v.urlThumb ?? v.urlMid ?? v.urlFull), alt: v.alt || v.label }))
      .filter((v): v is { id: string; url: string; alt: string } => v.url !== null),
    publishedAt: dayLabel(p.publishedAt),
    storeUrl: p.status === "published" ? shopAssetUrl(`/shop/${p.slug}`) : null,
    editUrl: shopAssetUrl(`/admin/products/${encodeURIComponent(p.id)}`),
  }
}

export type ProductsData = {
  archived: boolean
  rows: ProductLine[]
  selected: ProductEdit | null
}
export type ProductsSections = { products: SectionData<ProductsData> }

export function getShopProductsSectionPromises(opts: {
  accountId: string
  archived?: boolean
  productId?: string
}): StreamedSections<ProductsSections> {
  return {
    products: shopSection(opts.accountId, "shop.products", async () => {
      const [rows, detail] = await Promise.all([
        shop.products(opts.accountId, opts.archived ?? false),
        opts.productId ? orNull(shop.product(opts.accountId, opts.productId)) : Promise.resolve(null),
      ])
      return {
        archived: opts.archived ?? false,
        // The main list is every product but archived ones, as on the site's rack.
        rows: rows.filter((p) => opts.archived || p.status !== "archived").map(productLine),
        selected: detail ? productEdit(detail) : null,
      }
    }),
  }
}

// ─── Customers ──────────────────────────────────────────────────────────────

export type CustomerLine = {
  key: string
  name: string
  email: string
  orders: number
  spent: string
  last: string | null
  refunded: number
}

export type CustomerView = {
  key: string
  name: string
  email: string
  phone: string | null
  city: string | null
  orders: number
  spent: string
  since: string | null
  refunded: number
  history: Array<{ id: string; number: string; glyph: ShopGlyph; state: string; items: string; total: string; placed: string | null }>
  numbers: string[]
}

function customerView(c: ShopCustomer, now: Date): CustomerView {
  return {
    key: c.key,
    name: c.name || c.email,
    email: c.email,
    phone: c.phone,
    city: c.city,
    orders: c.orderCount,
    spent: moneyLabel(c.totalSpentCents),
    since: dayLabel(c.firstOrderAt),
    refunded: c.refundedCount,
    history: c.orders.map((o) => {
      const st = orderState(
        { status: o.status as ShopOrderStatus, fulfilment: o.fulfilment as ShopFulfilment, createdAt: o.createdAt },
        now,
      )
      return { id: o.id, number: o.number, glyph: st.glyph, state: st.label, items: o.itemsSummary, total: moneyLabel(o.totalCents), placed: dayLabel(o.createdAt) }
    }),
    numbers: c.ownedNumbers.map((n) => `${n.productName} #${n.number}`),
  }
}

export type CustomersData = { rows: CustomerLine[]; query: string; selected: CustomerView | null }
export type CustomersSections = { customers: SectionData<CustomersData> }

export function getShopCustomersSectionPromises(opts: {
  accountId: string
  query?: string
  customerKey?: string
  now?: Date
}): StreamedSections<CustomersSections> {
  const now = opts.now ?? new Date()
  const q = (opts.query ?? "").trim().toLowerCase()
  return {
    customers: shopSection(opts.accountId, "shop.customers", async () => {
      const [rows, detail] = await Promise.all([
        shop.customers(opts.accountId),
        opts.customerKey ? orNull(shop.customer(opts.accountId, opts.customerKey)) : Promise.resolve(null),
      ])
      return {
        query: opts.query ?? "",
        rows: rows
          .filter((c) => !q || c.email.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q))
          .map((c) => ({
            key: c.key,
            name: c.name || c.email,
            email: c.email,
            orders: c.orderCount,
            spent: moneyLabel(c.totalSpentCents),
            last: dayLabel(c.lastOrderAt),
            refunded: c.refundedCount,
          })),
        selected: detail ? customerView(detail, now) : null,
      }
    }),
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type SettingsData = Pick<
  ShopSettings,
  "storeName" | "supportEmail" | "pickupEnabled" | "pickupAddress" | "shippingFlatCents" | "shippingFreeOverCents" | "shipsWithin" | "shopPaused" | "pauseNote" | "shipCountries"
> & { adminUrl: string | null }
export type SettingsSections = { settings: SectionData<SettingsData> }

export function getShopSettingsSectionPromises(opts: { accountId: string }): StreamedSections<SettingsSections> {
  return {
    settings: shopSection(opts.accountId, "shop.settings", async () => {
      const s = await shop.settings(opts.accountId)
      return {
        storeName: s.storeName,
        supportEmail: s.supportEmail,
        pickupEnabled: s.pickupEnabled,
        pickupAddress: s.pickupAddress,
        shippingFlatCents: s.shippingFlatCents,
        shippingFreeOverCents: s.shippingFreeOverCents,
        shipsWithin: s.shipsWithin,
        shopPaused: s.shopPaused,
        pauseNote: s.pauseNote,
        shipCountries: s.shipCountries,
        adminUrl: shopAssetUrl("/admin/settings"),
      }
    }),
  }
}
