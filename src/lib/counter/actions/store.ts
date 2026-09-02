"use server"

import { createStore, deleteStore, updateStore } from "@/app/actions/store-actions"
import {
  createStoreFixedExpense,
  deleteStoreFixedExpense,
  updateStoreFixedExpense,
} from "@/app/actions/store/fixed-expense-actions"

/**
 * The Counter layer's write path for the store file — same shape as
 * `./recipe.ts`, `./stock-count.ts` and `./settings.ts`.
 *
 * `updateStore` validates the whole store, so the name has to travel with any
 * change or its `min(1)` rejects it. Its `parseRate` reads a commission
 * greater than 1 as a percentage and divides by 100, so the form can send
 * either 21 or 0.21 and mean the same thing.
 *
 * `targetCogsPct` is deliberately absent: `updateStoreSchema` does not accept
 * it, so no form can set it and the store file says so rather than offering a
 * field that silently does nothing.
 */
export interface StoreFileEdit {
  name: string
  address: string | null
  phone: string | null
  fixedMonthlyRent: number | null
  fixedMonthlyLabor: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
}

/** A blank clears the value; `updateStore` reads "" as null and absent as unchanged. */
function put(form: FormData, key: string, value: number | string | null) {
  form.set(key, value === null ? "" : String(value))
}

export async function saveStoreFile(
  storeId: string,
  edit: StoreFileEdit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = new FormData()
  form.set("name", edit.name)
  form.set("isActive", "true")
  if (edit.address !== null) form.set("address", edit.address)
  if (edit.phone !== null) form.set("phone", edit.phone)
  put(form, "fixedMonthlyRent", edit.fixedMonthlyRent)
  put(form, "fixedMonthlyLabor", edit.fixedMonthlyLabor)
  put(form, "fixedMonthlyTowels", edit.fixedMonthlyTowels)
  put(form, "fixedMonthlyCleaning", edit.fixedMonthlyCleaning)
  put(form, "uberCommissionRate", edit.uberCommissionRate)
  put(form, "doordashCommissionRate", edit.doordashCommissionRate)

  const result = await updateStore(storeId, form)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  return { ok: true }
}

/**
 * Create a store. `createStoreSchema` reads name, address and phone — there
 * is no lifecycle in it, so `Store.lifecycleStage` takes its schema default,
 * `pre_open`, and the nightly model skips the store until someone moves it
 * on. The page says that rather than offering a select nothing reads.
 */
export async function createStoreRecord(input: {
  name: string
  address: string
  phone: string
}): Promise<{ ok: true; storeId: string } | { ok: false; error: string }> {
  const form = new FormData()
  form.set("name", input.name)
  if (input.address.trim() !== "") form.set("address", input.address.trim())
  if (input.phone.trim() !== "") form.set("phone", input.phone.trim())

  const result = await createStore(form)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  if (!("store" in result) || !result.store) return { ok: false, error: "no_store_returned" }
  return { ok: true, storeId: result.store.id }
}


/**
 * THE FIXED-EXPENSE LINES, AND WHY THE MANIFEST WAS WRONG ABOUT THEM.
 *
 * `e2e/fidelity/manifest.ts` declared `P.storecosts`' "Add a line" button
 * absent on the ground that "nothing writes `StoreFixedExpense`,
 * `prisma.storeFixedExpense.create` appears nowhere outside the generated
 * client". That was checked and it is not true:
 * `src/app/actions/store/fixed-expense-actions.ts` has owner-gated create,
 * update and delete, all three writing `prisma.storeFixedExpense`, and the
 * editorial store dossier called all three. The allowance is corrected in the
 * same commit as this module.
 *
 * These lines matter more than their size suggests. Each one becomes its own
 * P&L row, so a rent figure nobody can enter is a P&L that is wrong by the
 * rent every month, silently, with no gap on screen to notice.
 *
 * `amount` is stored AS ENTERED in its cadence and converted to a month for
 * display — the adapter's `StoreExpenseLine.monthly` — so a weekly line is
 * kept weekly and the owner's own number is the one that survives.
 */
export async function addFixedExpense(input: {
  storeId: string
  label: string
  amount: number
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY"
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await createStoreFixedExpense(input)
  if ("error" in result) return { ok: false, error: result.error }
  return { ok: true }
}

export async function editFixedExpense(input: {
  id: string
  label: string
  amount: number
  frequency: "WEEKLY" | "MONTHLY" | "YEARLY"
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await updateStoreFixedExpense(input)
  if ("error" in result) return { ok: false, error: result.error }
  return { ok: true }
}

export async function removeFixedExpense(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await deleteStoreFixedExpense({ id })
  if ("error" in result) return { ok: false, error: result.error }
  return { ok: true }
}

/**
 * Take a store out of the product.
 *
 * `deleteStore` is a SOFT delete — it sets `isActive: false` and touches
 * nothing else — so "delete" and "deactivate" are one operation in this
 * codebase, and the button says the one that is true. `P.storecosts` draws
 * both ("Deactivate this store" and "Delete") and then explains underneath
 * that "deleting a store does not delete its history", which is a description
 * of exactly this behaviour under two names. Shipping two controls for one
 * effect would be the kind of thing the fidelity gate's own note warns
 * against: satisfying the fixture by breaking the rule it exists to protect.
 *
 * The orders, invoices and counts stay. Every loader in the product filters
 * `isActive`, so the store leaves the switcher and the rollups and its history
 * remains queryable — which is what the prototype's callout promises.
 */
export async function deactivateStore(
  storeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await deleteStore(storeId)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  return { ok: true }
}
