"use client"

import Link from "next/link"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2, Receipt, AlertCircle, BookOpen } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { IngredientCommand, type IngredientPickerValue } from "./ingredient-command"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import type { RecipeCostLine } from "@/lib/recipe-cost"

export type IngredientRowData = {
  id: string
  picker: IngredientPickerValue
  quantity: string
  unit: string
  notes: string
}

type Props = {
  row: IngredientRowData
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  excludeRecipeIds: string[]
  costLine?: RecipeCostLine
  onChange: (patch: Partial<IngredientRowData>) => void
  onRemove: () => void
  removable: boolean
  onCanonicalCreated?: () => void
  onOpenCreateDialog?: () => void
}

export function SortableIngredientRow({
  row,
  canonicalIngredients,
  recipes,
  excludeRecipeIds,
  costLine,
  onChange,
  onRemove,
  removable,
  onCanonicalCreated,
  onOpenCreateDialog,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const hasPick = row.picker !== null
  const isSubRecipe = row.picker?.kind === "recipe"

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative grid grid-cols-[24px_1fr_72px_64px_auto_24px] items-center gap-2 border-b border-[var(--hairline)] px-1 py-2.5 transition-opacity",
        isDragging && "z-10 bg-[var(--paper-deep)] opacity-80 shadow-sm"
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex h-6 w-6 cursor-grab items-center justify-center text-[var(--ink-faint)] opacity-0 transition-opacity hover:text-[var(--ink)] group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0">
        {isSubRecipe ? (
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="font-display italic text-[15px] leading-snug text-[var(--ink)]">
              {row.picker?.kind === "recipe" ? row.picker.label : ""}
            </span>
          </div>
        ) : (
          <IngredientCommand
            value={row.picker}
            canonicalIngredients={canonicalIngredients}
            recipes={recipes}
            excludeRecipeIds={excludeRecipeIds}
            onChange={(v) => {
              const patch: Partial<IngredientRowData> = { picker: v }
              if (v?.kind === "ingredient" && !row.unit) {
                patch.unit = v.defaultUnit
              }
              if (v?.kind === "recipe" && !row.unit) {
                patch.unit = "serving"
              }
              onChange(patch)
            }}
            onCanonicalCreated={onCanonicalCreated}
            onCreateIngredient={onOpenCreateDialog}
          />
        )}
      </div>

      <Input
        type="number"
        step="0.01"
        min={0}
        placeholder="qty"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        className="h-9 border-[var(--hairline-bold)] bg-transparent text-right font-mono text-sm tabular-nums"
      />

      <Input
        placeholder="unit"
        value={row.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
        className="h-9 border-[var(--hairline-bold)] bg-transparent font-mono text-xs uppercase tracking-[0.08em]"
      />

      <div className="flex min-w-[140px] justify-end">
        {hasPick && costLine ? (
          <ProvenanceChip line={costLine} />
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            —
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label="Remove row"
        onClick={onRemove}
        disabled={!removable}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 transition-opacity hover:text-[var(--accent)] disabled:cursor-not-allowed group-hover:opacity-100",
          !removable && "hover:text-[var(--ink-faint)]"
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ProvenanceChip({ line }: { line: RecipeCostLine }) {
  if (line.missingCost) {
    return (
      <Link
        href="/dashboard/ingredients?tab=review"
        className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent-dark)] hover:bg-[var(--accent)] hover:text-white"
      >
        <AlertCircle className="h-3 w-3" />
        Link to invoice
      </Link>
    )
  }

  if (line.kind === "component") {
    return (
      <span className="font-mono text-[11px] tabular-nums text-[var(--ink)]">
        ${line.lineCost.toFixed(2)}
      </span>
    )
  }

  const cost = `$${line.lineCost.toFixed(2)}`
  const chipSuffix = [
    line.sourceSku ? `SKU ${line.sourceSku}` : null,
    line.sourceVendor ?? null,
    line.sourceInvoiceDate ? relativeTime(line.sourceInvoiceDate) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-right"
        >
          <span className="font-mono text-[12px] tabular-nums text-[var(--ink)]">
            {cost}
          </span>
          <span className="hidden items-center gap-1 border border-dashed border-[var(--hairline-bold)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)] lg:inline-flex">
            <Receipt className="h-2.5 w-2.5" />
            {chipSuffix || "priced"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 border-[var(--hairline-bold)] bg-[var(--paper)] p-3 font-mono text-[11px]"
        align="end"
      >
        <div className="mb-2 flex items-center gap-1.5 text-[var(--ink-faint)]">
          <Receipt className="h-3 w-3" />
          <span className="uppercase tracking-[0.12em]">Invoice provenance</span>
        </div>
        <dl className="space-y-1.5">
          <Row k="Vendor" v={line.sourceVendor ?? "—"} />
          <Row k="SKU" v={line.sourceSku ?? "—"} />
          <Row
            k="Priced"
            v={line.sourceInvoiceDate ? formatDate(line.sourceInvoiceDate) : "—"}
          />
          <Row
            k="Unit cost"
            v={line.unitCost != null ? `$${line.unitCost.toFixed(4)}/${line.unit}` : "—"}
          />
          <Row k="Line" v={`${line.quantity} ${line.unit} · $${line.lineCost.toFixed(2)}`} />
        </dl>
        {line.sourceInvoiceId && (
          <Link
            href={`/dashboard/invoices/${line.sourceInvoiceId}`}
            className="mt-3 inline-block border-b border-[var(--ink)] text-[var(--ink)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            Open source invoice →
          </Link>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-[var(--hairline)] pb-1 last:border-0">
      <dt className="uppercase tracking-[0.1em] text-[var(--ink-faint)]">{k}</dt>
      <dd className="truncate tabular-nums text-[var(--ink)]">{v}</dd>
    </div>
  )
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function relativeTime(d: Date): string {
  const diff = Date.now() - new Date(d).getTime()
  const days = Math.round(diff / 86400000)
  if (days < 1) return "today"
  if (days === 1) return "1d"
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}
