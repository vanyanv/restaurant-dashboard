"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { finishStockCount, recordCountLine } from "@/lib/counter/actions/stock-count"
import type {
  CountSessionEntry,
  CountSessionEntryRow,
} from "@/lib/counter/adapters/stock-counts"

/** What a box is doing since it was last touched. */
export type SaveState = "saving" | "ok" | "failed"

/**
 * Typing a count, once — for the desk's table and the phone's list alike.
 *
 * ## Why it is a hook and not two components
 *
 * The desk grew this behaviour first (`CountEntry`, whose docblock has the
 * reasoning for saving on blur and for closing being a button rather than an
 * afterthought). The phone's session page — the surface its own docblock calls
 * "the one you hold while counting" — was handed the same `entry` section and
 * rendered nothing from it, so an owner could start a count on a phone, walk
 * the walk-in and have nowhere to type a number.
 *
 * The obvious fix is to write the same forty lines again in phone markup, and
 * that is how two surfaces come to disagree about when a line is saved, what
 * counts as unchanged, or whether a zero is a number. So the state machine is
 * here and both surfaces render it. What differs between them is a `<table>`
 * and a `<div class="mlist">`, which is all that should.
 *
 * ## The rules it holds
 *
 * `recordCountLine` upserts on (count, ingredient), which is what makes
 * saving per box safe: re-entering a number corrects it rather than doubling
 * it, and nobody walking seventy-six ingredients loses twenty lines because
 * the page reloaded before they reached a Save button.
 *
 * An empty box is not a zero. Blurring past an ingredient you have not counted
 * yet has to write nothing, or every untouched line becomes a recorded zero
 * the moment someone scrolls — which on a count sheet means "we have none of
 * this", the most expensive wrong answer available here. A typed `0` is a real
 * count and does save.
 */
export function useCountEntry(entry: CountSessionEntry) {
  const router = useRouter()
  const [finishing, startFinishing] = useTransition()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entry.rows.map((r) => [r.ingredientId, r.entered === null ? "" : String(r.entered)]),
    ),
  )
  const [saved, setSaved] = useState<Record<string, SaveState>>({})
  const valuesRef = useRef(values)
  const persisted = useRef(new Map(entry.rows.map((r) => [r.ingredientId, r.entered])))
  const writes = useRef(new Map<string, Promise<boolean>>())
  const [finishError, setFinishError] = useState<string | null>(null)

  const setValue = (ingredientId: string, next: string) => {
    valuesRef.current = { ...valuesRef.current, [ingredientId]: next }
    setValues(valuesRef.current)
    setFinishError(null)
  }

  const commit = (row: CountSessionEntryRow): Promise<boolean> => {
    if (!entry.open) return Promise.resolve(true)
    const id = row.ingredientId
    const raw = (valuesRef.current[id] ?? "").trim()
    // Nothing typed: see the docblock — an untouched box must not become a
    // recorded zero.
    if (raw === "" && persisted.current.get(id) == null && !writes.current.has(id)) {
      return Promise.resolve(true)
    }
    const qty = Number(raw)
    if (raw === "" || !Number.isFinite(qty) || qty < 0) {
      setSaved((s) => ({ ...s, [id]: "failed" }))
      return Promise.resolve(false)
    }
    setSaved((s) => ({ ...s, [id]: "saving" }))
    // Serialize edits to this ingredient. Compare against the last successful
    // write only after earlier edits settle, so 5 -> 7 -> 5 saves both changes.
    const write = (writes.current.get(id) ?? Promise.resolve(true)).then(async () => {
      if (persisted.current.get(id) === qty) return true
      try {
        const result = await recordCountLine({
          stockCountId: entry.countId, ingredientId: id, qty,
          unit: row.unit, estimate: row.estimate,
        })
        if (result.ok) persisted.current.set(id, qty)
        return result.ok
      } catch {
        return false
      }
    })
    writes.current.set(id, write)
    void write.then((ok) => {
      if (writes.current.get(id) !== write) return
      writes.current.delete(id)
      setSaved((s) => ({ ...s, [id]: ok ? "ok" : "failed" }))
    })
    return write
  }

  const finish = () => {
    setFinishError(null)
    startFinishing(async () => {
      const results = await Promise.all(entry.rows.map(commit))
      if (results.some((ok) => !ok)) {
        setFinishError("Some quantities were not saved. Check them before closing the count.")
        return
      }
      try {
        const result = await finishStockCount(entry.countId)
        if (!result.ok) {
          setFinishError("The count could not be closed. Please try again.")
          return
        }
        router.refresh()
      } catch {
        setFinishError("The count could not be closed. Please try again.")
      }
    })
  }

  /** What the closing button says, which is three different things. */
  const finishLabel = !entry.open
    ? "This count is closed"
    : finishing
      ? "Closing…"
      : "Finish this count"

  return { values, saved, setValue, commit, finish, finishing, finishLabel, finishError }
}
