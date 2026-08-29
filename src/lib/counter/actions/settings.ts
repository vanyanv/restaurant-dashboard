"use server"

import {
  changePassword,
  updateNotificationPrefs,
  updateProfile,
} from "@/app/actions/user-actions"

/**
 * The Counter layer's write path for settings — same shape as `./recipe.ts`
 * and `./stock-count.ts`. A page may not import `@/app/actions/*`; this
 * module is what does.
 *
 * Three things are writable: the notification booleans, the timezone, and the
 * password. `AlertPreference` holds no rows and nothing issues an invite, so
 * there is nothing else on the settings page that a button could save. See
 * the adapter.
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

/**
 * The timezone, which is the setting the page has a finding about: the owner's
 * is the schema default and three hours from his own restaurant. Surfacing
 * that without offering the fix would be half a page.
 *
 * `updateProfile` validates the whole profile, so the current name has to
 * travel with the change or its `min(1)` rejects it.
 */
export async function saveTimezone(input: {
  name: string
  timezone: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = new FormData()
  form.set("name", input.name)
  form.set("timezone", input.timezone)

  const result = await updateProfile(form)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  return { ok: true }
}

/** The prototype's "Change" button beside Password. */
export async function saveNewPassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = new FormData()
  form.set("currentPassword", input.currentPassword)
  form.set("newPassword", input.newPassword)
  form.set("confirmPassword", input.confirmPassword)

  const result = await changePassword(form)
  if ("error" in result && result.error) return { ok: false, error: result.error }
  return { ok: true }
}
