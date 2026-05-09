"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { logInventoryAdjustment, type AdjustmentReason } from "@/app/actions/inventory/adjustment-actions"

interface IngredientOption {
  ingredientId: string
  ingredientName: string
  category: string
  recipeUnit: string
}

interface Props {
  storeId: string
  ingredients: IngredientOption[]
}

const REASON_OPTIONS: { value: AdjustmentReason; label: string }[] = [
  { value: "THEFT", label: "Theft" },
  { value: "EXPIRY", label: "Expiry" },
  { value: "SUPPLIER_RETURN", label: "Supplier return" },
  { value: "DAMAGE", label: "Damage" },
  { value: "OTHER", label: "Other" },
]

export function AdjustmentDialog({ storeId, ingredients }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [ingredientId, setIngredientId] = useState<string>("")
  const [reason, setReason] = useState<AdjustmentReason>("EXPIRY")
  const [qty, setQty] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  const reset = () => {
    setIngredientId("")
    setReason("EXPIRY")
    setQty("")
    setNote("")
    setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const qtyNum = Number(qty)
    if (!ingredientId) {
      setError("Pick an ingredient")
      return
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Enter a positive quantity")
      return
    }
    startSaving(async () => {
      const result = await logInventoryAdjustment({
        storeId,
        canonicalIngredientId: ingredientId,
        qty: qtyNum,
        reason,
        note: note.trim() || null,
      })
      if (!result) {
        setError("Not authenticated")
        return
      }
      if (!result.ok) {
        setError(result.error.replace(/_/g, " "))
        return
      }
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  const selectedIngredient = ingredients.find((i) => i.ingredientId === ingredientId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[rgba(220,38,38,0.045)] hover:text-[var(--accent)]"
        >
          Log adjustment
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log inventory adjustment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] block mb-1">
              Ingredient
            </label>
            <Select value={ingredientId} onValueChange={setIngredientId}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Select ingredient" />
              </SelectTrigger>
              <SelectContent>
                {ingredients.map((i) => (
                  <SelectItem key={i.ingredientId} value={i.ingredientId}>
                    {i.ingredientName}{" "}
                    <span className="text-muted-foreground">· {i.category}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] block mb-1">
              Reason
            </label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as AdjustmentReason)}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="adjustment-qty"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] block mb-1"
            >
              Quantity to remove
              {selectedIngredient && selectedIngredient.recipeUnit ? (
                <span className="ml-2 normal-case tracking-normal">
                  in {selectedIngredient.recipeUnit}
                </span>
              ) : null}
            </label>
            <input
              id="adjustment-qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="h-9 w-full px-3 border border-[var(--hairline-bold)] rounded-[2px] bg-[rgba(255,253,247,0.72)] focus:outline-hidden focus-visible:border-(--accent) focus-visible:ring-1 focus-visible:ring-(--accent) tabular-nums"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            />
          </div>

          <div>
            <label
              htmlFor="adjustment-note"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] block mb-1"
            >
              Note (optional)
            </label>
            <textarea
              id="adjustment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-[var(--hairline-bold)] rounded-[2px] bg-[rgba(255,253,247,0.72)] focus:outline-hidden focus-visible:border-(--accent) focus-visible:ring-1 focus-visible:ring-(--accent)"
              placeholder="optional context"
            />
          </div>

          {error && (
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 hover:text-[var(--accent)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[rgba(220,38,38,0.045)] hover:text-[var(--accent)] disabled:opacity-40"
            >
              {isSaving ? "Saving…" : "Log adjustment"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
