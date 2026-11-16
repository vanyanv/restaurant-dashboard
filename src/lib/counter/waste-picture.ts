import { reasonLabel } from "@/lib/counter/waste-reasons"

/**
 * "Thrown out", added up. The one sum behind the Waste tab's headline, its
 * bars by reason, the by-store comparison and the Inventory overview's
 * "Thrown out" tile.
 *
 * An entry on an item with no price on file has `dollars: null`. It is
 * counted as an entry and listed, and never added in as $0: the total says
 * how many entries it is the value of. With no priced entry at all the total
 * is `null`, an unknown, not zero.
 *
 * Client-safe: no Prisma, only arithmetic.
 */

export type WasteLine = {
  /** The stored reason id ("DROPPED", "EXPIRY"…). */
  reason: string
  /** Null when the item has no price on file. */
  dollars: number | null
}

export type WasteReasonBar = {
  id: string
  label: string
  entries: number
  /** Entries with no price: listed, not in `dollars`. */
  unpriced: number
  /** Σ of this reason's priced entries. Null when none has a price. */
  dollars: number | null
}

export type WasteSummary = {
  entries: number
  /** Entries with a price: what `dollars` is the value of. */
  valued: number
  unpriced: number
  /** Σ of the priced entries. Null when there is none: an unknown, never $0. */
  dollars: number | null
  /** One bar per reason that was logged, biggest first; a reason with no priced entry last. */
  reasons: WasteReasonBar[]
}

export function summarizeWaste(lines: ReadonlyArray<WasteLine>): WasteSummary {
  const by = new Map<string, { entries: number; unpriced: number; dollars: number }>()
  let valued = 0
  let dollars = 0
  for (const l of lines) {
    const r = by.get(l.reason) ?? { entries: 0, unpriced: 0, dollars: 0 }
    by.set(l.reason, r)
    r.entries++
    if (l.dollars === null) r.unpriced++
    else {
      r.dollars += l.dollars
      valued++
      dollars += l.dollars
    }
  }
  const reasons = [...by].map(([id, r]): WasteReasonBar => ({
    id,
    label: reasonLabel(id),
    entries: r.entries,
    unpriced: r.unpriced,
    dollars: r.unpriced < r.entries ? r.dollars : null,
  }))
  // Biggest first; a reason nobody can value yet goes last, then by name so the order is stable.
  reasons.sort((a, b) => (b.dollars ?? -1) - (a.dollars ?? -1) || a.label.localeCompare(b.label))
  return {
    entries: lines.length,
    valued,
    unpriced: lines.length - valued,
    dollars: valued > 0 ? dollars : null,
    reasons,
  }
}

/** Several summaries (one per store) as one: entries and priced dollars added, reasons merged. */
export function mergeWaste(parts: ReadonlyArray<WasteSummary>): WasteSummary {
  const by = new Map<string, WasteReasonBar>()
  for (const p of parts) {
    for (const r of p.reasons) {
      const had = by.get(r.id)
      if (!had) by.set(r.id, { ...r })
      else {
        had.entries += r.entries
        had.unpriced += r.unpriced
        had.dollars = had.dollars === null && r.dollars === null ? null : (had.dollars ?? 0) + (r.dollars ?? 0)
      }
    }
  }
  const reasons = [...by.values()].sort((a, b) => (b.dollars ?? -1) - (a.dollars ?? -1) || a.label.localeCompare(b.label))
  const valued = parts.reduce((t, p) => t + p.valued, 0)
  const entries = parts.reduce((t, p) => t + p.entries, 0)
  return {
    entries,
    valued,
    unpriced: entries - valued,
    dollars: valued > 0 ? parts.reduce((t, p) => t + (p.dollars ?? 0), 0) : null,
    reasons,
  }
}

/** The part of a summary a comparison needs. */
export type MoneyFigure = Pick<WasteSummary, "entries" | "dollars">

export type MoneyChange =
  | { kind: "more" | "less"; dollars: number }
  | { kind: "same" }
  /** Nothing in the earlier window to compare with. */
  | { kind: "nothing_before" }
  /** One side has entries and none of them has a price. */
  | { kind: "cant_tell" }

/**
 * This window against the one before it, in dollars. Only two real figures
 * are compared: a window whose entries have no price is "can't tell", and an
 * empty earlier window is "nothing before", never a rise from $0.
 */
export function moneyChange(now: MoneyFigure, before: MoneyFigure): MoneyChange | null {
  if (now.entries === 0 && before.entries === 0) return null
  if (before.entries === 0) return { kind: "nothing_before" }
  if (before.dollars === null || (now.entries > 0 && now.dollars === null)) return { kind: "cant_tell" }
  const d = (now.dollars ?? 0) - before.dollars
  if (Math.abs(d) < 0.005) return { kind: "same" }
  return { kind: d > 0 ? "more" : "less", dollars: Math.abs(d) }
}

/** Bar lengths on one scale: each value as a share of the biggest. 0 for an unknown. */
export function barShares(values: ReadonlyArray<number | null>): number[] {
  const max = Math.max(0, ...values.map((v) => v ?? 0))
  return values.map((v) => (v === null || max <= 0 ? 0 : Math.max(0, v) / max))
}
