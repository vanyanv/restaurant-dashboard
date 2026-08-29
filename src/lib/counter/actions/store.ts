"use server"

import { createStore, updateStore } from "@/app/actions/store-actions"

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
