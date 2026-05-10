"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  saveCountLine,
  completeStockCount,
  abandonStockCount,
  logAdjustment,
} from "@/app/actions/mobile-stock-count-actions"

// Mirrored locally so we don't pull the Prisma client into the browser bundle.
// Keep in sync with prisma/schema.prisma → enum InventoryAdjustmentReason.
const ADJUSTMENT_REASON = {
  THEFT: "THEFT",
  EXPIRY: "EXPIRY",
  SUPPLIER_RETURN: "SUPPLIER_RETURN",
  DAMAGE: "DAMAGE",
  OTHER: "OTHER",
} as const
type InventoryAdjustmentReason =
  (typeof ADJUSTMENT_REASON)[keyof typeof ADJUSTMENT_REASON]

export type CountIngredient = {
  id: string
  name: string
  category: string | null
  recipeUnit: string | null
}

export type CountInitialLine = {
  ingredientId: string
  qty: number
}

type Props = {
  sessionId: string
  storeId: string
  storeName: string
  ingredients: CountIngredient[]
  initialLines: CountInitialLine[]
}

const KEYPAD = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [".", "0", "⌫"],
] as const

const ADJUSTMENT_REASONS: Array<{
  value: InventoryAdjustmentReason
  label: string
  description: string
}> = [
  {
    value: ADJUSTMENT_REASON.THEFT,
    label: "Theft",
    description: "missing without explanation",
  },
  {
    value: ADJUSTMENT_REASON.EXPIRY,
    label: "Expiry",
    description: "discarded after spoil",
  },
  {
    value: ADJUSTMENT_REASON.SUPPLIER_RETURN,
    label: "Supplier return",
    description: "sent back to vendor",
  },
  {
    value: ADJUSTMENT_REASON.DAMAGE,
    label: "Damage",
    description: "broken / unusable",
  },
]

const fmtQty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 })

export function CountFlow({
  sessionId,
  storeId,
  storeName,
  ingredients,
  initialLines,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [savedQty, setSavedQty] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const line of initialLines) out[line.ingredientId] = line.qty
    return out
  })
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [adjustment, setAdjustment] = useState<{
    ingredientId: string
    ingredientName: string
    qty: number
  } | null>(null)
  const [adjustmentNote, setAdjustmentNote] = useState("")

  const total = ingredients.length
  const counted = Object.keys(savedQty).length
  const current = ingredients[index] ?? null
  const allDone = counted + skipped.size >= total
  const currentRecorded =
    current && current.id in savedQty ? savedQty[current.id] : null

  const inputNumber = useMemo(() => {
    if (input === "" || input === ".") return null
    const parsed = Number(input)
    return Number.isFinite(parsed) ? parsed : null
  }, [input])

  function pressKey(k: (typeof KEYPAD)[number][number]) {
    setError(null)
    if (k === "⌫") {
      setInput((s) => s.slice(0, -1))
      return
    }
    if (k === ".") {
      if (input.includes(".")) return
      setInput((s) => (s === "" ? "0." : s + "."))
      return
    }
    if (input === "0") {
      setInput(k)
      return
    }
    if (input.length >= 8) return
    setInput((s) => s + k)
  }

  function clear() {
    setInput("")
    setError(null)
  }

  function advance() {
    setInput("")
    setError(null)
    setIndex((i) => Math.min(i + 1, total - 1))
  }

  function back() {
    setInput("")
    setError(null)
    setIndex((i) => Math.max(0, i - 1))
  }

  function skip() {
    if (!current) return
    setSkipped((s) => new Set(s).add(current.id))
    advance()
  }

  function save() {
    if (!current) return
    if (inputNumber == null || inputNumber < 0) {
      setError("Enter a non-negative number")
      return
    }
    const qty = inputNumber
    startTransition(async () => {
      try {
        await saveCountLine({
          sessionId,
          ingredientId: current.id,
          qty,
        })
        setSavedQty((m) => ({ ...m, [current.id]: qty }))
        setSkipped((s) => {
          if (!s.has(current.id)) return s
          const next = new Set(s)
          next.delete(current.id)
          return next
        })
        // Offer to log an adjustment when the count is suspiciously low (zero or
        // a meaningful drop vs prior). We don't know "expected" in cut 1, so
        // simply prompt on zero — that's the most common adjustment trigger.
        if (qty === 0) {
          setAdjustment({
            ingredientId: current.id,
            ingredientName: current.name,
            qty: 0,
          })
          setAdjustmentNote("")
        } else {
          advance()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save")
      }
    })
  }

  function submitAdjustment(reason: InventoryAdjustmentReason, qty: number) {
    if (!adjustment) return
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Adjustment qty must be positive")
      return
    }
    startTransition(async () => {
      try {
        await logAdjustment({
          storeId,
          ingredientId: adjustment.ingredientId,
          reason,
          qty,
          notes: adjustmentNote.trim() || null,
        })
        setAdjustment(null)
        setAdjustmentNote("")
        advance()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not log adjustment")
      }
    })
  }

  function dismissAdjustment() {
    setAdjustment(null)
    setAdjustmentNote("")
    advance()
  }

  function complete() {
    startTransition(async () => {
      try {
        await completeStockCount({ sessionId })
        router.replace("/m/count?done=1")
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not complete")
      }
    })
  }

  function abandon() {
    if (
      !confirm(
        "Abandon this count? Saved counts stay logged but the session closes.",
      )
    )
      return
    startTransition(async () => {
      try {
        await abandonStockCount({ sessionId })
        router.replace("/m/count")
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not abandon")
      }
    })
  }

  if (!current) {
    return (
      <div className="inv-panel inv-panel--empty">
        No ingredients to count for this account.
      </div>
    )
  }

  return (
    <div className="m-count-flow">
      <div className="m-count-progress" aria-label="Progress">
        <span className="m-count-progress__caption">
          {storeName} · {index + 1} of {total}
        </span>
        <span className="m-count-progress__caption">
          {counted} counted
          {skipped.size > 0 ? ` · ${skipped.size} skipped` : ""}
        </span>
        <div className="m-count-progress__bar" role="presentation">
          <div
            className="m-count-progress__bar-fill"
            style={{
              transform: `scaleX(${total === 0 ? 0 : (counted + skipped.size) / total})`,
            }}
          />
        </div>
      </div>

      <section className="inv-panel m-count-card dock-in dock-in-2">
        <div className="m-count-card__category">
          {current.category ?? "—"}
        </div>
        <h2 className="m-count-card__name">{current.name}</h2>
        <div className="m-count-card__unit">
          counted in <strong>{current.recipeUnit ?? "—"}</strong>
        </div>

        <div className="m-count-card__readout" aria-live="polite">
          <span className="m-count-card__readout-num">
            {input === "" ? "0" : input}
          </span>
          <span className="m-count-card__readout-unit">
            {current.recipeUnit ?? ""}
          </span>
        </div>

        {currentRecorded != null ? (
          <div className="m-count-card__previous">
            already saved · {fmtQty(currentRecorded)} {current.recipeUnit ?? ""}
          </div>
        ) : null}

        {error ? <div className="m-count-card__error">{error}</div> : null}
      </section>

      <div className="m-keypad" role="group" aria-label="Number pad">
        {KEYPAD.flat().map((k) => (
          <button
            key={k}
            type="button"
            className={`m-keypad__key${k === "⌫" ? " m-keypad__key--erase" : ""}`}
            onClick={() => pressKey(k)}
            disabled={pending}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="m-count-actions">
        <button
          type="button"
          className="toolbar-btn"
          onClick={back}
          disabled={pending || index === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={clear}
          disabled={pending || input === ""}
        >
          Clear
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={skip}
          disabled={pending}
        >
          Skip
        </button>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--accent"
          onClick={save}
          disabled={pending || input === "" || input === "."}
        >
          {pending ? "Saving…" : "Save · Next"}
        </button>
      </div>

      <div className="m-count-footer">
        <button
          type="button"
          className="toolbar-btn"
          onClick={abandon}
          disabled={pending}
        >
          Abandon
        </button>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--accent"
          onClick={complete}
          disabled={pending || !allDone}
          title={allDone ? undefined : "Count or skip every ingredient first"}
        >
          {pending ? "Working…" : "Complete count"}
        </button>
      </div>

      {adjustment ? (
        <AdjustmentSheet
          ingredientName={adjustment.ingredientName}
          note={adjustmentNote}
          onNoteChange={setAdjustmentNote}
          onSubmit={submitAdjustment}
          onDismiss={dismissAdjustment}
          pending={pending}
        />
      ) : null}
    </div>
  )
}

function AdjustmentSheet({
  ingredientName,
  note,
  onNoteChange,
  onSubmit,
  onDismiss,
  pending,
}: {
  ingredientName: string
  note: string
  onNoteChange: (s: string) => void
  onSubmit: (reason: InventoryAdjustmentReason, qty: number) => void
  onDismiss: () => void
  pending: boolean
}) {
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState<InventoryAdjustmentReason | null>(null)

  return (
    <div className="m-sheet" role="dialog" aria-label="Log adjustment">
      <div className="m-sheet__head">
        <span className="m-sheet__dept">LOG ADJUSTMENT</span>
        <button
          type="button"
          className="m-sheet__close"
          onClick={onDismiss}
          aria-label="Dismiss without logging"
        >
          ×
        </button>
      </div>
      <div className="m-sheet__body">
        <p className="m-sheet__lead">
          You counted zero <em>{ingredientName}</em>. Log what removed it from
          stock?
        </p>
        <div className="m-sheet__reasons">
          {ADJUSTMENT_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`toolbar-btn${reason === r.value ? " toolbar-btn--accent" : ""}`}
              onClick={() => setReason(r.value)}
              disabled={pending}
            >
              {r.label}
              <span className="m-sheet__reason-desc">{r.description}</span>
            </button>
          ))}
        </div>

        <label className="m-sheet__label">
          QTY (positive)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={pending}
            className="m-sheet__input"
          />
        </label>

        <label className="m-sheet__label">
          NOTES (OPTIONAL)
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            disabled={pending}
            className="m-sheet__input"
            rows={2}
          />
        </label>
      </div>
      <div className="m-sheet__actions">
        <button
          type="button"
          className="toolbar-btn"
          onClick={onDismiss}
          disabled={pending}
        >
          No adjustment
        </button>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--accent"
          onClick={() => {
            if (!reason) return
            const parsed = Number(qty)
            if (!Number.isFinite(parsed) || parsed <= 0) return
            onSubmit(reason, parsed)
          }}
          disabled={pending || !reason || qty === ""}
        >
          {pending ? "Logging…" : "Log adjustment"}
        </button>
      </div>
    </div>
  )
}
