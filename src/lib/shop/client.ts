import "server-only"
import { createHmac } from "node:crypto"

/**
 * The dashboard's side of the shop connection.
 *
 * The merch shop (products, orders, Stripe, order emails) lives in the
 * chrisneddys.com app and its own database. The dashboard never reads that
 * database: it calls the site's private API at `/api/internal/shop/*`, and
 * every rule (which transitions are legal, what email goes out, what a
 * refund releases) stays in one place, on the site.
 *
 * Every request is signed with `SHOP_INTERNAL_API_SECRET`, the same secret the
 * site holds: hex HMAC-SHA256 over `${timestamp}.${METHOD}.${path?query}.${body}`.
 * The site refuses anything more than five minutes old.
 *
 * Only one account owns the shop. `SHOP_ACCOUNT_ID` names it; every other
 * account (the demo one included) sees "not connected" and never reaches the
 * network. That id is the tenancy boundary here, the same job `accountId`
 * does in every Prisma query.
 */

export type ShopConfig = { baseUrl: string; secret: string; accountId: string }

/** A site path (`/shop/x.webp`) made absolute against the shop's own origin. */
export function shopAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (/^https?:\/\//.test(url)) return url
  const cfg = shopConfig()
  return cfg && url.startsWith("/") ? `${cfg.baseUrl}${url}` : null
}

export function shopConfig(): ShopConfig | null {
  const baseUrl = process.env.SHOP_API_URL?.trim().replace(/\/+$/, "")
  const secret = process.env.SHOP_INTERNAL_API_SECRET?.trim()
  const accountId = process.env.SHOP_ACCOUNT_ID?.trim()
  if (!baseUrl || !secret || secret.length < 32 || !accountId) return null
  return { baseUrl, secret, accountId }
}

/** Whether this account is the one the shop belongs to, and the shop is configured. */
export function shopEnabledFor(accountId: string): boolean {
  const cfg = shopConfig()
  return cfg !== null && cfg.accountId === accountId
}

export function signShopRequest(
  secret: string,
  method: string,
  pathWithSearch: string,
  body: string,
  timestamp: number,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathWithSearch}.${body}`)
    .digest("hex")
}

export class ShopNotConnected extends Error {
  constructor() {
    super("The shop isn't connected to this account")
  }
}

/** A refusal the site wrote for a person to read ("Enter a tracking number."). */
export class ShopRefused extends Error {}

const TIMEOUT_MS = 12_000

async function call<T>(
  accountId: string,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
): Promise<T> {
  const cfg = shopConfig()
  if (!cfg || cfg.accountId !== accountId) throw new ShopNotConnected()

  const body = payload === undefined ? "" : JSON.stringify(payload)
  // The site runs with `trailingSlash: true`: a path without one is a 308 to
  // the slashed path, and the site signs-checks the path it was finally asked
  // for. So ask for the slashed path, sign exactly that, and never follow a
  // redirect (a redirected request would be checked against a path we didn't sign).
  // Next's rule has one exception: a last segment that looks like a file
  // (`.\w+` at the end, which every email-keyed customer path does) keeps
  // no slash.
  const [pathname, search] = path.split("?")
  const slash = /\.\w+$/.test(pathname) ? "" : "/"
  const pathWithSearch = `/api/internal/shop${pathname}${slash}${search ? `?${search}` : ""}`
  const ts = Date.now()
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${pathWithSearch}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-shop-timestamp": String(ts),
        "x-shop-signature": signShopRequest(cfg.secret, method, pathWithSearch, body, ts),
      },
      body: method === "GET" ? undefined : body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new Error("chrisneddys.com did not answer")
  }

  let json: { ok?: boolean; error?: string } & Record<string, unknown>
  try {
    json = await res.json()
  } catch {
    throw new Error(`chrisneddys.com answered ${res.status} with no data`)
  }
  if (res.status === 401 || res.status === 503) {
    throw new Error("chrisneddys.com refused the dashboard's key. Check SHOP_INTERNAL_API_SECRET on both apps")
  }
  if (!res.ok || json.ok === false) {
    // 400s carry a sentence written for the owner; anything else is ours.
    if (res.status === 400 || res.status === 404) throw new ShopRefused(json.error ?? "The shop refused that")
    throw new Error(`chrisneddys.com had a problem answering (${res.status})`)
  }
  return json as T
}

// ─── What the site returns (dates arrive as ISO strings) ────────────────────

export type ShopOrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "ready_for_pickup"
  | "picked_up"
  | "refunded"
  | "cancelled"
export type ShopFulfilment = "ship" | "pickup"

export type ShopSummary = {
  generatedAt: string
  counts: {
    toShip: number
    lateToShip: number
    toBag: number
    readyForPickup: number
    shippedLast7: number
    pickedUpLast7: number
  }
  sales: {
    days: Array<{ date: string; paidCents: number; refundedCents: number; orders: number }>
    paidCents: number
    refundedCents: number
    orders: number
  }
  lowStock: Array<{ productId: string; name: string; slug: string; remaining: number; mode: "quantity" | "edition" }>
  settings: { pickupEnabled: boolean; pickupAddress: string; shopPaused: boolean; pauseNote: string | null }
}

export type ShopOrderRow = {
  id: string
  number: string
  status: ShopOrderStatus
  fulfilment: ShopFulfilment
  createdAt: string
  customerName: string | null
  customerEmail: string | null
  itemsSummary: string
  totalCents: number
}

export type ShopShipTo = {
  name?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

export type ShopOrderDetail = {
  id: string
  number: string
  status: ShopOrderStatus
  fulfilment: ShopFulfilment
  email: string | null
  name: string | null
  phone: string | null
  shipTo: ShopShipTo | null
  items: Array<{
    id: string
    productName: string
    sku: string
    unitPriceCents: number
    quantity: number
    editionNumber: number | null
    editionSize: number | null
    variantLabel: string
  }>
  subtotalCents: number
  shippingCents: number
  taxCents: number
  totalCents: number
  currency: string
  carrier: string | null
  trackingNumber: string | null
  stripePaymentIntentId: string | null
  notes: string | null
  createdAt: string
  paidAt: string | null
  fulfilledAt: string | null
  refundedAt: string | null
  updatedAt: string
}

export type ShopInventory =
  | { mode: "untracked" }
  | { mode: "quantity"; quantity: number }
  | { mode: "edition"; editionSize: number; sold: number; reserved: number; available: number; setAside: number }

export type ShopProductImage = {
  id: string
  viewId: string
  label: string
  alt: string
  src: string
  urlFull: string | null
  urlMid: string | null
  urlThumb: string | null
  position: number
}

export type ShopProductStatus = "draft" | "published" | "archived"

export type ShopProductRow = {
  id: string
  slug: string
  name: string
  /** What a customer sees, line 1. Empty on an unnamed draft. */
  displayName1: string
  displayName2: string
  status: ShopProductStatus
  priceCents: number
  position: number
  updatedAt: string
  /** Absolute, or a path on the site (`/shop/...`). */
  thumbUrl: string | null
  inventory: ShopInventory
}

export type ShopProduct = {
  id: string
  slug: string
  name: string
  photoDir: string | null
  displayName1: string
  displayName2: string
  eyebrow: string
  description: string
  priceCents: number
  perOrderLimit: number
  status: ShopProductStatus
  sku: string | null
  inventory: ShopInventory
  views: ShopProductImage[]
  editions: Array<{ number: number; status: "available" | "reserved" | "sold" | "set_aside" }>
  publishedAt: string | null
  updatedAt: string
}

/** The fields the dashboard edits. The site validates each one with the admin's own rules. */
export type ShopProductField = "displayName1" | "displayName2" | "eyebrow" | "description" | "priceCents" | "perOrderLimit"

export type ShopCustomerRow = {
  key: string
  email: string
  name: string | null
  orderCount: number
  totalSpentCents: number
  firstOrderAt: string | null
  refundedCount: number
  lastOrderAt: string
}

export type ShopCustomer = {
  key: string
  email: string
  name: string | null
  phone: string | null
  city: string | null
  orderCount: number
  totalSpentCents: number
  firstOrderAt: string | null
  refundedCount: number
  orders: Array<{ id: string; number: string; status: string; fulfilment: string; createdAt: string; totalCents: number; itemsSummary: string }>
  ownedNumbers: Array<{ productId: string; productName: string; number: number }>
}

export type ShopSettings = {
  storeName: string
  supportEmail: string
  pickupEnabled: boolean
  pickupAddress: string
  shippingFlatCents: number
  shippingFreeOverCents: number | null
  shipCountries: string[]
  returnsPolicy: string | null
  termsText: string | null
  shipsWithin: string | null
  shopPaused: boolean
  pauseNote: string | null
}

/** What the dashboard's Settings tab may change. */
export type ShopSettingsPatch = Partial<
  Pick<ShopSettings, "pickupEnabled" | "pickupAddress" | "shippingFlatCents" | "shippingFreeOverCents" | "shipsWithin" | "shopPaused" | "pauseNote" | "supportEmail">
>

export type ShopOrderFilter = "open" | "paid" | "ready_for_pickup" | "fulfilled" | "picked_up" | "refunded" | "cancelled" | "all"

// ─── Calls ──────────────────────────────────────────────────────────────────

export const shop = {
  summary: (accountId: string) => call<{ ok: true } & ShopSummary>(accountId, "GET", "/summary"),

  orders: (accountId: string, filter: ShopOrderFilter, cursor?: string) => {
    const q = new URLSearchParams({ filter })
    if (cursor) q.set("cursor", cursor)
    return call<{ ok: true; rows: ShopOrderRow[]; nextCursor: string | null }>(accountId, "GET", `/orders?${q}`)
  },
  order: (accountId: string, id: string) =>
    call<{ ok: true; order: ShopOrderDetail }>(accountId, "GET", `/orders/${encodeURIComponent(id)}`).then((r) => r.order),

  ship: (accountId: string, id: string, input: { carrier: string; trackingNumber: string }) =>
    call<{ ok: true }>(accountId, "POST", `/orders/${encodeURIComponent(id)}/ship`, input),
  ready: (accountId: string, id: string) =>
    call<{ ok: true }>(accountId, "POST", `/orders/${encodeURIComponent(id)}/ready`, {}),
  pickedUp: (accountId: string, id: string) =>
    call<{ ok: true }>(accountId, "POST", `/orders/${encodeURIComponent(id)}/picked-up`, {}),
  refund: (accountId: string, id: string, input: { reason?: string; release?: boolean }) =>
    call<{ ok: true }>(accountId, "POST", `/orders/${encodeURIComponent(id)}/refund`, input),

  products: (accountId: string, archived = false) =>
    call<{ ok: true; products: ShopProductRow[] }>(accountId, "GET", archived ? "/products?archived=1" : "/products").then((r) => r.products),
  product: (accountId: string, id: string) =>
    call<{ ok: true; product: ShopProduct }>(accountId, "GET", `/products/${encodeURIComponent(id)}`).then((r) => r.product),
  createProduct: (accountId: string, name: string) =>
    call<{ ok: true; id: string; slug: string }>(accountId, "POST", "/products", { name }),
  setProductStatus: (accountId: string, id: string, status: ShopProductStatus) =>
    call<{ ok: true }>(accountId, "POST", `/products/${encodeURIComponent(id)}/status`, { status }),
  setProductStock: (accountId: string, id: string, count: number) =>
    call<{ ok: true }>(accountId, "POST", `/products/${encodeURIComponent(id)}/inventory`, { count }),
  saveProductFields: (accountId: string, id: string, changes: Array<{ field: ShopProductField; value: string | number }>) =>
    call<{ ok: true; applied: number }>(accountId, "POST", `/products/${encodeURIComponent(id)}/fields`, {
      changes: changes.map((c) => ({ id, ...c })),
    }),

  customers: (accountId: string) =>
    call<{ ok: true; customers: ShopCustomerRow[] }>(accountId, "GET", "/customers").then((r) => r.customers),
  customer: (accountId: string, key: string) =>
    call<{ ok: true; customer: ShopCustomer }>(accountId, "GET", `/customers/${encodeURIComponent(key)}`).then((r) => r.customer),

  settings: (accountId: string) =>
    call<{ ok: true; settings: ShopSettings }>(accountId, "GET", "/settings").then((r) => r.settings),
  saveSettings: (accountId: string, patch: ShopSettingsPatch) =>
    call<{ ok: true; settings: ShopSettings }>(accountId, "POST", "/settings", patch).then((r) => r.settings),
}
