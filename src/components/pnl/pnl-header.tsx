"use client"

import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { PnLDateControls, type PnLRangeState } from "./pnl-date-controls"

export { type PnLRangeState } from "./pnl-date-controls"

export interface StoreOption {
  id: string
  name: string
}

export interface PnLHeaderProps {
  /** Unused — EditorialTopbar already shows the title. Kept for back-compat. */
  title?: string
  state: PnLRangeState
  onChange: (s: PnLRangeState) => void
  isPending?: boolean
  /** When provided, renders a store-picker row; navigating to /dashboard/pnl or /dashboard/pnl/[id]. */
  stores?: StoreOption[]
  currentStoreId?: string
}

export function PnLHeader({
  state,
  onChange,
  isPending,
  stores,
  currentStoreId,
}: PnLHeaderProps) {
  const router = useRouter()

  const handleStoreChange = (id: string | null) => {
    if (id === null) {
      router.push("/dashboard/pnl")
    } else {
      router.push(`/dashboard/pnl/${id}`)
    }
  }

  return (
    <div className="pnl-header">
      {stores && stores.length > 0 && (
        <div className="pnl-header__stores">
          <span className="pnl-controls__label">Store</span>
          <div className="pnl-controls__pills" role="radiogroup" aria-label="Store filter">
            <button
              type="button"
              role="radio"
              aria-checked={!currentStoreId}
              className={cn(
                "pnl-controls__pill",
                !currentStoreId && "pnl-controls__pill--active"
              )}
              onClick={() => handleStoreChange(null)}
              disabled={isPending}
            >
              All Stores
            </button>
            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={currentStoreId === s.id}
                className={cn(
                  "pnl-controls__pill",
                  currentStoreId === s.id && "pnl-controls__pill--active"
                )}
                onClick={() => handleStoreChange(s.id)}
                disabled={isPending}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <PnLDateControls state={state} onChange={onChange} isPending={isPending} />
    </div>
  )
}
