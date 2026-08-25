"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { useFramePlacement } from "./frame-placement"

/**
 * Note 25: "The store switcher deletes a whole class of route." Every
 * `/[storeId]` page — analytics, P&L, COGS, labor — existed only because
 * there was no other way to scope a page to one store. With this in the
 * rail, a per-store view is a parameter (`selectedId`), not a route.
 *
 * The radiogroup below is unchanged from its first version — `aria-checked`
 * still carries the selection, the stage labels still name why a pre-open
 * store has nothing to show. What changed is what wraps it: a real-browser
 * verification (docs/counter/controls-verification.md) found that mounting
 * the bare radiogroup directly in a topbar next to `DateControl`'s
 * single-line trigger produced a four-row stack that read as a lopsided
 * panel of controls rather than a header. This now gets the same shape
 * `DateControl` already has for itself — a single-line trigger showing the
 * current selection, and a popover (placed with the same `./frame-placement`
 * helper, note 21) holding the radiogroup.
 */

export interface SwitchableStore {
  id: string
  name: string
  stage: "trading" | "warming_up" | "pre_open"
}

/**
 * Note 58: the store model has three stages and the pre-Counter interface
 * only ever expressed two, so a reader looking at an empty Glendale could
 * not tell "not trading yet" from "the sync failed". `trading` gets no
 * label at all — it is the default a reader assumes, and a label on every
 * row would bury the two that matter.
 */
const STAGE_LABEL: Record<SwitchableStore["stage"], string | null> = {
  trading: null,
  warming_up: "warming up",
  pre_open: "opening soon",
}

/**
 * `aria-checked` carries the selection to a screen reader; the
 * `bg-ct-accent-wash` / `text-ct-accent-hi` pair is only the sighted
 * affordance for the same fact, set from the same `checked` boolean so the
 * two can never disagree.
 */
function optionClass(checked: boolean): string {
  return checked
    ? "flex items-center justify-between gap-2 rounded-ct-sm bg-ct-accent-wash px-2.5 py-1.5 text-left text-ct-body text-ct-accent-hi"
    : "flex items-center justify-between gap-2 rounded-ct-sm px-2.5 py-1.5 text-left text-ct-body text-ct-ink hover:bg-ct-sunk"
}

export function StoreSwitcher({
  stores,
  selectedId,
  onSelect,
}: {
  stores: SwitchableStore[]
  /** null means all stores — the absence of a store, not a magic "all" id. */
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Escape and an outside click both close the popover without choosing
  // anything — same contract as DateControl's two menus.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [open])

  // Narrower than DateControl's range menu (438) — a store name never needs
  // that much room — but the same shared placement helper and the same
  // 10px minimum left margin, so the flip that keeps the range menu on
  // screen at 390px keeps this on screen there too.
  const placement = useFramePlacement(open, triggerRef, { maxWidth: 280, minWidth: 200 })

  const selected = selectedId === null ? null : stores.find((s) => s.id === selectedId) ?? null
  const triggerLabel = selected ? selected.name : "All stores"

  const choose = (id: string | null) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 whitespace-nowrap rounded-ct-sm border border-ct-line-strong bg-ct-surface px-2.5 py-1 font-ct-sans text-ct-body text-ct-ink hover:bg-ct-sunk"
      >
        <span className="font-semibold">{triggerLabel}</span>
        <ChevronDown aria-hidden="true" className="size-[11px] text-ct-ink-3" />
      </button>

      {open && (
        <div
          style={{
            width: placement.width,
            ...(placement.left != null ? { left: placement.left } : { right: 0 }),
          }}
          className="absolute top-[calc(100%+7px)] z-30 rounded-ct border border-ct-line-strong bg-ct-surface py-1"
        >
          <div role="radiogroup" aria-label="Store" className="grid gap-px">
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === null}
              onClick={() => choose(null)}
              className={optionClass(selectedId === null)}
            >
              <span>All stores</span>
            </button>
            {stores.map((store) => {
              const checked = store.id === selectedId
              const stageLabel = STAGE_LABEL[store.stage]
              return (
                <button
                  key={store.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => choose(store.id)}
                  className={optionClass(checked)}
                >
                  <span>{store.name}</span>
                  {stageLabel !== null && (
                    <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
                      {stageLabel}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
