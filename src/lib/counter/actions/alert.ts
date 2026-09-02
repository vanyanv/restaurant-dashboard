"use server"

import { acknowledgeAlert, dismissAlert } from "@/app/actions/alerts/inbox-actions"

/**
 * The Counter layer's write path for the alert inbox — same shape as
 * `./invoice.ts`, `./store.ts`, `./recipe.ts`, `./stock-count.ts` and
 * `./settings.ts`.
 *
 * ## Two verbs, and they mean different things
 *
 * `acknowledgeAlert` without an explanation writes ACKNOWLEDGED: seen, real,
 * no action needed. With one it writes EXPLAINED and keeps the text, which is
 * the only way this product ever learns why a spike happened. `dismissAlert`
 * writes DISMISSED: not worth tracking, do not ask me again.
 *
 * The distinction is worth preserving in the UI rather than collapsing to a
 * single "close" button, because the Alerts page's own median-time-to-close
 * figure is computed over dismissals, and because an owner who dismisses every
 * anomaly of one kind is telling the ranker something an accuracy metric
 * cannot see.
 *
 * All three statuses stamp `acknowledgedAt`. Note for anyone reading the
 * numbers later: every `acknowledgedAt` in this database currently sits on a
 * DISMISSED row, because dismissal was the only verb any surface ever
 * offered. Acknowledgements written from here will be the first of their kind.
 */
export async function closeAlert(
  alertId: string,
  how: "acknowledge" | "dismiss",
  explanation?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result =
    how === "dismiss"
      ? await dismissAlert({ alertId })
      : await acknowledgeAlert({ alertId, explanation })
  if (!result.ok) return { ok: false, error: result.error }
  return { ok: true }
}
