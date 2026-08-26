"use client"

import { useEffect, useRef } from "react"

/**
 * The store switcher, where the design puts it: in the RAIL, directly under
 * the logo (prototype `rail()`, line 8231) — not in the topbar.
 *
 * ```
 * <div style="position:relative;padding:0 10px">     ← the prototype's own inline style
 *   <button class="rail__store" data-storepick style="width:100%">
 *     <span><span class="nm">Hollywood</span><span class="mt">1 of 3 stores</span></span>
 *     <svg …chevron…>
 *   </button>
 *   <div class="storepop">
 *     <button class="storeopt" aria-pressed="…">
 *       <span><b>Hollywood</b></span><span class="mtag good">Trading</span>
 *     </button>
 *     …
 *   </div>
 * </div>
 * ```
 *
 * Note 25: "The store switcher deletes a whole class of route." Every
 * `/[storeId]` page existed only because there was no other way to scope a page
 * to one store. With this in the rail, a per-store view is a parameter, not a
 * route.
 *
 * FOUR THINGS THAT CHANGED FROM THE TOPBAR VERSION, EACH BECAUSE OF THE
 * PORTED SHEET:
 *
 *   1. `aria-pressed`, not `role="radio"` + `aria-checked`. `.storeopt[aria-pressed="true"]`
 *      (counter-components.css:747, 750) is the ONLY selector that paints the
 *      current store, so the attribute is load-bearing, not decorative — and
 *      `role="radio"` does not take `aria-pressed`. The prototype emits a group
 *      of toggle buttons and so do we. A pressed toggle still announces its
 *      state; what is lost is the "2 of 4" position a radiogroup announces.
 *   2. The popover is ALWAYS in the DOM and shown by `.rail.is-picking .storepop`
 *      (counter-components.css:743) — a class on the RAIL, not on this element.
 *      That is why `open` is a prop: the state has to live where the class goes.
 *   3. No `useFramePlacement`. `.storepop` is `position:absolute;left:10px;right:10px`
 *      inside the relatively-positioned wrapper above, so it is pinned to the
 *      rail's own width and cannot leave the viewport. The prototype's `place()`
 *      is likewise only ever called on `.drpop`.
 *   4. The stage words are the prototype's — "Trading", "Warming up",
 *      "Pre-open" — and they ride in a `.mtag`, whose `good`/`warn` modifiers
 *      are the sheet's own. Note 58 still holds: the model has three stages and
 *      the pre-Counter interface could express two, so a reader looking at an
 *      empty Glendale could not tell "not trading yet" from "the sync failed".
 */

export interface SwitchableStore {
  id: string
  name: string
  stage: "trading" | "warming_up" | "pre_open"
}

/**
 * `.mtag` has three tones in the ported sheet; a store uses two of them.
 *
 * EXPORTED because the phone has the same control in different chrome —
 * `MTop`'s store sheet — and a store that is "Warming up" in the rail must not
 * be something else in a sheet. One map, two surfaces. (`stageLabel` in
 * `store-cards.tsx` is the same vocabulary for the store CARDS, which take a
 * `StoreCard` rather than a `SwitchableStore`; the two shapes are different
 * and the words are deliberately identical.)
 */
export const STAGE_TAG: Record<SwitchableStore["stage"], { className: string; label: string }> = {
  trading: { className: "mtag good", label: "Trading" },
  warming_up: { className: "mtag", label: "Warming up" },
  pre_open: { className: "mtag warn", label: "Pre-open" },
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M4 6.5L8 10.5 12 6.5" />
    </svg>
  )
}

export function StoreSwitcher({
  stores,
  selectedId,
  onSelect,
  open,
  onOpenChange,
}: {
  stores: SwitchableStore[]
  /** null means all stores — the absence of a store, not a magic "all" id. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  // Escape and an outside click both close without choosing anything — the
  // same contract the date popover keeps, and the prototype's own two
  // document-level listeners.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [open, onOpenChange])

  const selected = selectedId === null ? null : (stores.find((s) => s.id === selectedId) ?? null)
  // The prototype's `mt` line, derived rather than authored: "1 of 3 stores"
  // when one is picked, the count of locations when they are aggregated.
  const meta = selected ? `1 of ${stores.length} stores` : `${stores.length} locations`

  const choose = (id: string | null) => {
    onSelect(id)
    onOpenChange(false)
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", padding: "0 10px" }}>
      <button
        type="button"
        className="rail__store"
        style={{ width: "100%" }}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span>
          <span className="nm">{selected ? selected.name : "All stores"}</span>
          <span className="mt">{meta}</span>
        </span>
        <Chevron />
      </button>

      <div className="storepop" role="group" aria-label="Store">
        <button
          type="button"
          className="storeopt"
          aria-pressed={selectedId === null}
          onClick={() => choose(null)}
        >
          <span>
            <b>All stores</b>
          </span>
          <span className="mtag">{stores.length}</span>
        </button>
        {stores.map((store) => {
          const tag = STAGE_TAG[store.stage]
          return (
            <button
              key={store.id}
              type="button"
              className="storeopt"
              aria-pressed={store.id === selectedId}
              onClick={() => choose(store.id)}
            >
              <span>
                <b>{store.name}</b>
              </span>
              <span className={tag.className}>{tag.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
