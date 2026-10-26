"use server"

import { getServerSession } from "next-auth"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { shop, ShopNotConnected, ShopRefused } from "@/lib/shop/client"

/**
 * The owner's write path for the merch shop. Every action checks the session,
 * owner access and that the caller's account is the one the shop belongs to,
 * then hands the change to the site's private API, which applies the same
 * rules (and sends the same customer emails) as the site's own admin did.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

async function ownerAccount(): Promise<string> {
  const session = await getServerSession(authOptions)
  if (!session?.user) throw new Error("Unauthorized")
  if (!hasOwnerAccess(session.user.role)) throw new Error("Forbidden")
  return session.user.accountId
}

function revalidateShop() {
  revalidatePath("/dashboard/shop", "layout")
}

function fail(err: unknown): ActionResult {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form" }
  if (err instanceof ShopRefused || err instanceof ShopNotConnected) return { ok: false, error: err.message }
  if (err instanceof Error && ["Unauthorized", "Forbidden"].includes(err.message)) return { ok: false, error: err.message }
  console.error("[shop.action]", err)
  return { ok: false, error: err instanceof Error && err.message.startsWith("chrisneddys.com") ? err.message : "Couldn't save. Try again." }
}

async function run(work: (accountId: string) => Promise<unknown>, message?: string): Promise<ActionResult> {
  try {
    const accountId = await ownerAccount()
    await work(accountId)
    revalidateShop()
    return { ok: true, message }
  } catch (err) {
    return fail(err)
  }
}

const id = z.string().trim().min(1).max(100)

const ShipInput = z.object({
  orderId: id,
  carrier: z.string().trim().min(1, "Pick a carrier").max(40),
  trackingNumber: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().min(6, "That tracking number looks too short").max(60, "That tracking number looks too long")),
})

export async function shipOrder(raw: z.input<typeof ShipInput>): Promise<ActionResult> {
  const parsed = ShipInput.safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const { orderId, carrier, trackingNumber } = parsed.data
  return run((a) => shop.ship(a, orderId, { carrier, trackingNumber }), "Shipped. The customer has the tracking email.")
}

export async function markOrderReady(raw: { orderId: string }): Promise<ActionResult> {
  const parsed = z.object({ orderId: id }).safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  return run((a) => shop.ready(a, parsed.data.orderId), "Ready. The customer has been told to come by.")
}

export async function markOrderPickedUp(raw: { orderId: string }): Promise<ActionResult> {
  const parsed = z.object({ orderId: id }).safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  return run((a) => shop.pickedUp(a, parsed.data.orderId), "Picked up.")
}

const RefundInput = z.object({
  orderId: id,
  reason: z.string().trim().max(300).optional(),
  release: z.boolean().optional(),
})

/** Marks an order refunded. The money moves in Stripe first; this keeps the desk in step. */
export async function markOrderRefunded(raw: z.input<typeof RefundInput>): Promise<ActionResult> {
  const parsed = RefundInput.safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const { orderId, reason, release } = parsed.data
  return run((a) => shop.refund(a, orderId, { reason: reason || undefined, release }), "Marked refunded.")
}

export async function createShopProduct(raw: { name: string }): Promise<ActionResult & { id?: string }> {
  const parsed = z.object({ name: z.string().trim().min(1, "Give it a name").max(120) }).safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  try {
    const accountId = await ownerAccount()
    const r = await shop.createProduct(accountId, parsed.data.name)
    revalidateShop()
    return { ok: true, message: "Draft created.", id: r.id }
  } catch (err) {
    return fail(err)
  }
}

export async function setShopProductStatus(raw: { productId: string; status: string }): Promise<ActionResult> {
  const parsed = z.object({ productId: id, status: z.enum(["draft", "published", "archived"]) }).safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const { productId, status } = parsed.data
  const said = { draft: "Moved back to draft.", published: "Live on chrisneddys.com.", archived: "Archived." }[status]
  return run((a) => shop.setProductStatus(a, productId, status), said)
}

export async function setShopProductStock(raw: { productId: string; count: number }): Promise<ActionResult> {
  const parsed = z
    .object({ productId: id, count: z.number().int("Stock is a whole number").min(0, "Stock can't be negative").max(100_000) })
    .safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const { productId, count } = parsed.data
  return run((a) => shop.setProductStock(a, productId, count), "Stock saved.")
}

const ProductFieldsInput = z.object({
  productId: id,
  displayName1: z.string().trim().max(80).optional(),
  displayName2: z.string().trim().max(80).optional(),
  eyebrow: z.string().trim().max(80).optional(),
  description: z.string().trim().max(4000).optional(),
  priceCents: z.number().int().min(0, "Price can't be negative").max(1_000_000).optional(),
  perOrderLimit: z.number().int().min(1, "Allow at least one per order").max(100).optional(),
})

/** Saves only the fields that changed; the site checks each with the admin's own rules, all or nothing. */
export async function saveShopProduct(raw: z.input<typeof ProductFieldsInput>): Promise<ActionResult> {
  const parsed = ProductFieldsInput.safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const { productId, ...fields } = parsed.data
  const changes = (Object.entries(fields) as Array<[keyof typeof fields, string | number | undefined]>)
    .filter((e): e is [keyof typeof fields, string | number] => e[1] !== undefined)
    .map(([field, value]) => ({ field, value }))
  if (changes.length === 0) return { ok: true, message: "Nothing changed." }
  return run((a) => shop.saveProductFields(a, productId, changes), "Saved.")
}

const SettingsInput = z.object({
  supportEmail: z.string().trim().email("Enter a valid email address").optional(),
  pickupEnabled: z.boolean().optional(),
  pickupAddress: z.string().trim().max(200).optional(),
  shippingFlatCents: z.number().int().min(0).max(100_000).optional(),
  shippingFreeOverCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  shipsWithin: z.string().trim().max(60).nullable().optional(),
  shopPaused: z.boolean().optional(),
  pauseNote: z.string().trim().max(200).nullable().optional(),
})

export async function saveShopSettings(raw: z.input<typeof SettingsInput>): Promise<ActionResult> {
  const parsed = SettingsInput.safeParse(raw)
  if (!parsed.success) return fail(parsed.error)
  const patch = { ...parsed.data }
  if (patch.pickupEnabled && patch.pickupAddress === "") return { ok: false, error: "Pickup needs an address" }
  if (patch.shipsWithin === "") patch.shipsWithin = null
  if (patch.pauseNote === "") patch.pauseNote = null
  return run((a) => shop.saveSettings(a, patch), "Settings saved.")
}
