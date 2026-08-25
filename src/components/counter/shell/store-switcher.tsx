"use client"

/**
 * Note 25: "The store switcher deletes a whole class of route." Every
 * `/[storeId]` page — analytics, P&L, COGS, labor — existed only because
 * there was no other way to scope a page to one store. With this in the
 * rail, a per-store view is a parameter (`selectedId`), not a route.
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
  return (
    <div role="radiogroup" aria-label="Store" className="grid gap-px">
      <button
        type="button"
        role="radio"
        aria-checked={selectedId === null}
        onClick={() => onSelect(null)}
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
            onClick={() => onSelect(store.id)}
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
  )
}
