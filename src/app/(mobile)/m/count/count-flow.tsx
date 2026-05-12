"use client"

import { useCallback, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  saveCountLine,
  completeStockCount,
  abandonStockCount,
  logAdjustment,
} from "@/app/actions/mobile-stock-count-actions"
import { setCanonicalPackDefinition } from "@/app/actions/canonical-ingredient-actions"

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
  hasPhoto: boolean
  photoVersion: string | null
  caseUnit: string | null
  innerPackUnit: string | null
  recipeUnitsPerCase: number | null
  innerPacksPerCase: number | null
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
  canEditDefinition: boolean
}

const ADJUSTMENT_REASONS: Array<{
  value: InventoryAdjustmentReason
  label: string
  description: string
}> = [
  { value: ADJUSTMENT_REASON.THEFT, label: "Theft", description: "missing without explanation" },
  { value: ADJUSTMENT_REASON.EXPIRY, label: "Expiry", description: "discarded after spoil" },
  { value: ADJUSTMENT_REASON.SUPPLIER_RETURN, label: "Supplier return", description: "sent back to vendor" },
  { value: ADJUSTMENT_REASON.DAMAGE, label: "Damage", description: "broken / unusable" },
]

const fmtQty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 })

function parseField(s: string): number {
  if (s === "" || s === ".") return 0
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function computeCanonical(
  ingredient: CountIngredient,
  draft: TierDraft,
): { canonical: number; nativeQty: number; nativeUnit: string } {
  const cases = parseField(draft.cases)
  const inner = parseField(draft.inner)
  const loose = parseField(draft.loose)

  const perCase = ingredient.recipeUnitsPerCase ?? 0
  const innerPerCase = ingredient.innerPacksPerCase ?? 0
  const perInner = perCase > 0 && innerPerCase > 0 ? perCase / innerPerCase : 0

  const canonical = cases * perCase + inner * perInner + loose

  // nativeQty = case-equivalent. When no case tier is defined, fall back to loose value.
  let nativeQty = 0
  let nativeUnit = ingredient.recipeUnit ?? ""
  if (perCase > 0) {
    nativeQty =
      cases + (innerPerCase > 0 ? inner / innerPerCase : 0) + loose / perCase
    nativeUnit = ingredient.caseUnit ?? "CS"
  } else {
    nativeQty = loose
  }

  return { canonical, nativeQty, nativeUnit }
}

type TierDraft = { cases: string; inner: string; loose: string }

export function CountFlow({
  sessionId,
  storeId,
  storeName,
  ingredients: initialIngredients,
  initialLines,
  canEditDefinition,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Local mirror of ingredients so optimistic photo + pack-def edits don't need a page refresh.
  const [ingredients, setIngredients] =
    useState<CountIngredient[]>(initialIngredients)

  const [savedQty, setSavedQty] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const line of initialLines) out[line.ingredientId] = line.qty
    return out
  })
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [index, setIndex] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({})
  const [error, setError] = useState<string | null>(null)
  const [adjustment, setAdjustment] = useState<{
    ingredientId: string
    ingredientName: string
    qty: number
  } | null>(null)
  const [adjustmentNote, setAdjustmentNote] = useState("")
  const [packEditorOpen, setPackEditorOpen] = useState(false)

  const total = ingredients.length
  const counted = Object.keys(savedQty).length
  const current = ingredients[index] ?? null
  const allDone = counted + skipped.size >= total

  const currentDraft: TierDraft = current
    ? drafts[current.id] ?? { cases: "", inner: "", loose: "" }
    : { cases: "", inner: "", loose: "" }

  const liveTotal = current ? computeCanonical(current, currentDraft) : null

  function setDraft(id: string, patch: Partial<TierDraft>) {
    setError(null)
    setDrafts((m) => ({
      ...m,
      [id]: { ...(m[id] ?? { cases: "", inner: "", loose: "" }), ...patch },
    }))
  }

  function clear() {
    if (!current) return
    setDrafts((m) => ({ ...m, [current.id]: { cases: "", inner: "", loose: "" } }))
    setError(null)
  }

  function advance() {
    setError(null)
    setIndex((i) => Math.min(i + 1, total - 1))
  }
  function back() {
    setError(null)
    setIndex((i) => Math.max(0, i - 1))
  }

  function skip() {
    if (!current) return
    setSkipped((s) => new Set(s).add(current.id))
    advance()
  }

  function save() {
    if (!current || !liveTotal) return
    if (
      currentDraft.cases === "" &&
      currentDraft.inner === "" &&
      currentDraft.loose === ""
    ) {
      setError("Enter at least one tier")
      return
    }
    const qty = liveTotal.canonical
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Total must be non-negative")
      return
    }
    startTransition(async () => {
      try {
        await saveCountLine({
          sessionId,
          ingredientId: current.id,
          qty,
          nativeQty: liveTotal.nativeQty,
          nativeUnit: liveTotal.nativeUnit,
        })
        setSavedQty((m) => ({ ...m, [current.id]: qty }))
        setSkipped((s) => {
          if (!s.has(current.id)) return s
          const next = new Set(s)
          next.delete(current.id)
          return next
        })
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
      !confirm("Abandon this count? Saved counts stay logged but the session closes.")
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

  const onPhotoUpdated = useCallback(
    (id: string, version: string | null, hasPhoto: boolean) => {
      setIngredients((rows) =>
        rows.map((r) => (r.id === id ? { ...r, hasPhoto, photoVersion: version } : r)),
      )
    },
    [],
  )

  const onPackUpdated = useCallback(
    (id: string, patch: Partial<CountIngredient>) => {
      setIngredients((rows) =>
        rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      )
      setPackEditorOpen(false)
    },
    [],
  )

  if (!current) {
    return (
      <div className="inv-panel inv-panel--empty">
        No ingredients to count for this account.
      </div>
    )
  }

  const tierDef = describeTiers(current)

  return (
    <div className="m-count-flow">
      {/* Progress folio */}
      <div className="m-count-progress" aria-label="Progress">
        <span className="m-count-progress__caption">
          {storeName} · No. {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </span>
        <span className="m-count-progress__caption">
          {counted} counted{skipped.size > 0 ? ` · ${skipped.size} skipped` : ""}
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

      {/* The dossier card */}
      <article className="inv-panel m-count-dossier dock-in dock-in-2">
        <PhotoBlock
          ingredient={current}
          canUpload={canEditDefinition}
          onPhotoUpdated={onPhotoUpdated}
          onError={setError}
        />

        <header className="m-count-dossier__head">
          <span className="m-count-dossier__category">
            {current.category ?? "Uncategorized"}
          </span>
          <h2 className="m-count-dossier__name">{current.name}</h2>
          <span className="m-count-dossier__rule" aria-hidden />
          <span className="m-count-dossier__unit">
            counted in {current.recipeUnit ?? "—"}
          </span>
        </header>

        {tierDef.hasCase ? (
          <div className="m-count-tiers" role="group" aria-label="Count tiers">
            <TierRow
              roman="I"
              label={`Cases · ${tierDef.caseUnit}`}
              hint={tierDef.perCaseLabel}
              value={currentDraft.cases}
              autoFocus
              onChange={(s) => setDraft(current.id, { cases: s })}
              pending={pending}
            />
            {tierDef.hasInner ? (
              <TierRow
                roman="II"
                label={`Inner · ${tierDef.innerPackUnit}`}
                hint={tierDef.perInnerLabel}
                value={currentDraft.inner}
                onChange={(s) => setDraft(current.id, { inner: s })}
                pending={pending}
              />
            ) : null}
            <TierRow
              roman={tierDef.hasInner ? "III" : "II"}
              label={`Loose · ${current.recipeUnit ?? "unit"}`}
              hint="open / partial"
              value={currentDraft.loose}
              onChange={(s) => setDraft(current.id, { loose: s })}
              pending={pending}
            />
          </div>
        ) : (
          <div className="m-count-tiers" role="group" aria-label="Count">
            <TierRow
              roman="—"
              label={`Quantity · ${current.recipeUnit ?? "unit"}`}
              hint="canonical units"
              value={currentDraft.loose}
              autoFocus
              onChange={(s) => setDraft(current.id, { loose: s })}
              pending={pending}
            />
            {canEditDefinition ? (
              <button
                type="button"
                className="m-count-define"
                onClick={() => setPackEditorOpen(true)}
                disabled={pending}
              >
                + Define case structure
              </button>
            ) : (
              <p className="m-count-define-note">
                Case structure not yet set for this ingredient.
              </p>
            )}
          </div>
        )}

        <div className="m-count-total" aria-live="polite">
          <span className="m-count-total__label">Total</span>
          <span className="m-count-total__rule" aria-hidden />
          <span className="m-count-total__value">
            <strong>{fmtQty(liveTotal?.canonical ?? 0)}</strong>{" "}
            <em className="m-count-total__unit">{current.recipeUnit ?? ""}</em>
          </span>
        </div>

        {current.id in savedQty ? (
          <p className="m-count-dossier__previous">
            already saved · {fmtQty(savedQty[current.id])} {current.recipeUnit ?? ""}
          </p>
        ) : null}

        {error ? <p className="m-count-dossier__error">{error}</p> : null}

        {canEditDefinition && tierDef.hasCase ? (
          <button
            type="button"
            className="m-count-dossier__redefine"
            onClick={() => setPackEditorOpen(true)}
            disabled={pending}
          >
            edit pack definition
          </button>
        ) : null}
      </article>

      {/* Actions row */}
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
          disabled={pending}
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
          className="toolbar-btn toolbar-btn--accent m-count-save"
          onClick={save}
          disabled={pending}
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

      {packEditorOpen && canEditDefinition ? (
        <PackEditorSheet
          ingredient={current}
          onClose={() => setPackEditorOpen(false)}
          onSaved={(patch) => onPackUpdated(current.id, patch)}
        />
      ) : null}
    </div>
  )
}

/* ──────────────────────────────  helpers  ────────────────────────────── */

function describeTiers(ing: CountIngredient): {
  hasCase: boolean
  hasInner: boolean
  caseUnit: string
  innerPackUnit: string
  perCaseLabel: string
  perInnerLabel: string
} {
  const hasCase = ing.caseUnit != null && ing.recipeUnitsPerCase != null
  const hasInner = hasCase && ing.innerPackUnit != null && ing.innerPacksPerCase != null
  const caseUnit = ing.caseUnit ?? "CS"
  const innerPackUnit = ing.innerPackUnit ?? ""
  const perCase = ing.recipeUnitsPerCase ?? 0
  const innerPerCase = ing.innerPacksPerCase ?? 0
  return {
    hasCase,
    hasInner,
    caseUnit,
    innerPackUnit,
    perCaseLabel: hasCase
      ? `≈ ${fmtQty(perCase)} ${ing.recipeUnit ?? ""} / ${caseUnit.toLowerCase()}`
      : "",
    perInnerLabel: hasInner
      ? `${innerPerCase} per ${caseUnit.toLowerCase()} · ≈ ${fmtQty(perCase / innerPerCase)} ${ing.recipeUnit ?? ""} ea`
      : "",
  }
}

/* ──────────────────────────────  Tier Row  ────────────────────────────── */

function TierRow({
  roman,
  label,
  hint,
  value,
  autoFocus,
  onChange,
  pending,
}: {
  roman: string
  label: string
  hint: string
  value: string
  autoFocus?: boolean
  onChange: (v: string) => void
  pending: boolean
}) {
  return (
    <label className={`m-count-tier${value !== "" ? " m-count-tier--filled" : ""}`}>
      <span className="m-count-tier__roman">{roman}</span>
      <span className="m-count-tier__label">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        pattern="[0-9]*[.]?[0-9]*"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          const next = e.target.value
          if (next === "" || /^[0-9]*\.?[0-9]*$/.test(next)) onChange(next)
        }}
        onFocus={(e) => e.target.select()}
        disabled={pending}
        className="m-count-tier__input"
        aria-label={label}
      />
      <span className="m-count-tier__hint">{hint}</span>
    </label>
  )
}

/* ──────────────────────────────  Photo Block  ────────────────────────────── */

function photoSrc(id: string, version: string | null): string {
  const base = `/api/canonical-ingredients/${id}/photo`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

function PhotoBlock({
  ingredient,
  canUpload,
  onPhotoUpdated,
  onError,
}: {
  ingredient: CountIngredient
  canUpload: boolean
  onPhotoUpdated: (id: string, version: string | null, hasPhoto: boolean) => void
  onError: (msg: string | null) => void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  const onPick = () => {
    onError(null)
    fileInputRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append("photo", file)
      const res = await fetch(`/api/canonical-ingredients/${ingredient.id}/photo`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        onError(body?.error ?? `Upload failed (${res.status})`)
        return
      }
      onPhotoUpdated(ingredient.id, new Date().toISOString(), true)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  return (
    <figure
      className={`m-count-photo${
        ingredient.hasPhoto ? " m-count-photo--present" : " m-count-photo--empty"
      }`}
    >
      {ingredient.hasPhoto ? (
        <img
          src={photoSrc(ingredient.id, ingredient.photoVersion)}
          alt={`Reference photo of ${ingredient.name}`}
          className="m-count-photo__image"
        />
      ) : (
        <div className="m-count-photo__placeholder">
          <span className="m-count-photo__placeholder-mark" aria-hidden>
            ※
          </span>
          <span className="m-count-photo__placeholder-text">
            {canUpload ? "no reference photo yet" : "no reference photo"}
          </span>
        </div>
      )}

      {canUpload ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={onFileChange}
            hidden
          />
          <button
            type="button"
            className="m-count-photo__btn"
            onClick={onPick}
            disabled={uploading}
            aria-label={ingredient.hasPhoto ? "Replace photo" : "Take photo"}
          >
            {uploading ? "…" : ingredient.hasPhoto ? "replace" : "take photo"}
          </button>
        </>
      ) : null}
    </figure>
  )
}

/* ──────────────────────────────  Pack Editor Sheet  ────────────────────────────── */

function PackEditorSheet({
  ingredient,
  onClose,
  onSaved,
}: {
  ingredient: CountIngredient
  onClose: () => void
  onSaved: (patch: Partial<CountIngredient>) => void
}) {
  const [caseUnit, setCaseUnit] = useState(ingredient.caseUnit ?? "CS")
  const [recipeUnitsPerCase, setRupc] = useState(
    ingredient.recipeUnitsPerCase != null ? String(ingredient.recipeUnitsPerCase) : "",
  )
  const [includeInner, setIncludeInner] = useState(ingredient.innerPackUnit != null)
  const [innerPackUnit, setInnerPackUnit] = useState(ingredient.innerPackUnit ?? "PK")
  const [innerPacksPerCase, setIppc] = useState(
    ingredient.innerPacksPerCase != null ? String(ingredient.innerPacksPerCase) : "",
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleSave = () => {
    const rupc = Number(recipeUnitsPerCase)
    if (!Number.isFinite(rupc) || rupc <= 0) {
      setError("Recipe units per case must be positive")
      return
    }
    const ippc = includeInner ? Number(innerPacksPerCase) : null
    if (includeInner && (!Number.isFinite(ippc!) || ippc! <= 0)) {
      setError("Inner packs per case must be positive")
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await setCanonicalPackDefinition({
          canonicalIngredientId: ingredient.id,
          caseUnit,
          recipeUnitsPerCase: rupc,
          innerPackUnit: includeInner ? innerPackUnit : null,
          innerPacksPerCase: ippc,
        })
        onSaved({
          caseUnit: caseUnit.toUpperCase(),
          recipeUnitsPerCase: rupc,
          innerPackUnit: includeInner ? innerPackUnit.toUpperCase() : null,
          innerPacksPerCase: ippc,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save pack definition")
      }
    })
  }

  const handleClear = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setCanonicalPackDefinition({
          canonicalIngredientId: ingredient.id,
          caseUnit: null,
          recipeUnitsPerCase: null,
          innerPackUnit: null,
          innerPacksPerCase: null,
        })
        onSaved({
          caseUnit: null,
          recipeUnitsPerCase: null,
          innerPackUnit: null,
          innerPacksPerCase: null,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not clear")
      }
    })
  }

  return (
    <div className="m-sheet m-sheet--pack" role="dialog" aria-label="Define pack structure">
      <div className="m-sheet__head">
        <span className="m-sheet__dept">PACK · DEFINITION</span>
        <button
          type="button"
          className="m-sheet__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="m-sheet__body">
        <p className="m-sheet__lead">
          <em>{ingredient.name}</em> · counted in {ingredient.recipeUnit ?? "—"}
        </p>

        <div className="m-pack-grid">
          <label className="m-pack-field">
            <span className="m-pack-field__label">Case label</span>
            <input
              className="m-pack-field__input"
              value={caseUnit}
              onChange={(e) => setCaseUnit(e.target.value.toUpperCase())}
              maxLength={6}
              disabled={pending}
            />
          </label>
          <label className="m-pack-field">
            <span className="m-pack-field__label">
              {ingredient.recipeUnit ?? "unit"}s per case
            </span>
            <input
              className="m-pack-field__input"
              inputMode="decimal"
              value={recipeUnitsPerCase}
              onChange={(e) => setRupc(e.target.value)}
              disabled={pending}
            />
          </label>
        </div>

        <label className="m-pack-toggle">
          <input
            type="checkbox"
            checked={includeInner}
            onChange={(e) => setIncludeInner(e.target.checked)}
            disabled={pending}
          />
          <span>Case contains an inner pack</span>
        </label>

        {includeInner ? (
          <div className="m-pack-grid">
            <label className="m-pack-field">
              <span className="m-pack-field__label">Inner label</span>
              <input
                className="m-pack-field__input"
                value={innerPackUnit}
                onChange={(e) => setInnerPackUnit(e.target.value.toUpperCase())}
                maxLength={6}
                disabled={pending}
              />
            </label>
            <label className="m-pack-field">
              <span className="m-pack-field__label">Inner per case</span>
              <input
                className="m-pack-field__input"
                inputMode="decimal"
                value={innerPacksPerCase}
                onChange={(e) => setIppc(e.target.value)}
                disabled={pending}
              />
            </label>
          </div>
        ) : null}

        {error ? <p className="m-sheet__error">{error}</p> : null}
      </div>
      <div className="m-sheet__actions">
        <button
          type="button"
          className="toolbar-btn"
          onClick={handleClear}
          disabled={pending}
        >
          Clear definition
        </button>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--accent"
          onClick={handleSave}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────  Adjustment Sheet  ────────────────────────────── */

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
        <span className="m-sheet__dept">LOG · ADJUSTMENT</span>
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
          You counted zero <em>{ingredientName}</em>. Log what removed it from stock?
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

