"use server"

import { updateNotificationPrefs } from "@/app/actions/user-actions"

/**
 * The Counter layer's write path for settings — same shape as `./recipe.ts`
 * and `./stock-count.ts`. A page may not import `@/app/actions/*`; this
 * module is what does.
 *
 * Only the three notification booleans are writable. `AlertPreference` holds
 * no rows and nothing issues an invite, so there is nothing else on the
 * settings page that a button could save. See the adapter.
 */
export async function saveNotificationPreferences(input: {
  invoices: boolean
  weekly: boolean
  anomaly: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // The underlying action reads a FormData built by an uncontrolled form, so
  // an unchecked box is an ABSENT key rather than "off".
  const form = new FormData()
  if (input.invoices) form.set("notifyInvoices", "on")
  if (input.weekly) form.set("notifyWeeklyReport", "on")
  if (input.anomaly) form.set("notifyAnomaly", "on")

  const result = await updateNotificationPrefs(form)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  return { ok: true }
}
