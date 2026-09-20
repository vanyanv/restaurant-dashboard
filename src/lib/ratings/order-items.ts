/**
 * `OtterRating.orderItemNames` is a JSON array stored as a string, and Otter
 * writes the literal string "null" into it when a line is unknown. Rendered
 * straight through it reads as `["Cheese Fries","null"]`.
 *
 * This lived as a private function inside `ratings-actions.ts`, which is a
 * `"use server"` module and therefore cannot export a synchronous helper at
 * all. `getRatings` needs the same parse, so it moved here rather than being
 * written a second time — the two must not disagree about what a review
 * ordered.
 */
export function parseOrderItems(raw: string | null): string[] {
  if (!raw) return []
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    values = raw.split(",")
  }
  const list = Array.isArray(values) ? values : [values]
  const cleaned = list
    .map((v) => String(v ?? "").trim().replace(/^"|"$/g, ""))
    .filter((v) => v !== "" && v.toLowerCase() !== "null")
  return [...new Set(cleaned)]
}
