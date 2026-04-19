"use client"

import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Store as StoreIcon } from "lucide-react"
import { PnLDateControls, type PnLRangeState } from "./pnl-date-controls"

export { type PnLRangeState } from "./pnl-date-controls"

export interface StoreOption {
  id: string
  name: string
}

export interface PnLHeaderProps {
  title: string
  state: PnLRangeState
  onChange: (s: PnLRangeState) => void
  isPending?: boolean
  /** When provided, renders a store-picker Select; navigating to /dashboard/pnl or /dashboard/pnl/[id]. */
  stores?: StoreOption[]
  currentStoreId?: string
}

export function PnLHeader({
  title,
  state,
  onChange,
  isPending,
  stores,
  currentStoreId,
}: PnLHeaderProps) {
  const router = useRouter()

  const handleStoreChange = (id: string) => {
    if (id === "__ALL__") {
      router.push("/dashboard/pnl")
    } else {
      router.push(`/dashboard/pnl/${id}`)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>

        {stores && stores.length > 0 && (
          <div className="flex items-center gap-1.5">
            <StoreIcon className="h-4 w-4 text-muted-foreground" />
            <Select
              value={currentStoreId ?? "__ALL__"}
              onValueChange={handleStoreChange}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 w-[180px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All Stores</SelectItem>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <PnLDateControls state={state} onChange={onChange} isPending={isPending} />
    </div>
  )
}
